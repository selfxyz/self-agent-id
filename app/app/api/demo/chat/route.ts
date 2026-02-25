// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { HEADERS } from "@selfxyz/agent-sdk";
import { NETWORKS, type NetworkId } from "@/lib/network";
import { getCachedVerifier } from "@/lib/selfVerifier";
import { checkAndRecordReplay } from "@/lib/replayGuard";

const LANGCHAIN_URL = process.env.LANGCHAIN_URL || "http://127.0.0.1:8090";

function resolveNetwork(req: NextRequest): NetworkId {
  const param = req.nextUrl.searchParams.get("network");
  if (param && param in NETWORKS) return param as NetworkId;
  return "celo-sepolia";
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  let parsed: { query?: string; session_id?: string } = {};
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const networkId = resolveNetwork(req);

  const signature = req.headers.get(HEADERS.SIGNATURE);
  const timestamp = req.headers.get(HEADERS.TIMESTAMP);
  let agentAddress = "anonymous";

  // Signed requests are cryptographically verified.
  // Unsigned requests are treated as anonymous (LangChain hard-refuses).
  if (signature || timestamp) {
    if (!signature || !timestamp) {
      return NextResponse.json(
        { error: "Both signature and timestamp headers are required" },
        { status: 401 },
      );
    }

    const verifier = getCachedVerifier(networkId, {
      maxAgentsPerHuman: 0,
      includeCredentials: false,
      enableReplayProtection: true,
    });

    const result = await verifier.verify({
      signature,
      timestamp,
      method: "POST",
      url: req.url,
      body: body || undefined,
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
      body: body || undefined,
      scope: "demo-chat",
    });
    if (!replay.ok) {
      return NextResponse.json(
        { error: replay.error || "Replay detected" },
        { status: 409 },
      );
    }

    agentAddress = result.agentAddress;
  }

  try {
    const langchainRes = await fetch(`${LANGCHAIN_URL}/agent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: parsed.query || "",
        agent_address: agentAddress,
        network: networkId,
        session_id: parsed.session_id || "unknown",
      }),
    });

    if (!langchainRes.ok) {
      const errText = await langchainRes.text();
      let detail = errText;
      try {
        const errJson = JSON.parse(errText);
        detail = errJson.detail || errText;
      } catch { /* plain text */ }
      return NextResponse.json({ error: detail }, { status: langchainRes.status });
    }

    const data = await langchainRes.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "LangChain service unavailable" },
      { status: 503 },
    );
  }
}
