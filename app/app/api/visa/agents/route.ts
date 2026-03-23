// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /api/visa/agents?wallet=0x...&chainId=11142220
//
// Returns agent IDs (both registry-based and wallet-based) for a given wallet.
// Runs server-side to avoid browser RPC block-range limits on eth_getLogs.

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { REGISTRY_ABI, VISA_ABI } from "@/lib/constants";
import { CORS_HEADERS, corsResponse, errorResponse } from "@/lib/api-helpers";

interface AgentResult {
  agentId: string;
  chainId: number;
  isWalletBased?: boolean;
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  const chainId = req.nextUrl.searchParams.get("chainId");

  if (!wallet || !chainId) {
    return errorResponse("wallet and chainId are required", 400);
  }

  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);
  if (!config.visa) return errorResponse("Visa not deployed on this chain", 404);

  const agents: AgentResult[] = [];
  const provider = new ethers.JsonRpcProvider(config.rpc);
  const registry = new ethers.Contract(config.registry, REGISTRY_ABI, provider);

  // Find registry-based agents via Transfer events
  const scanFrom = config.visaDeployBlock > 0
    ? config.visaDeployBlock
    : config.registryDeployBlock;
  let registryError = "";
  try {
    const filter = registry.filters.Transfer(null, wallet);
    const events = await registry.queryFilter(filter, scanFrom);
    for (const event of events) {
      const tokenId = (event as ethers.EventLog).args?.[2] as bigint | undefined;
      if (tokenId && BigInt(tokenId) > 0n) {
        agents.push({
          agentId: BigInt(tokenId).toString(),
          chainId: Number(chainId),
        });
      }
    }
  } catch (err) {
    registryError = err instanceof Error ? err.message : String(err);
  }

  // Check for wallet-based Tourist visa
  const walletAgentId = BigInt(ethers.getAddress(wallet)).toString();
  try {
    const visa = new ethers.Contract(config.visa, VISA_ABI, provider);
    const tier = Number(await visa.getTier(BigInt(walletAgentId)));
    if (tier > 0) {
      const exists = agents.some((a) => a.agentId === walletAgentId);
      if (!exists) {
        agents.push({
          agentId: walletAgentId,
          chainId: Number(chainId),
          isWalletBased: true,
        });
      }
    }
  } catch {
    // No wallet visa
  }

  return Response.json({
    agents,
    debug: {
      chainId,
      wallet,
      rpc: config.rpc.slice(0, 50),
      registry: config.registry,
      scanFrom,
      registryError: registryError || null,
    },
  }, { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return corsResponse();
}
