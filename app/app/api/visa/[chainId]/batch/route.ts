// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/visa/{chainId}/batch?agents=1,2,3 — visa tiers for many agents.
 *
 * Auth: none. Rate limit: 60/min per IP (counted after validation).
 * Returns {agents: [{agentId, tier, tierName}]}; at most 100 IDs, duplicates
 * collapsed, any invalid ID is a 400.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import {
  ERRORS,
  corsResponse,
  errorResponse,
  getClientIp,
  jsonResponse,
  rateLimitResponse,
  validateAgentId,
} from "@/lib/agent-api-helpers";
import { typedVisa } from "@/lib/contract-types";
import { checkRateLimit } from "@/lib/rate-limit";
import { TIER_NAMES } from "@/lib/visa-auth";

/** Most agent IDs accepted in one batch. */
const MAX_AGENTS = 100;
/** Parallel getTier calls per wave. */
const RPC_CONCURRENCY = 25;

/**
 * Read the visa tier of each requested agent.
 *
 * @param req - Request with `agents` (comma-separated decimal IDs).
 * @param context.params - Path params: `chainId` (must have a visa
 *   contract).
 * @returns 200 {agents: [{agentId, tier, tierName}]}; 400 {error} bad chain,
 *   missing/too many/invalid IDs; 429 {error, retryAfterMs}; 502 {error} RPC
 *   failure.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string }> },
) {
  const { chainId } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config?.visa) return errorResponse(ERRORS.unsupportedChain, 400);

  const agentsParam = req.nextUrl.searchParams.get("agents");
  if (!agentsParam)
    return errorResponse("Missing ?agents= query parameter", 400);

  const raw = agentsParam.split(",").map((s) => s.trim());
  if (raw.length > MAX_AGENTS)
    return errorResponse(`Max ${MAX_AGENTS} agents per batch`, 400);
  const ids = new Map<string, bigint>();
  for (const s of raw) {
    const id = validateAgentId(s);
    if (id === null)
      return errorResponse(`${ERRORS.invalidAgentId}: ${s.slice(0, 80)}`, 400);
    ids.set(id.toString(), id);
  }

  const rl = await checkRateLimit({
    key: `visa-batch:${getClientIp(req)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  try {
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const visa = typedVisa(config.visa, rpc);
    const list = [...ids.values()];
    const agents = [];
    for (let i = 0; i < list.length; i += RPC_CONCURRENCY) {
      agents.push(
        ...(await Promise.all(
          list.slice(i, i + RPC_CONCURRENCY).map(async (id) => {
            const tier = Number(await visa.getTier(id));
            return {
              agentId: id.toString(),
              tier,
              tierName: TIER_NAMES[tier] ?? `Tier ${tier}`,
            };
          }),
        )),
      );
    }

    return jsonResponse({ agents });
  } catch (err) {
    console.error("[visa/batch] read failed:", err);
    return errorResponse(ERRORS.rpc, 502);
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
