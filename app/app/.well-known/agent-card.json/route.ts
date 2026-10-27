// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /.well-known/agent-card.json — A2A card of the registry or of one agent.
 *
 * Auth: none. Rate limit: none for the registry card; 120/min per IP (shared
 * read budget) with `agentId`.
 * Returns the card JSON; only successful responses are cacheable (60 s).
 */

import type { NextRequest } from "next/server";
import { DEFAULT_NETWORK, NETWORKS } from "@/lib/network";
import { getAgentCardJSON } from "@/lib/agent-discovery";
import {
  corsResponse,
  getAppBaseUrl,
  jsonResponse,
} from "@/lib/agent-api-helpers";
import {
  buildAgentCard,
  connectRegistry,
  parseAgentTarget,
  readErrorResponse,
  readRateLimited,
} from "@/lib/agent-read";

/**
 * Serve the registry card, or a per-agent card when `?agentId` is given.
 *
 * With `agentId` (and optional `chain` / `chainId`, default network
 * otherwise) the card matches /api/cards/{chainId}/{agentId}.
 *
 * @param req - Incoming request (query: `agentId`, `chain` / `chainId`).
 * @returns 200 card JSON; 400 {error} bad chain or agent ID; 404 {error} agent
 *   not found; 429 {error, retryAfterMs}; 502 {error} RPC failure.
 */
export async function GET(req: NextRequest) {
  const agentIdParam = req.nextUrl.searchParams.get("agentId");
  if (agentIdParam === null) {
    const res = jsonResponse({ ...getAgentCardJSON(getAppBaseUrl(req)) });
    res.headers.set("Cache-Control", "public, max-age=60");
    return res;
  }

  const limited = await readRateLimited(req);
  if (limited) return limited;
  const chainId =
    req.nextUrl.searchParams.get("chain") ??
    req.nextUrl.searchParams.get("chainId") ??
    String(NETWORKS[DEFAULT_NETWORK].chainId);
  const parsed = parseAgentTarget(chainId, agentIdParam);
  if (!parsed.ok) return parsed.response;
  const { target } = parsed;

  try {
    const { rpc, registry } = connectRegistry(target.chainId, target.config);
    const card = await buildAgentCard(
      rpc,
      registry,
      target,
      getAppBaseUrl(req),
    );
    const res = jsonResponse(card);
    res.headers.set("Cache-Control", "public, max-age=60");
    return res;
  } catch (err) {
    return readErrorResponse(err, "agent-card");
  }
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
