import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { HEADERS } from "@selfxyz/agent-sdk";
import {
  AGENT_DEMO_VERIFIER_ABI,
  REGISTRY_ABI,
} from "@/lib/constants";
import { getNetwork, NETWORKS, type NetworkId } from "@/lib/network";
import { getCachedVerifier } from "@/lib/selfVerifier";
import { checkAndRecordReplay } from "@/lib/replayGuard";

const RELAYER_PK = process.env.RELAYER_PRIVATE_KEY;

// ---------------------------------------------------------------------------
// Rate limiter — 3 verifications per hour per human nullifier
// ---------------------------------------------------------------------------

const rateLimits = new Map<string, number[]>();

function checkRateLimit(nullifier: string): {
  allowed: boolean;
  remaining: number;
  retryAfterMs?: number;
} {
  const now = Date.now();
  const hourAgo = now - 3_600_000;
  const timestamps = (rateLimits.get(nullifier) || []).filter(
    (t) => t > hourAgo,
  );
  rateLimits.set(nullifier, timestamps);
  if (timestamps.length >= 3) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: timestamps[0] + 3_600_000 - now,
    };
  }
  timestamps.push(now);
  return { allowed: true, remaining: 3 - timestamps.length };
}

// ---------------------------------------------------------------------------
// POST — EIP-712 meta-tx relay
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!RELAYER_PK) {
    return NextResponse.json(
      { error: "Relayer not configured" },
      { status: 503 },
    );
  }

  // 1. Extract agent auth headers
  const signature = req.headers.get(HEADERS.SIGNATURE);
  const timestamp = req.headers.get(HEADERS.TIMESTAMP);

  if (!signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing agent authentication headers" },
      { status: 401 },
    );
  }

  const bodyText = await req.text();

  // 2. Parse request body first to get networkId
  let agentKey: string;
  let nonce: string;
  let deadline: number;
  let eip712Signature: string;
  let networkId: NetworkId;
  try {
    const parsed = JSON.parse(bodyText);
    agentKey = parsed.agentKey;
    nonce = parsed.nonce;
    deadline = parsed.deadline;
    eip712Signature = parsed.eip712Signature;
    networkId = parsed.networkId && parsed.networkId in NETWORKS
      ? parsed.networkId
      : "celo-sepolia";
    if (!agentKey || nonce == null || !deadline || !eip712Signature) {
      throw new Error("Missing fields");
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid request body — expected { agentKey, nonce, deadline, eip712Signature, networkId? }" },
      { status: 400 },
    );
  }

  // 3. Resolve network config
  const network = getNetwork(networkId);
  if (!network.registryAddress || !network.agentDemoVerifierAddress) {
    return NextResponse.json(
      { error: `Network ${networkId} not configured for demo verification` },
      { status: 400 },
    );
  }

  // 4. Verify agent identity via SDK
  const verifier = getCachedVerifier(networkId, {
    maxAgentsPerHuman: 0,
    includeCredentials: true,
    enableReplayProtection: true,
  });

  const result = await verifier.verify({
    signature,
    timestamp,
    method: "POST",
    url: req.url,
    body: bodyText || undefined,
  });

  if (!result.valid) {
    return NextResponse.json(
      { error: result.error || "Agent verification failed" },
      { status: 403 },
    );
  }

  const replay = await checkAndRecordReplay({
    signature,
    timestamp,
    method: "POST",
    url: req.url,
    body: bodyText || undefined,
    scope: "demo-chain-verify",
  });
  if (!replay.ok) {
    return NextResponse.json(
      { error: replay.error || "Replay detected" },
      { status: 409 },
    );
  }

  // 5. Rate limit by human nullifier
  const provider = new ethers.JsonRpcProvider(network.rpcUrl);
  const registryContract = new ethers.Contract(
    network.registryAddress,
    REGISTRY_ABI,
    provider,
  );

  let rateLimitResult: { allowed: boolean; remaining: number; retryAfterMs?: number };
  try {
    const agentId = await registryContract.getAgentId(agentKey);
    const nullifier = await registryContract.getHumanNullifier(agentId);
    rateLimitResult = checkRateLimit(nullifier.toString());
    if (!rateLimitResult.allowed) {
      const retryMin = Math.ceil((rateLimitResult.retryAfterMs || 0) / 60_000);
      return NextResponse.json(
        {
          error: `Rate limited — 3 per hour per human. Retry in ~${retryMin} min.`,
          rateLimitRemaining: 0,
          retryAfterMs: rateLimitResult.retryAfterMs,
        },
        { status: 429 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Unable to verify rate limit — try again later" },
      { status: 503 },
    );
  }

  // 6. Set up contract + relayer
  const relayerWallet = new ethers.Wallet(RELAYER_PK, provider);
  const contract = new ethers.Contract(
    network.agentDemoVerifierAddress,
    AGENT_DEMO_VERIFIER_ABI,
    relayerWallet,
  );

  // 7. Simulate via staticCall
  try {
    await contract.metaVerifyAgent.staticCall(
      agentKey,
      nonce,
      deadline,
      eip712Signature,
    );
  } catch (simErr) {
    let reason = "Simulation failed";
    if (simErr instanceof Error) {
      const msg = simErr.message;
      if (msg.includes("NotVerifiedAgent")) {
        reason = "Agent not verified in registry";
      } else if (msg.includes("MetaTxExpired")) {
        reason = "Meta-transaction deadline expired";
      } else if (msg.includes("MetaTxInvalidNonce")) {
        reason = "Invalid nonce (replay or out of order)";
      } else if (msg.includes("MetaTxInvalidSignature")) {
        reason = "EIP-712 signature invalid — signer does not match agent key";
      } else {
        reason = msg.slice(0, 200);
      }
    }
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  // 8. Submit real transaction (with timeout for Vercel serverless)
  let txHash = "";
  try {
    const tx = await contract.metaVerifyAgent(
      agentKey,
      nonce,
      deadline,
      eip712Signature,
    );
    txHash = tx.hash;

    // Wait for confirmation with 8s timeout (Vercel serverless has 10s limit)
    const receipt = await Promise.race([
      tx.wait(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("TIMEOUT")), 8_000),
      ),
    ]);

    // Read counters after tx
    const [verCount, totalCount] = await Promise.all([
      contract.verificationCount(agentKey),
      contract.totalVerifications(),
    ]);

    return NextResponse.json({
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      explorerUrl: `${network.blockExplorer}/tx/${receipt.hash}`,
      agentAddress: result.agentAddress,
      agentId: result.agentId.toString(),
      credentials: result.credentials
        ? {
            olderThan: result.credentials.olderThan.toString(),
            nationality: result.credentials.nationality,
          }
        : undefined,
      verificationCount: verCount.toString(),
      totalVerifications: totalCount.toString(),
      gasUsed: receipt.gasUsed?.toString(),
      rateLimitRemaining: rateLimitResult.remaining,
    });
  } catch (txErr) {
    if (txErr instanceof Error && txErr.message === "TIMEOUT") {
      // Tx submitted but confirmation timed out — return hash for explorer link
      return NextResponse.json({
        txHash,
        pending: true,
        explorerUrl: `${network.blockExplorer}/tx/${txHash}`,
        agentAddress: result.agentAddress,
        agentId: result.agentId.toString(),
        rateLimitRemaining: rateLimitResult.remaining,
      });
    }
    let reason = "Transaction failed";
    if (txErr instanceof Error) {
      reason = txErr.message.slice(0, 200);
    }
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
