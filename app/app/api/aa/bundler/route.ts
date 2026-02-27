// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { readTextBodyWithLimit } from "@/lib/http/body";
import { fetchWithTimeout, UpstreamTimeoutError } from "@/lib/http/fetch";
import { rateLimitedResponse } from "@/lib/http/response";
import {
  getClientIp,
  validateAllowedOrigin,
  verifyAaProxyToken,
} from "@/lib/aaProxyAuth";

const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY;

// Only allow chains we actually operate on
const ALLOWED_CHAINS = new Set(["42220", "11142220"]);
const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "eth_supportedEntryPoints",
  "eth_estimateUserOperationGas",
  "eth_sendUserOperation",
  "eth_getUserOperationReceipt",
  "eth_getUserOperationByHash",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
]);
const MAX_BODY_BYTES = 200_000;
const RATE_LIMIT_PER_MINUTE = Number(
  process.env.AA_PROXY_MAX_REQ_PER_MINUTE || 60,
);
const WINDOW_MS = 60_000;
const UPSTREAM_TIMEOUT_MS = Number(
  process.env.AA_PROXY_UPSTREAM_TIMEOUT_MS || 8000,
);

type JsonRpcRequest = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown[];
  id?: string | number | null;
};

function parseAndValidateRpc(
  body: string,
): { ok: true; req: JsonRpcRequest } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Batch requests are not supported" };
  }

  const req = parsed as JsonRpcRequest;
  if (req.jsonrpc !== "2.0" || typeof req.method !== "string") {
    return { ok: false, error: "Invalid JSON-RPC request" };
  }
  if (!ALLOWED_METHODS.has(req.method)) {
    return { ok: false, error: `Method not allowed: ${req.method}` };
  }
  if (req.params !== undefined && !Array.isArray(req.params)) {
    return { ok: false, error: "Invalid params" };
  }
  return { ok: true, req };
}

export async function POST(req: NextRequest) {
  if (!PIMLICO_API_KEY) {
    return NextResponse.json(
      { error: "Bundler not configured" },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(req.url);
  const chainId = searchParams.get("chainId");
  if (!chainId || !ALLOWED_CHAINS.has(chainId)) {
    return NextResponse.json(
      { error: "Unsupported or missing chain" },
      { status: 400 },
    );
  }

  const originCheck = validateAllowedOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json(
      { error: originCheck.error || "Origin check failed" },
      { status: 403 },
    );
  }

  const token = req.headers.get("x-aa-proxy-token");
  if (!token) {
    return NextResponse.json(
      { error: "Missing AA proxy token" },
      { status: 401 },
    );
  }
  const tokenCheck = verifyAaProxyToken(req, token, chainId);
  if (!tokenCheck.ok) {
    return NextResponse.json(
      { error: tokenCheck.error || "Invalid AA token" },
      { status: 401 },
    );
  }

  const ip = getClientIp(req);
  const limit = await checkRateLimit({
    key: `aa:bundler:${chainId}:${ip}`,
    limit: RATE_LIMIT_PER_MINUTE,
    windowMs: WINDOW_MS,
  });
  if (!limit.allowed) {
    return rateLimitedResponse(
      {
        error: "Rate limit exceeded",
        retryAfterMs: limit.retryAfterMs,
      },
      limit.retryAfterMs,
    );
  }

  const bodyResult = await readTextBodyWithLimit(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }
  const body = bodyResult.body;

  const rpcCheck = parseAndValidateRpc(body);
  if (!rpcCheck.ok) {
    return NextResponse.json({ error: rpcCheck.error }, { status: 400 });
  }

  const pimlicoUrl = `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${PIMLICO_API_KEY}`;

  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(
      pimlicoUrl,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
      UPSTREAM_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof UpstreamTimeoutError) {
      return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
    }
    return NextResponse.json(
      { error: "Upstream request failed" },
      { status: 502 },
    );
  }

  const data = await upstream.text();
  return new NextResponse(data, {
    status: upstream.status,
    headers: { "Content-Type": "application/json" },
  });
}
