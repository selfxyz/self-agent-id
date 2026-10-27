// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/agents/{chainId}/{address} — agents related to a wallet.
 *
 * Auth: none. Rate limit: 20/min per IP (shared scan budget).
 * Returns every agent NFT the address owns (linked mode: the human's wallet
 * owns agents whose keys are separate addresses) plus the agent whose key IS
 * this address. The registry is not enumerable, so owned ids come from a
 * Multicall3 walk checked against balanceOf; `complete` is false if that walk
 * could not account for them all.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import {
  ERRORS,
  corsResponse,
  errorResponse,
  jsonResponse,
  parseAddress,
} from "@/lib/agent-api-helpers";
import {
  connectRegistry,
  readAgentState,
  readErrorResponse,
  readRateLimited,
  scanAgentIds,
} from "@/lib/agent-read";

/**
 * List the agents owned by, or keyed to, a wallet address.
 *
 * @param req - Incoming request (counted against the per-IP scan budget).
 * @param context.params - Path params: `chainId`, `address` (strict 0x + 40
 *   hex, non-zero).
 * @returns 200 {humanAddress, chainId, agents: [{agentId, agentKey,
 *   agentAddress, isOwner, isAgentKey, isVerified, hasHumanProof,
 *   isProofFresh, proofExpiresAt}], totalCount, ownedCount, complete};
 *   400 {error} bad chain or address; 429 {error, retryAfterMs};
 *   502 {error} RPC failure.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; address: string }> },
) {
  const limited = await readRateLimited(req, "scan");
  if (limited) return limited;
  const { chainId, address } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(ERRORS.unsupportedChain, 400);
  // Strict form only (0x + 40 hex, non-zero): balanceOf(0) reverts on-chain.
  const humanAddress = parseAddress(address);
  if (!humanAddress) return errorResponse(ERRORS.invalidAddress, 400);

  try {
    const { rpc, registry } = connectRegistry(Number(chainId), config);
    const [ownedCount, keyAgentId] = await Promise.all([
      registry.balanceOf(humanAddress),
      registry.getAgentId(ethers.zeroPadValue(humanAddress, 32)),
    ]);

    const owned =
      ownedCount > 0n
        ? await scanAgentIds(
            rpc,
            config.registry,
            "ownerOf",
            humanAddress,
            Number(ownedCount),
          )
        : [];
    const ids = [...new Set([...owned, keyAgentId].filter((id) => id !== 0n))];
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
          isOwner: owned.includes(agentId),
          isAgentKey: agentId === keyAgentId,
          isVerified: state.isVerified,
          hasHumanProof: state.hasHumanProof,
          isProofFresh: state.isProofFresh,
          proofExpiresAt: state.proofExpiresAt,
        };
      }),
    );

    return jsonResponse({
      humanAddress,
      chainId: Number(chainId),
      agents,
      totalCount: agents.length,
      ownedCount: Number(ownedCount),
      complete: owned.length === Number(ownedCount),
    });
  } catch (err) {
    return readErrorResponse(err, "agent/agents");
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
