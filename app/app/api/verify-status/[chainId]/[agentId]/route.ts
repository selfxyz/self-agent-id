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

    const [hasProof, providerAddr, registeredAtBlock] = await Promise.all([
      registry.hasHumanProof(id),
      registry.getProofProvider(id),
      registry.agentRegisteredAt(id),
    ]);

    if (!hasProof) {
      return NextResponse.json({ verified: false }, { headers: CORS_HEADERS });
    }

    const provider = typedProvider(providerAddr, rpc);
    const strength: number = await provider.verificationStrength();

    return NextResponse.json(
      {
        verified: true,
        proofType: getProviderLabel(Number(strength)),
        registeredAtBlock: registeredAtBlock.toString(),
        providerAddress: providerAddr,
      },
      { headers: CORS_HEADERS },
    );
  } catch {
    return errorResponse("Agent not found", 404);
  }
}

export function OPTIONS() {
  return corsResponse();
}
