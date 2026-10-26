// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/info/{chainId}/{agentId} — full on-chain details of an agent.
 *
 * Auth: none. Rate limit: 120/min per IP (shared read budget).
 * Returns proof state, agent key/address, provider strength, disclosed
 * credentials and network.
 */

import type { NextRequest } from "next/server";
import {
  corsResponse,
  jsonResponse,
  networkForChainId,
} from "@/lib/agent-api-helpers";
import {
  connectRegistry,
  parseAgentTarget,
  publicCredentials,
  readAgentState,
  readErrorResponse,
  readProviderStrength,
  readRateLimited,
} from "@/lib/agent-read";

/**
 * Read an agent's state, provider strength and credentials.
 *
 * @param req - Incoming request (counted against the per-IP read budget).
 * @param context.params - Path params: `chainId`, `agentId`.
 * @returns 200 {agentId, chainId, agentKey, agentAddress, isVerified,
 *   hasHumanProof, isProofFresh, proofExpiresAt, proofProvider,
 *   registeredAtBlock, verificationStrength, strengthLabel, credentials,
 *   network}; 400 {error} bad chain or agent ID; 404 {error} agent not found;
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
    const [state, credentials] = await Promise.all([
      readAgentState(registry, target),
      registry.getAgentCredentials(target.agentId),
    ]);
    const strength = state.hasHumanProof
      ? await readProviderStrength(rpc, state.proofProvider)
      : { verificationStrength: 0, strengthLabel: "None" };

    return jsonResponse({
      ...state,
      ...strength,
      credentials: publicCredentials(credentials),
      network: networkForChainId(target.chainId),
    });
  } catch (err) {
    return readErrorResponse(err, "agent/info");
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
