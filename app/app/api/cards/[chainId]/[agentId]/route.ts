// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import {} from "@selfxyz/agent-sdk";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import {
  CORS_HEADERS,
  corsResponse,
  errorResponse,
  validateAgentId,
} from "@/lib/api-helpers";

import { typedRegistry } from "@/lib/contract-types";
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
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, provider);
    const raw: string = await registry.getAgentMetadata(id);

    if (!raw) return errorResponse("No agent card set", 404);

    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      throw new Error("Invalid metadata");
    }
    return NextResponse.json(parsed, { headers: CORS_HEADERS });
  } catch {
    return errorResponse("Agent not found or invalid metadata", 404);
  }
}

export function OPTIONS() {
  return corsResponse();
}
