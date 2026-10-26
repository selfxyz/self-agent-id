// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/verify/{chainId}/{agentId} — proof-of-human and sybil view.
 *
 * Auth: none. Rate limit: 120/min per IP (shared read budget).
 * Returns proof state, provider strength, the human nullifier and how many
 * agents that human holds.
 */

import type { NextRequest } from "next/server";
import { corsResponse, jsonResponse } from "@/lib/agent-api-helpers";
import {
  connectRegistry,
  parseAgentTarget,
  readAgentState,
  readErrorResponse,
  readProviderStrength,
  readRateLimited,
} from "@/lib/agent-read";

/**
 * Read an agent's proof state plus its human's nullifier and agent count.
 *
 * @param req - Incoming request (counted against the per-IP read budget).
 * @param context.params - Path params: `chainId`, `agentId`.
 * @returns 200 {agentId, chainId, isVerified, hasHumanProof, isProofFresh,
 *   proofExpiresAt, proofProvider, isSelfProvider, verificationStrength,
 *   strengthLabel, humanNullifier, agentCountForHuman}; 400 {error} bad chain
 *   or agent ID; 404 {error} agent not found;
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
    const [state, nullifier, selfProvider] = await Promise.all([
      readAgentState(registry, target),
      registry.getHumanNullifier(target.agentId),
      registry.selfProofProvider(),
    ]);
    const [strength, agentCount] = await Promise.all([
      readProviderStrength(rpc, state.proofProvider),
      nullifier !== 0n ? registry.getAgentCountForHuman(nullifier) : 0n,
    ]);

    return jsonResponse({
      agentId: state.agentId,
      chainId: state.chainId,
      isVerified: state.isVerified,
      hasHumanProof: state.hasHumanProof,
      isProofFresh: state.isProofFresh,
      proofExpiresAt: state.proofExpiresAt,
      proofProvider: state.proofProvider,
      isSelfProvider:
        state.proofProvider.toLowerCase() === selfProvider.toLowerCase(),
      ...strength,
      humanNullifier: nullifier.toString(),
      agentCountForHuman: Number(agentCount),
    });
  } catch (err) {
    return readErrorResponse(err, "agent/verify");
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
