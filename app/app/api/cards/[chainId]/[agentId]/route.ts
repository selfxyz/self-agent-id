// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/cards/{chainId}/{agentId} — ERC-8004 / A2A card of one agent.
 *
 * Auth: none. Rate limit: 120/min per IP (shared read budget).
 * Returns the agent card JSON (cacheable for 60 s).
 */

import type { NextRequest } from "next/server";
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
 * Build the agent card from on-chain state.
 *
 * @param req - Incoming request (counted against the per-IP read budget).
 * @param context.params - Path params: `chainId`, `agentId`.
 * @returns 200 agent card; 400 {error} bad chain or agent ID; 404 {error}
 *   agent not found;
 *   429 {error, retryAfterMs}; 502 {error} RPC failure.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const limited = await readRateLimited(req);
  if (limited) return limited;
  const { chainId, agentId } = await params;
  const parsed = parseAgentTarget(chainId, agentId);
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
    return readErrorResponse(err, "cards");
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
