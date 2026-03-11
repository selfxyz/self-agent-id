// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { HEADERS } from "@selfxyz/agent-sdk";
import { NETWORKS, type NetworkId } from "@/lib/network";
import { getCachedVerifier } from "@/lib/selfVerifier";
import { checkAndRecordReplay } from "@/lib/replayGuard";
import { demoEndpointDocs } from "@/lib/demo-docs";

// Allow up to 30s for RPC calls to Forno (default 10s can be tight)
export const maxDuration = 30;

// In-memory verification counter (resets on server restart — fine for demo)
let verificationCount = 0;

function resolveNetwork(req: NextRequest): NetworkId {
  const param = req.nextUrl.searchParams.get("network");
  if (param && param in NETWORKS) return param as NetworkId;
  return "celo-sepolia";
}

export function GET() {
  return demoEndpointDocs({
    endpoint: "/api/demo/verify",
    method: "POST",
    description:
      "Agent-to-Service verification demo. A service verifies that the calling agent is registered and backed by a real human. Returns the agent's on-chain identity and credentials.",
    requiredHeaders: {
      "x-self-agent-signature": "HMAC signature of the request",
      "x-self-agent-timestamp": "ISO 8601 timestamp of the request",
    },
    optionalHeaders: {
      "x-self-agent-keytype": "Key type: 'ed25519' or omit for ECDSA",
      "x-self-agent-key": "Agent public key (required for Ed25519)",
    },
    bodySchema: {
      "?network": "Query param: 'celo-sepolia' (default) or 'celo-mainnet'",
    },
    exampleBody: { message: "Hello from my agent" },
    notes: [
      "This is the simplest demo — verifies your agent's identity and returns credentials.",
      "Replay protection is enabled: each signature can only be used once.",
    ],
  });
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get(HEADERS.SIGNATURE);
  const timestamp = req.headers.get(HEADERS.TIMESTAMP);
  const keytype = req.headers.get(HEADERS.KEYTYPE) ?? undefined;
  const agentKey = req.headers.get(HEADERS.KEY) ?? undefined;

  if (!signature || !timestamp) {
    return NextResponse.json(
      { valid: false, error: "Missing agent authentication headers" },
      { status: 401 },
    );
  }

  try {
    const verifier = getCachedVerifier(resolveNetwork(req), {
      maxAgentsPerHuman: 0, // disable sybil check for demo
      includeCredentials: true,
      enableReplayProtection: true,
    });

    const body = await req.text();

    const result = await verifier.verify({
      signature,
      timestamp,
      method: "POST",
      url: req.url,
      body: body || undefined,
      keytype,
      agentKey,
    });

    if (result.valid) {
      const replay = await checkAndRecordReplay({
        signature,
        timestamp,
        method: "POST",
        url: req.url,
        body: body || undefined,
        scope: "demo-verify",
      });
      if (!replay.ok) {
        return NextResponse.json(
          { valid: false, error: replay.error || "Replay detected" },
          { status: 409 },
        );
      }
    }

    if (result.valid) verificationCount++;

    // Convert BigInt values to strings for JSON serialization
    return NextResponse.json({
      valid: result.valid,
      agentAddress: result.agentAddress,
      agentKey: result.agentKey,
      agentId: result.agentId.toString(),
      agentCount: result.agentCount.toString(),
      verificationCount,
      credentials: result.credentials
        ? {
            ...result.credentials,
            olderThan: result.credentials.olderThan.toString(),
          }
        : undefined,
      error: result.error,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Internal verification error";
    return NextResponse.json({ valid: false, error: message }, { status: 500 });
  }
}
