import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { REGISTRY_ABI } from "@selfxyz/agent-sdk";

const CHAIN_CONFIG: Record<string, { rpc: string; registry: string }> = {
  "42220": {
    rpc: "https://forno.celo.org",
    registry: "0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095",
  },
  "11142220": {
    rpc: "https://forno.celo-sepolia.celo-testnet.org",
    registry: "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b",
  },
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "public, max-age=60",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> }
) {
  const { chainId, agentId } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config) {
    return NextResponse.json(
      { error: `Unsupported chain: ${chainId}` },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const registry = new ethers.Contract(config.registry, REGISTRY_ABI, provider);
    const raw: string = await registry.getAgentMetadata(BigInt(agentId));

    if (!raw) {
      return NextResponse.json(
        { error: "No agent card set" },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const parsed = JSON.parse(raw);
    return NextResponse.json(parsed, { headers: CORS_HEADERS });
  } catch {
    return NextResponse.json(
      { error: "Agent not found or invalid metadata" },
      { status: 404, headers: CORS_HEADERS }
    );
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
