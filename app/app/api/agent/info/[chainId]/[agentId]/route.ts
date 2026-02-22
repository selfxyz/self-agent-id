import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { REGISTRY_ABI, PROVIDER_ABI, getProviderLabel } from "@selfxyz/agent-sdk";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { CORS_HEADERS, corsResponse, errorResponse, validateAgentId } from "@/lib/api-helpers";

// Supplemental ABI for functions not in the SDK's REGISTRY_ABI
const REGISTRY_EXT_ABI = [
  "function agentIdToPubkey(uint256 agentId) view returns (bytes32)",
] as const;

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
    const registryExt = new ethers.Contract(config.registry, REGISTRY_EXT_ABI, rpc);

    // Fetch core agent data in parallel
    const [agentKey, hasProof, providerAddr, registeredAt, credentials] =
      await Promise.all([
        registryExt.agentIdToPubkey(id) as Promise<string>,
        registry.hasHumanProof(id) as Promise<boolean>,
        registry.getProofProvider(id) as Promise<string>,
        registry.agentRegisteredAt(id) as Promise<bigint>,
        registry.getAgentCredentials(id) as Promise<{
          issuingState: string;
          name: string[];
          idNumber: string;
          nationality: string;
          dateOfBirth: string;
          gender: string;
          expiryDate: string;
          olderThan: bigint;
          ofac: [boolean, boolean, boolean];
        }>,
      ]);

    // Zero key means agent does not exist
    if (agentKey === ethers.ZeroHash) {
      return errorResponse("Agent not found", 404);
    }

    // Derive agent address from the key (lower 20 bytes)
    const agentAddress = ethers.getAddress(
      "0x" + agentKey.slice(-40)
    );

    // Determine network label from chainId
    const networkLabel = chainId === "42220" ? "mainnet" : "testnet";

    // Fetch provider verification strength if agent has a proof
    let verificationStrength = 0;
    let strengthLabel = "None";
    if (hasProof && providerAddr !== ethers.ZeroAddress) {
      const provider = new ethers.Contract(providerAddr, PROVIDER_ABI, rpc);
      const strength: number = await provider.verificationStrength();
      verificationStrength = Number(strength);
      strengthLabel = getProviderLabel(verificationStrength);
    }

    return NextResponse.json(
      {
        agentId: Number(id),
        chainId: Number(chainId),
        agentKey,
        agentAddress,
        isVerified: hasProof,
        proofProvider: providerAddr,
        verificationStrength,
        strengthLabel,
        credentials: {
          nationality: credentials.nationality,
          olderThan: Number(credentials.olderThan),
          ofac: [...credentials.ofac],
        },
        registeredAt: Number(registeredAt),
        network: networkLabel,
      },
      { headers: CORS_HEADERS }
    );
  } catch (err) {
    // Distinguish RPC failures from "not found"
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("could not coalesce") || message.includes("BAD_DATA")) {
      return errorResponse("Agent not found", 404);
    }
    return errorResponse("RPC error", 502);
  }
}

export async function OPTIONS() {
  return corsResponse();
}
