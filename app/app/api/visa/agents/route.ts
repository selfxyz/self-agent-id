// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /api/visa/agents?wallet=0x...&chainId=11142220
//
// Returns agent IDs (both registry-based and wallet-based) for a given wallet.
// Uses a two-tier approach:
//   1. Fast path: direct contract call for simple-mode agents (no event scanning)
//   2. Slow path: paginated Transfer event scan using Forno (Celo's public RPC
//      which allows large block ranges, unlike Alchemy free tier's 10-block limit)

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { REGISTRY_ABI, VISA_ABI } from "@/lib/constants";
import { CORS_HEADERS, corsResponse, errorResponse } from "@/lib/api-helpers";

// Allow up to 30s for event queries
export const maxDuration = 30;

interface AgentResult {
  agentId: string;
  chainId: number;
  isWalletBased?: boolean;
}

/** Forno RPC URLs for event scanning (supports large block ranges unlike Alchemy free tier) */
const FORNO_RPC: Record<string, string> = {
  "42220": "https://forno.celo.org",
  "11142220": "https://forno.celo-sepolia.celo-testnet.org",
};

/**
 * Paginated queryFilter with adaptive block windows.
 * Starts at 500K blocks and halves on block-range errors.
 */
async function paginatedQueryFilter(
  contract: ethers.Contract,
  filter: ethers.ContractEventName,
  provider: ethers.JsonRpcProvider,
  fromBlockFloor: number,
): Promise<(ethers.EventLog | ethers.Log)[]> {
  const latestBlock = await provider.getBlockNumber();
  const deployBlock = fromBlockFloor > 0 ? fromBlockFloor : 0;
  let blockWindow = 500_000;
  const MIN_WINDOW = 1_000;
  const MAX_ITERATIONS = 100;
  const allEvents: (ethers.EventLog | ethers.Log)[] = [];

  let toBlock = latestBlock;
  let iterations = 0;
  while (toBlock >= deployBlock && iterations < MAX_ITERATIONS) {
    iterations++;
    const fromBlock = Math.max(deployBlock, toBlock - blockWindow + 1);
    try {
      const events = await contract.queryFilter(filter, fromBlock, toBlock);
      allEvents.push(...events);
      toBlock = fromBlock - 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        (msg.includes("block range") ||
          msg.includes("Log response size exceeded") ||
          msg.includes("query returned more than")) &&
        blockWindow > MIN_WINDOW
      ) {
        blockWindow = Math.max(MIN_WINDOW, Math.floor(blockWindow / 2));
        continue;
      }
      throw err;
    }
  }

  return allEvents;
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  const chainId = req.nextUrl.searchParams.get("chainId");

  if (!wallet || !chainId) {
    return errorResponse("wallet and chainId are required", 400);
  }

  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);
  if (!config.visa)
    return errorResponse("Visa not deployed on this chain", 404);

  const agents: AgentResult[] = [];
  // Use configured RPC for simple calls (balanceOf, ownerOf, getTier)
  const provider = new ethers.JsonRpcProvider(config.rpc);
  const registry = new ethers.Contract(config.registry, REGISTRY_ABI, provider);

  // ── Fast path: check for simple-mode agent (zeroPadValue(address, 32)) ──
  // This is a single contract call — no event scanning needed.
  try {
    const simpleKey = ethers.zeroPadValue(wallet, 32);
    const simpleAgentId: bigint = await registry.getAgentId(simpleKey);
    if (simpleAgentId !== 0n) {
      const owner: string = await registry.ownerOf(simpleAgentId);
      if (owner.toLowerCase() === wallet.toLowerCase()) {
        agents.push({
          agentId: simpleAgentId.toString(),
          chainId: Number(chainId),
        });
      }
    }
  } catch {
    // No simple-mode agent
  }

  // ── Slow path: scan Transfer events for advanced-mode agents ──
  // Only needed if wallet owns more registry tokens than we found above.
  let registryBalance = 0n;
  try {
    registryBalance = await registry.balanceOf(wallet);
  } catch {
    registryBalance = -1n; // unknown — must scan
  }

  if (registryBalance > BigInt(agents.length)) {
    // Use Forno for event scanning — Alchemy free tier limits eth_getLogs to 10-block ranges
    const fornoUrl = FORNO_RPC[chainId];
    const scanProvider = fornoUrl
      ? new ethers.JsonRpcProvider(fornoUrl)
      : provider;
    const scanRegistry = fornoUrl
      ? new ethers.Contract(config.registry, REGISTRY_ABI, scanProvider)
      : registry;

    try {
      const filter = scanRegistry.filters.Transfer(null, wallet);
      const events = await paginatedQueryFilter(
        scanRegistry,
        filter,
        scanProvider,
        config.registryDeployBlock,
      );
      const seen = new Set(agents.map((a) => a.agentId));
      for (const event of events) {
        const tokenId = (event as ethers.EventLog).args?.[2] as
          | bigint
          | undefined;
        if (tokenId && BigInt(tokenId) > 0n) {
          const id = BigInt(tokenId).toString();
          if (seen.has(id)) continue;
          try {
            const owner: string = await registry.ownerOf(tokenId);
            if (owner.toLowerCase() !== wallet.toLowerCase()) continue;
          } catch {
            continue;
          }
          seen.add(id);
          agents.push({ agentId: id, chainId: Number(chainId) });
        }
      }
    } catch {
      // Skip — wallet-based check below still runs
    }
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

  return Response.json({ agents }, { headers: CORS_HEADERS });
}

export function OPTIONS() {
  return corsResponse();
}
