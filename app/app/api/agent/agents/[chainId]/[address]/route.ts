// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { REGISTRY_ABI } from "@selfxyz/agent-sdk";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { CORS_HEADERS, corsResponse, errorResponse } from "@/lib/api-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; address: string }> },
) {
  const { chainId, address } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);

  // Validate Ethereum address
  if (!ethers.isAddress(address)) {
    return errorResponse("Invalid Ethereum address", 400);
  }

  const checksumAddress = ethers.getAddress(address);

  try {
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const registry = new ethers.Contract(config.registry, REGISTRY_ABI, rpc);

    // Derive agent key: simple mode = zeroPadValue(address, 32)
    const agentKey = ethers.zeroPadValue(checksumAddress, 32);

    // Check if this address has a directly registered agent
    const agentIdRaw: bigint = await registry.getAgentId(agentKey);
    const agentId = Number(agentIdRaw);

    if (agentId === 0) {
      return NextResponse.json(
        {
          humanAddress: checksumAddress,
          chainId: Number(chainId),
          agents: [],
          totalCount: 0,
        },
        { headers: CORS_HEADERS },
      );
    }

    // Agent exists — fetch its verification status and related info
    const [isVerified, nullifier] = await Promise.all([
      registry.hasHumanProof(agentIdRaw) as Promise<boolean>,
      registry.getHumanNullifier(agentIdRaw) as Promise<bigint>,
    ]);

    // Get total agent count for this human (same nullifier)
    let agentCount = 1;
    if (nullifier !== 0n) {
      const count: bigint = await registry.getAgentCountForHuman(nullifier);
      agentCount = Number(count);
    }

    return NextResponse.json(
      {
        humanAddress: checksumAddress,
        chainId: Number(chainId),
        agents: [
          {
            agentId,
            agentKey,
            agentAddress: checksumAddress,
            isVerified,
          },
        ],
        totalCount: agentCount,
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

export async function OPTIONS() {
  return corsResponse();
}
