// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/agents-by-nullifier/{chainId}/{nullifier} — active agents of
 * one human.
 *
 * Auth: none. Rate limit: 20/min per IP (shared scan budget).
 * Returns the agents plus `activeAgentCount` (the contract's own counter).
 * The contract's nullifier index misses agents minted before it was added, so
 * when it is short we fall back to a Multicall3 walk over agent ids;
 * `complete` says whether the list matches the on-chain count.
 */

import type { NextRequest } from "next/server";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import {
  ERRORS,
  corsResponse,
  errorResponse,
  jsonResponse,
  validateAgentId,
} from "@/lib/agent-api-helpers";
import {
  connectRegistry,
  readAgentState,
  readErrorResponse,
  readRateLimited,
  scanAgentIds,
} from "@/lib/agent-read";

/** Page size for getAgentsForNullifier reads. */
const INDEX_PAGE = 100n;

/**
 * List the active agents registered under one human nullifier.
 *
 * @param req - Incoming request (counted against the per-IP scan budget).
 * @param context.params - Path params: `chainId`, `nullifier` (positive
 *   decimal).
 * @returns 200 {nullifier, chainId, agents: [{agentId, agentKey,
 *   agentAddress, isVerified, hasHumanProof, isProofFresh, proofExpiresAt}],
 *   totalCount, activeAgentCount, complete}; 400 {error} bad chain or
 *   nullifier; 429 {error, retryAfterMs}; 502 {error} RPC failure.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; nullifier: string }> },
) {
  const limited = await readRateLimited(req, "scan");
  if (limited) return limited;
  const { chainId, nullifier } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(ERRORS.unsupportedChain, 400);

  // Nullifiers share the agent-id format: canonical decimal, 1..2^256-1.
  const n = validateAgentId(nullifier);
  if (n === null) {
    return errorResponse(
      "Invalid nullifier: must be a positive decimal integer",
      400,
    );
  }

  try {
    const { rpc, registry } = connectRegistry(Number(chainId), config);
    const activeCount = Number(await registry.getAgentCountForHuman(n));

    let ids: bigint[] = [];
    for (let offset = 0n; activeCount > 0; offset += INDEX_PAGE) {
      const page = await registry.getAgentsForNullifier(n, offset, INDEX_PAGE);
      ids.push(...page);
      if (BigInt(page.length) < INDEX_PAGE) break;
    }
    if (ids.length < activeCount) {
      ids = await scanAgentIds(
        rpc,
        config.registry,
        "getHumanNullifier",
        n,
        activeCount,
      );
    }
    ids.sort((a, b) => (a < b ? -1 : 1));

    const agents = await Promise.all(
      ids.map(async (agentId) => {
        const state = await readAgentState(registry, {
          chainId: Number(chainId),
          config,
          agentId,
        });
        return {
          agentId: state.agentId,
          agentKey: state.agentKey,
          agentAddress: state.agentAddress,
          isVerified: state.isVerified,
          hasHumanProof: state.hasHumanProof,
          isProofFresh: state.isProofFresh,
          proofExpiresAt: state.proofExpiresAt,
        };
      }),
    );

    return jsonResponse({
      nullifier: n.toString(),
      chainId: Number(chainId),
      agents,
      totalCount: agents.length,
      activeAgentCount: activeCount,
      complete: agents.length === activeCount,
    });
  } catch (err) {
    return readErrorResponse(err, "agents-by-nullifier");
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
