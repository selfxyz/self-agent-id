// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { HEADERS } from "@selfxyz/agent-sdk";
import { NETWORKS, type NetworkId } from "@/lib/network";
import { getCachedVerifier } from "@/lib/selfVerifier";
import { checkAndRecordReplay } from "@/lib/replayGuard";
import { demoEndpointDocs } from "@/lib/demo-docs";

const LANGCHAIN_URL = process.env.LANGCHAIN_URL || "http://127.0.0.1:8090";

function resolveNetwork(req: NextRequest): NetworkId {
  const param = req.nextUrl.searchParams.get("network");
  if (param && param in NETWORKS) return param as NetworkId;
  return "celo-sepolia";
}

export function GET() {
  return demoEndpointDocs({
    endpoint: "/api/demo/chat",
    method: "POST",
    description:
      "AI Agent Chat demo. Proxies your query to a LangChain-powered AI agent that verifies your on-chain identity before engaging in conversation. Supports both signed (verified) and unsigned (anonymous) requests.",
    requiredHeaders: {
      "x-self-agent-signature":
        "HMAC signature (optional — unsigned requests treated as anonymous)",
      "x-self-agent-timestamp":
        "ISO 8601 timestamp (required if signature is present)",
    },
    optionalHeaders: {
      "x-self-agent-keytype": "Key type: 'ed25519' or omit for ECDSA",
      "x-self-agent-key": "Agent public key (required for Ed25519)",
    },
    bodySchema: {
      "query?": "string — your message to the AI agent",
      "session_id?": "string — session ID for conversation continuity",
      "?network": "Query param: 'celo-sepolia' (default) or 'celo-mainnet'",
    },
    exampleBody: {
      query: "Hello, I am a verified agent. What can you tell me?",
      session_id: "my-session-123",
    },
    notes: [
      "Requires LANGCHAIN_URL server env var pointing to the LangChain agent service.",
      "Unsigned requests are treated as anonymous — the AI may refuse to engage.",
      "Signed requests are cryptographically verified on-chain before the AI responds.",
    ],
  });
}

export async function POST(req: NextRequest) {
  const body = await req.text();
  let parsed: { query?: string; session_id?: string } = {};
  try {
    const raw = JSON.parse(body || "{}") as unknown;
    if (raw && typeof raw === "object") {
      const obj = raw as Record<string, unknown>;
      parsed = {
        query: typeof obj.query === "string" ? obj.query : undefined,
        session_id:
          typeof obj.session_id === "string" ? obj.session_id : undefined,
      };
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const networkId = resolveNetwork(req);

  const signature = req.headers.get(HEADERS.SIGNATURE);
  const timestamp = req.headers.get(HEADERS.TIMESTAMP);
  const keytype = req.headers.get(HEADERS.KEYTYPE) ?? undefined;
  const agentKeyHeader = req.headers.get(HEADERS.KEY) ?? undefined;
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
      keytype,
      agentKey: agentKeyHeader,
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
        const errJson = JSON.parse(errText) as unknown;
        if (
          typeof errJson === "object" &&
          errJson !== null &&
          "detail" in errJson &&
          typeof errJson.detail === "string" &&
          errJson.detail
        ) {
          detail = errJson.detail;
        }
      } catch {
        /* plain text */
      }
      return NextResponse.json(
        { error: detail },
        { status: langchainRes.status },
      );
    }

    const data = (await langchainRes.json()) as unknown;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(
      { error: "LangChain service unavailable" },
      { status: 503 },
    );
  }
}
