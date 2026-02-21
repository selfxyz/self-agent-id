import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { REGISTRY_ABI, PROVIDER_ABI, getProviderLabel } from "@selfxyz/agent-sdk";
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
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const registry = new ethers.Contract(config.registry, REGISTRY_ABI, rpc);

    const [hasProof, providerAddr, registeredAtBlock] = await Promise.all([
      registry.hasHumanProof(id) as Promise<boolean>,
      registry.getProofProvider(id) as Promise<string>,
      registry.agentRegisteredAt(id) as Promise<bigint>,
    ]);

    if (!hasProof) {
      return NextResponse.json(
        { verified: false },
        { headers: CORS_HEADERS }
      );
    }

    const provider = new ethers.Contract(providerAddr, PROVIDER_ABI, rpc);
    const strength: number = await provider.verificationStrength();

    return NextResponse.json(
      {
        verified: true,
        proofType: getProviderLabel(Number(strength)),
        registeredAtBlock: registeredAtBlock.toString(),
        providerAddress: providerAddr,
      },
      { headers: CORS_HEADERS }
    );
  } catch {
    return errorResponse("Agent not found", 404);
  }
}

export async function OPTIONS() {
  return corsResponse();
}
