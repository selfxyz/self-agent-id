// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/visa/agents?wallet=0x...&chainId=... — visa agent IDs a wallet can
 * act for.
 *
 * Auth: none. Rate limit: 20/min per IP (shared scan budget).
 * Returns registry agents the wallet owns (same Multicall3 walk as
 * /api/agent/agents) or whose key it is, plus its wallet-based ID
 * (uint160(wallet)) if that holds a visa. `complete` is false if the walk
 * could not account for every agent balanceOf reports.
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
  readRateLimited,
  scanAgentIds,
} from "@/lib/agent-read";
import { typedVisa } from "@/lib/contract-types";

/** Vercel function timeout (s): the ID walk can take several RPC round trips. */
export const maxDuration = 30;

/** One agent ID the wallet can act for. */
interface AgentResult {
  agentId: string;
  chainId: number;
  isWalletBased?: boolean;
}

/**
 * List the agent IDs a wallet owns, is the key of, or holds a wallet-based
 * visa under.
 *
 * @param req - Query: `wallet` (strict 0x address, non-zero), `chainId`
 *   (must have a visa contract).
 * @returns 200 {agents: [{agentId, chainId, isWalletBased?}], complete};
 *   400 {error} missing params, bad chain or address; 429 {error,
 *   retryAfterMs}; 502 {error} RPC failure.
 */
export async function GET(req: NextRequest) {
  const limited = await readRateLimited(req, "scan");
  if (limited) return limited;

  const walletParam = req.nextUrl.searchParams.get("wallet");
  const chainId = req.nextUrl.searchParams.get("chainId");
  if (!walletParam || !chainId) {
    return errorResponse("wallet and chainId are required", 400);
  }
  const config = CHAIN_CONFIG[chainId];
  if (!config?.visa) return errorResponse(ERRORS.unsupportedChain, 400);
  const wallet = parseAddress(walletParam);
  if (!wallet) return errorResponse(ERRORS.invalidAddress, 400);

  try {
    const { rpc, registry } = connectRegistry(Number(chainId), config);
    const visa = typedVisa(config.visa, rpc);
    const walletAgentId = BigInt(wallet);

    const [keyAgentId, balance, walletTier] = await Promise.all([
      registry.getAgentId(ethers.zeroPadValue(wallet, 32)),
      registry.balanceOf(wallet),
      visa.getTier(walletAgentId),
    ]);
    const owned =
      balance > 0n
        ? await scanAgentIds(
            rpc,
            config.registry,
            "ownerOf",
            wallet,
            Number(balance),
          )
        : [];
    const ids = [...new Set([...owned, keyAgentId].filter((id) => id !== 0n))];
    ids.sort((a, b) => (a < b ? -1 : 1));

    const agents: AgentResult[] = ids.map((id) => ({
      agentId: id.toString(),
      chainId: Number(chainId),
    }));
    if (Number(walletTier) > 0 && !ids.includes(walletAgentId)) {
      agents.push({
        agentId: walletAgentId.toString(),
        chainId: Number(chainId),
        isWalletBased: true,
      });
    }

    return jsonResponse({
      agents,
      complete: owned.length === Number(balance),
    });
  } catch (err) {
    console.error("[visa/agents] lookup failed:", err);
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
