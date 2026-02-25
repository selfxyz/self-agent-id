// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  REGISTRY_ABI,
  PROVIDER_ABI,
  getProviderLabel,
} from "@selfxyz/agent-sdk";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import {
  CORS_HEADERS,
  corsResponse,
  errorResponse,
  validateAgentId,
} from "@/lib/api-helpers";

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
    const registry = new ethers.Contract(config.registry, REGISTRY_ABI, rpc);

    const hasProof: boolean = await registry.hasHumanProof(id);
    if (!hasProof) {
      return NextResponse.json(
        { score: 0, hasProof: false },
        { headers: CORS_HEADERS },
      );
    }

    const providerAddr: string = await registry.getProofProvider(id);
    const provider = new ethers.Contract(providerAddr, PROVIDER_ABI, rpc);

    const [strength, providerName] = await Promise.all([
      provider.verificationStrength() as Promise<number>,
      provider.providerName() as Promise<string>,
    ]);

    const score = Number(strength);
    return NextResponse.json(
      {
        score,
        hasProof: true,
        providerName,
        proofType: getProviderLabel(score),
      },
      { headers: CORS_HEADERS },
    );
  } catch {
    return errorResponse("Agent not found", 404);
  }
}

export async function OPTIONS() {
  return corsResponse();
}
