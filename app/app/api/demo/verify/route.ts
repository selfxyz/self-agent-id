// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { HEADERS } from "@selfxyz/agent-sdk";
import { NETWORKS, type NetworkId } from "@/lib/network";
import { getCachedVerifier } from "@/lib/selfVerifier";
import { checkAndRecordReplay } from "@/lib/replayGuard";

// In-memory verification counter (resets on server restart — fine for demo)
let verificationCount = 0;

function resolveNetwork(req: NextRequest): NetworkId {
  const param = req.nextUrl.searchParams.get("network");
  if (param && param in NETWORKS) return param as NetworkId;
  return "celo-sepolia";
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get(HEADERS.SIGNATURE);
  const timestamp = req.headers.get(HEADERS.TIMESTAMP);

  if (!signature || !timestamp) {
    return NextResponse.json(
      { valid: false, error: "Missing agent authentication headers" },
      { status: 401 },
    );
  }

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
}
