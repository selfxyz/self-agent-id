import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { REGISTRY_ABI } from "@selfxyz/agent-sdk";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { CORS_HEADERS, corsResponse, errorResponse, validateAgentId } from "@/lib/api-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> }
) {
  const { chainId, agentId } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);

  const id = validateAgentId(agentId);
  if (id === null) return errorResponse("Invalid agent ID", 400);

  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const registry = new ethers.Contract(config.registry, REGISTRY_ABI, provider);
    const raw: string = await registry.getAgentMetadata(id);

    if (!raw) return errorResponse("No agent card set", 404);

    const parsed = JSON.parse(raw);
    return NextResponse.json(parsed, { headers: CORS_HEADERS });
  } catch {
    return errorResponse("Agent not found or invalid metadata", 404);
  }
}

export async function OPTIONS() {
  return corsResponse();
}
