// GET /api/agent/register/ed25519-check?pubkey=<hex>&network=<mainnet|testnet>
//
// Checks if an Ed25519 agent is registered on-chain by querying the registry.
// Lightweight alternative to polling from the client with ethers.

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { isValidEd25519PubkeyHex, deriveEd25519Address } from "@/lib/ed25519";
import {
  getNetworkConfig,
  isValidNetwork,
  jsonResponse,
  errorResponse,
  corsResponse,
} from "@/lib/agent-api-helpers";
import { typedRegistry } from "@/lib/contract-types";

export async function GET(req: NextRequest) {
  const pubkey = req.nextUrl.searchParams.get("pubkey");
  const network = req.nextUrl.searchParams.get("network") ?? "testnet";

  if (!pubkey || !isValidEd25519PubkeyHex(pubkey)) {
    return errorResponse("Invalid pubkey parameter", 400);
  }
  if (!isValidNetwork(network)) {
    return errorResponse("Invalid network parameter", 400);
  }

  try {
    const config = getNetworkConfig(network);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const registry = typedRegistry(config.registryAddress, provider);

    const agentKey = "0x" + pubkey.padStart(64, "0");
    const isVerified: boolean = await registry.isVerifiedAgent(agentKey);

    if (!isVerified) {
      return jsonResponse({ registered: false });
    }

    const agentId: bigint = await registry.getAgentId(agentKey);
    const agentAddress = deriveEd25519Address(pubkey);

    return jsonResponse({
      registered: true,
      agentId: agentId.toString(),
      agentAddress,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`Registry check failed: ${message}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
