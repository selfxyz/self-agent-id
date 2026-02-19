import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { SelfAgentVerifier, HEADERS } from "@selfxyz/agent-sdk";
import {
  AGENT_DEMO_VERIFIER_ABI,
  REGISTRY_ABI,
} from "@/lib/constants";
import { getNetwork, NETWORKS, type NetworkId } from "@/lib/network";

const RELAYER_PK =
  process.env.RELAYER_PRIVATE_KEY || process.env.DEMO_AGENT_PRIVATE_KEY;

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
      { error: "Relayer not configured (missing RELAYER_PRIVATE_KEY)" },
      { status: 500 },
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
  const verifier = new SelfAgentVerifier({
    registryAddress: network.registryAddress,
    rpcUrl: network.rpcUrl,
    maxAgentsPerHuman: 0,
    includeCredentials: true,
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
    // If we can't resolve nullifier, skip rate limiting (agent might not exist)
    rateLimitResult = { allowed: true, remaining: 3 };
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

  // 8. Submit real transaction
  try {
    const tx = await contract.metaVerifyAgent(
      agentKey,
      nonce,
      deadline,
      eip712Signature,
    );
    const receipt = await tx.wait();

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
    let reason = "Transaction failed";
    if (txErr instanceof Error) {
      reason = txErr.message.slice(0, 200);
    }
    return NextResponse.json({ error: reason }, { status: 500 });
  }
}
