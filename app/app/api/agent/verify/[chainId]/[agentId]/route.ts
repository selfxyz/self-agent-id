// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { getProviderLabel } from "@selfxyz/agent-sdk";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import {
  CORS_HEADERS,
  corsResponse,
  errorResponse,
  validateAgentId,
} from "@/lib/api-helpers";

import { typedProvider, typedRegistry } from "@/lib/contract-types";
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const { chainId, agentId } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);

  const id = validateAgentId(agentId);
  if (id === null) return errorResponse("Invalid agent ID", 400);

  try {
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, rpc);

    // Fetch verification data in parallel
    const [hasProof, providerAddr, nullifier, selfProvider] = await Promise.all(
      [
        registry.hasHumanProof(id),
        registry.getProofProvider(id),
        registry.getHumanNullifier(id),
        registry.selfProofProvider(),
      ],
    );

    if (!hasProof) {
      return NextResponse.json(
        {
          agentId: Number(id),
          chainId: Number(chainId),
          isVerified: false,
          proofProvider: ethers.ZeroAddress,
          isSelfProvider: false,
          verificationStrength: 0,
          strengthLabel: "None",
          humanNullifier: "0",
          agentCountForHuman: 0,
        },
        { headers: CORS_HEADERS },
      );
    }

    // Fetch provider strength and agent count in parallel
    const provider = typedProvider(providerAddr, rpc);
    const [strength, agentCount] = await Promise.all([
      provider.verificationStrength(),
      nullifier !== 0n
        ? registry.getAgentCountForHuman(nullifier)
        : Promise.resolve(0n),
    ]);

    const verificationStrength = Number(strength);
    const isSelfProvider =
      providerAddr.toLowerCase() === selfProvider.toLowerCase();

    return NextResponse.json(
      {
        agentId: Number(id),
        chainId: Number(chainId),
        isVerified: true,
        proofProvider: providerAddr,
        isSelfProvider,
        verificationStrength,
        strengthLabel: getProviderLabel(verificationStrength),
        humanNullifier: nullifier.toString(),
        agentCountForHuman: Number(agentCount),
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
