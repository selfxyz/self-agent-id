// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { HEADERS } from "@selfxyz/agent-sdk";
import { AGENT_DEMO_VERIFIER_ABI, REGISTRY_ABI } from "@/lib/constants";
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
//
// Unlike agent-to-service and agent-to-agent demos (which verify via SDK),
// this route lets the ON-CHAIN CONTRACT do the verification. The contract's
// metaVerifyAgent() calls ecrecover + isVerifiedAgent() itself.
// We only do a staticCall simulation first (free, no gas) to catch reverts
// before spending gas on the real tx.
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (!RELAYER_PK) {
    return NextResponse.json(
      { error: "Relayer not configured" },
      { status: 503 },
    );
  }

  // 1. Extract agent auth headers (needed for replay protection only)
  const signature = req.headers.get(HEADERS.SIGNATURE);
  const timestamp = req.headers.get(HEADERS.TIMESTAMP);

  if (!signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing agent authentication headers" },
      { status: 401 },
    );
  }

  const bodyText = await req.text();

  // 2. Parse request body
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
    networkId =
      parsed.networkId && parsed.networkId in NETWORKS
        ? parsed.networkId
        : "celo-sepolia";
    if (!agentKey || nonce == null || !deadline || !eip712Signature) {
      throw new Error("Missing fields");
    }
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid request body — expected { agentKey, nonce, deadline, eip712Signature, networkId? }",
      },
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

  // 4. Set up provider + contracts
  const provider = new ethers.JsonRpcProvider(network.rpcUrl);
  const relayerWallet = new ethers.Wallet(RELAYER_PK, provider);
  const contract = new ethers.Contract(
    network.agentDemoVerifierAddress,
    AGENT_DEMO_VERIFIER_ABI,
    relayerWallet,
  );
  const registryContract = new ethers.Contract(
    network.registryAddress,
    REGISTRY_ABI,
    provider,
  );

  // 6. Simulate via staticCall — the CONTRACT verifies the agent on-chain:
  //    ecrecover(EIP-712 digest) → derive agentKey → isVerifiedAgent(agentKey)
  //    Reverts with NotVerifiedAgent, MetaTxExpired, MetaTxInvalidNonce, or MetaTxInvalidSignature
  try {
    await contract.metaVerifyAgent.staticCall(
      agentKey,
      nonce,
      deadline,
      eip712Signature,
    );
  } catch (simErr) {
    let reason = "On-chain simulation failed";
    if (simErr instanceof Error) {
      const msg = simErr.message;
      if (msg.includes("NotVerifiedAgent")) {
        reason =
          "Contract rejected: agent not verified in registry (isVerifiedAgent returned false)";
      } else if (msg.includes("MetaTxExpired")) {
        reason = "Contract rejected: meta-transaction deadline expired";
      } else if (msg.includes("MetaTxInvalidNonce")) {
        reason = "Contract rejected: invalid nonce (replay or out of order)";
      } else if (msg.includes("MetaTxInvalidSignature")) {
        reason =
          "Contract rejected: EIP-712 signature invalid — signer does not match agent key";
      } else {
        reason = `Contract rejected: ${msg.slice(0, 200)}`;
      }
    }
    return NextResponse.json({ error: reason }, { status: 400 });
  }

  // 7. Replay protection — recorded AFTER validation to prevent cache poisoning
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

  // 8. Rate limit by human nullifier (only reachable if agent is verified)
  let rateLimitResult: {
    allowed: boolean;
    remaining: number;
    retryAfterMs?: number;
  };
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

  // 8. Submit real transaction (with timeout for Vercel serverless)
  // Fetch credentials via SDK for the response (the contract doesn't return them)
  const verifier = getCachedVerifier(networkId, {
    maxAgentsPerHuman: 0,
    includeCredentials: true,
    enableReplayProtection: false, // already checked above
  });
  const sdkResult = await verifier.verify({
    signature,
    timestamp,
    method: "POST",
    url: req.url,
    body: bodyText || undefined,
  });

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
      agentAddress: sdkResult.valid ? sdkResult.agentAddress : undefined,
      agentId: sdkResult.valid ? sdkResult.agentId.toString() : undefined,
      credentials:
        sdkResult.valid && sdkResult.credentials
          ? {
              olderThan: sdkResult.credentials.olderThan.toString(),
              nationality: sdkResult.credentials.nationality,
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
        agentAddress: sdkResult.valid ? sdkResult.agentAddress : undefined,
        agentId: sdkResult.valid ? sdkResult.agentId.toString() : undefined,
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
