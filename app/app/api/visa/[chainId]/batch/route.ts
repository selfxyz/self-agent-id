// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { CORS_HEADERS, corsResponse, errorResponse } from "@/lib/api-helpers";
import { typedVisa } from "@/lib/contract-types";

const TIER_NAMES: Record<number, string> = {
  0: "None",
  1: "Tourist Visa",
  2: "Work Visa",
  3: "Citizenship",
};

/** GET /api/visa/:chainId/batch?agents=1,2,3 — fetch tiers for multiple agents in one RPC session */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string }> },
) {
  const { chainId } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);
  if (!config.visa) return errorResponse("Visa contract not deployed on this network", 404);

  const agentsParam = req.nextUrl.searchParams.get("agents");
  if (!agentsParam) return errorResponse("Missing ?agents= query parameter", 400);

  const agentIds = agentsParam.split(",").map((s) => {
    try { return BigInt(s.trim()); } catch { return null; }
  }).filter((id): id is bigint => id !== null && id > 0n);

  if (agentIds.length === 0) return errorResponse("No valid agent IDs", 400);
  if (agentIds.length > 100) return errorResponse("Max 100 agents per batch", 400);

  try {
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const visa = typedVisa(config.visa, rpc);

    const results = await Promise.all(
      agentIds.map(async (id) => {
        const tier = Number(await visa.getTier(id));
        return {
          agentId: Number(id),
          tier,
          tierName: TIER_NAMES[tier] ?? `Tier ${tier}`,
        };
      }),
    );

    return NextResponse.json({ agents: results }, { headers: CORS_HEADERS });
  } catch {
    return errorResponse("RPC error", 502);
  }
}

export function OPTIONS() {
  return corsResponse();
}
