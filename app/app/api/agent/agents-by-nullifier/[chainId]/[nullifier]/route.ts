// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { CORS_HEADERS, corsResponse, errorResponse } from "@/lib/api-helpers";

import { typedRegistry } from "@/lib/contract-types";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; nullifier: string }> },
) {
  const { chainId, nullifier } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);

  // Validate nullifier is a numeric string
  let nullifierBigInt: bigint;
  try {
    nullifierBigInt = BigInt(nullifier);
  } catch {
    return errorResponse("Invalid nullifier: must be a numeric value", 400);
  }

  try {
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, rpc);

    const agentIds: bigint[] =
      await registry.getAgentsForNullifier(nullifierBigInt);

    if (agentIds.length === 0) {
      return NextResponse.json(
        {
          nullifier,
          chainId: Number(chainId),
          agents: [],
          totalCount: 0,
        },
        { headers: CORS_HEADERS },
      );
    }

    // Fetch details for each agent in parallel
    const agents = await Promise.all(
      agentIds.map(async (agentIdRaw) => {
        const [isVerified, isProofFreshResult, proofExpiry, agentKey] =
          await Promise.all([
            registry.hasHumanProof(agentIdRaw),
            registry.isProofFresh(agentIdRaw),
            registry.proofExpiresAt(agentIdRaw),
            registry.agentIdToAgentKey(agentIdRaw),
          ]);
        return {
          agentId: Number(agentIdRaw),
          agentKey,
          isVerified,
          isProofFresh: isProofFreshResult,
          proofExpiresAt: Number(proofExpiry),
        };
      }),
    );

    return NextResponse.json(
      {
        nullifier,
        chainId: Number(chainId),
        agents,
        totalCount: agents.length,
      },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("could not coalesce") ||
      message.includes("BAD_DATA")
    ) {
      return errorResponse("Agent not found", 404);
    }
    return errorResponse("RPC error", 502);
  }
}

export function OPTIONS() {
  return corsResponse();
}
