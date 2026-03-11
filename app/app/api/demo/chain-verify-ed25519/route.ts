// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { HEADERS } from "@selfxyz/agent-sdk";
import { getNetwork, NETWORKS, type NetworkId } from "@/lib/network";
import { getCachedVerifier } from "@/lib/selfVerifier";
import { checkAndRecordReplay } from "@/lib/replayGuard";
import { demoEndpointDocs } from "@/lib/demo-docs";

import { typedDemoVerifierEd25519, typedRegistry } from "@/lib/contract-types";

// Allow up to 60s for on-chain tx submission + confirmation
export const maxDuration = 60;

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
// POST — Ed25519 meta-tx relay
//
// Unlike the ECDSA chain-verify route (which uses EIP-712), this route
// verifies Ed25519 signatures on-chain via AgentDemoVerifierEd25519.
// The agent signs a plain keccak256(agentKey, nonce, deadline) message.
// ---------------------------------------------------------------------------

export function GET() {
  return demoEndpointDocs({
    endpoint: "/api/demo/chain-verify-ed25519",
    method: "POST",
    description:
      "Agent-to-Chain verification demo (Ed25519). Submits a meta-transaction to the AgentDemoVerifierEd25519 contract, which verifies Ed25519 signatures on-chain via SCL_EIP6565. A gas relayer submits the transaction on behalf of the agent.",
    requiredHeaders: {
      "x-self-agent-signature": "HMAC signature of the request",
      "x-self-agent-timestamp": "ISO 8601 timestamp of the request",
      "x-self-agent-keytype": "Must be 'ed25519'",
      "x-self-agent-key": "Ed25519 public key (hex)",
    },
    bodySchema: {
      agentKey: "bytes32 — the agent's public key in the registry",
      nonce: "string — meta-tx nonce",
      deadline: "number — unix timestamp expiry",
      extKpub:
        "array of 5 uint256 strings — Weierstrass coordinates of Ed25519 pubkey",
      sigR: "string — Ed25519 signature R component (uint256)",
      sigS: "string — Ed25519 signature S component (uint256)",
      "networkId?": "'celo-sepolia' (default) or 'celo-mainnet'",
    },
    exampleBody: {
      agentKey: "0x...",
      nonce: "0",
      deadline: 1700000000,
      extKpub: ["0", "0", "0", "0", "0"],
      sigR: "0",
      sigS: "0",
      networkId: "celo-sepolia",
    },
    notes: [
      "Requires RELAYER_PRIVATE_KEY server env var.",
      "Rate limited: 3 verifications per hour per human nullifier.",
      "For Ed25519 agents only. ECDSA agents should use /api/demo/chain-verify.",
      "Computing extKpub requires the SCL library precompute for Weierstrass coordinates.",
    ],
  });
}

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
  const keytype = req.headers.get(HEADERS.KEYTYPE) ?? undefined;
  const agentKeyHeader = req.headers.get(HEADERS.KEY) ?? undefined;

  if (!signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing agent authentication headers" },
      { status: 401 },
    );
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return NextResponse.json(
      { error: "Failed to read request body" },
      { status: 400 },
    );
  }

  try {
    // 2. Parse request body
    let agentKey: string;
    let nonce: string;
    let deadline: number;
    let extKpub: [string, string, string, string, string];
    let sigR: string;
    let sigS: string;
    let networkId: NetworkId;
    try {
      const parsed = JSON.parse(bodyText) as unknown;
      if (!parsed || typeof parsed !== "object") {
        throw new Error("Invalid JSON object");
      }
      const bodyObj = parsed as Record<string, unknown>;

      agentKey = typeof bodyObj.agentKey === "string" ? bodyObj.agentKey : "";
      const rawNonce = bodyObj.nonce;
      nonce =
        typeof rawNonce === "string"
          ? rawNonce
          : typeof rawNonce === "number"
            ? String(rawNonce)
            : "";
      const rawDeadline = bodyObj.deadline;
      deadline =
        typeof rawDeadline === "number"
          ? rawDeadline
          : typeof rawDeadline === "string"
            ? Number(rawDeadline)
            : Number.NaN;

      // Ed25519-specific fields
      if (!Array.isArray(bodyObj.extKpub) || bodyObj.extKpub.length !== 5) {
        throw new Error("extKpub must be array of 5 uint256 strings");
      }
      extKpub = (bodyObj.extKpub as unknown[]).map((v) => String(v)) as [
        string,
        string,
        string,
        string,
        string,
      ];
      sigR = typeof bodyObj.sigR === "string" ? bodyObj.sigR : "";
      sigS = typeof bodyObj.sigS === "string" ? bodyObj.sigS : "";

      const rawNetworkId = bodyObj.networkId;
      networkId =
        typeof rawNetworkId === "string" && rawNetworkId in NETWORKS
          ? (rawNetworkId as NetworkId)
          : "celo-sepolia";

      if (!agentKey || !nonce || !Number.isFinite(deadline) || !sigR || !sigS) {
        throw new Error("Missing fields");
      }
    } catch {
      return NextResponse.json(
        {
          error:
            "Invalid request body — expected { agentKey, nonce, deadline, extKpub, sigR, sigS, networkId? }",
        },
        { status: 400 },
      );
    }

    // 3. Resolve network config
    const network = getNetwork(networkId);
    if (!network.registryAddress || !network.agentDemoVerifierEd25519Address) {
      return NextResponse.json(
        {
          error: `Network ${networkId} not configured for Ed25519 demo verification`,
        },
        { status: 400 },
      );
    }

    // 4. Set up provider + contracts
    const provider = new ethers.JsonRpcProvider(network.rpcUrl);
    const relayerWallet = new ethers.Wallet(RELAYER_PK, provider);
    const contract = typedDemoVerifierEd25519(
      network.agentDemoVerifierEd25519Address,
      relayerWallet,
    );
    const registryContract = typedRegistry(network.registryAddress, provider);

    // 5. Convert extKpub strings to BigInts for contract call
    const extKpubBigInt: [bigint, bigint, bigint, bigint, bigint] = [
      BigInt(extKpub[0]),
      BigInt(extKpub[1]),
      BigInt(extKpub[2]),
      BigInt(extKpub[3]),
      BigInt(extKpub[4]),
    ];

    // 6. Simulate via staticCall — the CONTRACT verifies the agent on-chain
    try {
      await contract.metaVerifyAgent.staticCall(
        agentKey,
        BigInt(nonce),
        BigInt(deadline),
        extKpubBigInt,
        BigInt(sigR),
        BigInt(sigS),
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
            "Contract rejected: Ed25519 signature invalid — pubkey does not match agent key or signature verification failed";
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
      scope: "demo-chain-verify-ed25519",
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
        const retryMin = Math.ceil(
          (rateLimitResult.retryAfterMs || 0) / 60_000,
        );
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

    // 9. Fetch credentials via SDK for the response (the contract doesn't return them)
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
      keytype,
      agentKey: agentKeyHeader,
    });

    // 10. Submit real transaction
    let txHash = "";
    try {
      const tx = await contract.metaVerifyAgent(
        agentKey,
        BigInt(nonce),
        BigInt(deadline),
        extKpubBigInt,
        BigInt(sigR),
        BigInt(sigS),
      );
      txHash = tx.hash;

      // Wait for confirmation with 8s timeout (Vercel serverless has 10s limit)
      const receipt = await Promise.race([
        tx.wait(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT")), 8_000),
        ),
      ]);

      if (!receipt) {
        return NextResponse.json({
          txHash,
          status: "pending",
          message: "Transaction submitted but receipt not available yet",
        });
      }

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
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal chain-verify error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
