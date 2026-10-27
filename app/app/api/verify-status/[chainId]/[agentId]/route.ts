// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/verify-status/{chainId}/{agentId} — compact proof status.
 *
 * Auth: none. Rate limit: 120/min per IP (shared read budget).
 * Returns verified (= hasHumanProof && isProofFresh), expiry, proof type and
 * provider.
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
 * Read an agent's proof state in compact form.
 *
 * @param req - Incoming request (counted against the per-IP read budget).
 * @param context.params - Path params: `chainId`, `agentId`.
 * @returns 200 {verified, hasHumanProof, isProofFresh, proofExpiresAt,
 *   proofType, registeredAtBlock, providerAddress}; 400 {error} bad chain or
 *   agent ID; 404 {error} agent not found;
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
    const state = await readAgentState(registry, target);
    const { strengthLabel } = await readProviderStrength(
      rpc,
      state.proofProvider,
    );

    return jsonResponse({
      verified: state.isVerified,
      hasHumanProof: state.hasHumanProof,
      isProofFresh: state.isProofFresh,
      proofExpiresAt: state.proofExpiresAt,
      proofType: strengthLabel,
      registeredAtBlock: state.registeredAtBlock,
      providerAddress: state.proofProvider,
    });
  } catch (err) {
    return readErrorResponse(err, "verify-status");
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
