// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// POST /api/agent/register/ed25519-challenge
//
// Step 1 of the two-step Ed25519 registration flow.
// Agent sends their pubkey and humanAddress; this endpoint fetches the nonce
// from the contract and returns the challenge hash for signing.

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  computeEd25519ChallengeHash,
  deriveEd25519Address,
  isValidEd25519PubkeyHex,
} from "@/lib/ed25519";
import {
  getNetworkConfig,
  isValidNetwork,
  isValidAddress,
  jsonResponse,
  errorResponse,
  corsResponse,
} from "@/lib/agent-api-helpers";
import { typedRegistry } from "@/lib/contract-types";
import { checkRateLimit } from "@/lib/rateLimit";

export async function POST(req: NextRequest) {
  // Rate limit: 10 challenge requests per minute per IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit({
    key: `ed25519-challenge:${ip}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return errorResponse("Too many requests", 429);
  }

  let body: { pubkey?: string; network?: string; humanAddress?: string };
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return errorResponse("Invalid JSON body", 400);
    }
    body = parsed as typeof body;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { pubkey, network } = body;
  let { humanAddress } = body;

  if (!pubkey || !isValidEd25519PubkeyHex(pubkey)) {
    return errorResponse(
      "Invalid Ed25519 public key (must be 64-char hex, no 0x prefix)",
      400,
    );
  }
  if (!network || !isValidNetwork(network)) {
    return errorResponse(
      `Invalid network: "${network}". Valid: mainnet, testnet`,
      400,
    );
  }
  if (!humanAddress) {
    humanAddress = deriveEd25519Address(pubkey);
  } else if (!isValidAddress(humanAddress)) {
    return errorResponse("humanAddress must be a valid Ethereum address", 400);
  }

  try {
    const networkConfig = getNetworkConfig(network);
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = typedRegistry(networkConfig.registryAddress, provider);
    const nonce = await registry.ed25519Nonce("0x" + pubkey);

    const challengeHash = computeEd25519ChallengeHash({
      humanAddress: ethers.getAddress(humanAddress),
      chainId: BigInt(networkConfig.chainId),
      registryAddress: networkConfig.registryAddress,
      nonce,
    });

    return jsonResponse({ challengeHash, nonce: nonce.toString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResponse(`Challenge generation failed: ${message}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
