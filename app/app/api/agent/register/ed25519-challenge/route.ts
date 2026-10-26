// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/agent/register/ed25519-challenge — get the Ed25519 registration
 * challenge (step 1 of the Ed25519 flow).
 *
 * Auth: none. Rate limit: 10/min per IP.
 * Returns the challenge hash (built from the key's on-chain nonce) that the
 * agent signs and sends as ed25519Signature to POST /api/agent/register.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  computeEd25519ChallengeHash,
  deriveEd25519Address,
  isValidEd25519PubkeyHex,
} from "@/lib/ed25519";
import {
  ERRORS,
  getNetworkConfig,
  isValidNetwork,
  parseAddress,
  jsonResponse,
  errorResponse,
  corsResponse,
  getClientIp,
  rateLimitResponse,
  readJsonObjectBody,
} from "@/lib/agent-api-helpers";
import { typedRegistry } from "@/lib/contract-types";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Fetch the key's registry nonce and compute the challenge hash to sign.
 *
 * @param req - JSON body: {pubkey (64 hex, no 0x), network, humanAddress?
 *   (guardian for ed25519-linked; defaults to the pubkey's derived address)}.
 * @returns 200 {challengeHash, nonce (decimal string)}; 400 {error} validation;
 *   413 {error} body too large; 429 {error, retryAfterMs}; 502 {error} nonce
 *   lookup failed.
 */
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `ed25519-challenge:${getClientIp(req)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfterMs);
  }

  const parsed = await readJsonObjectBody(req);
  if (!parsed.ok) return parsed.response;
  const { pubkey, network, humanAddress: rawHumanAddress } = parsed.body;

  if (!isValidEd25519PubkeyHex(pubkey)) {
    return errorResponse(
      "Invalid Ed25519 public key (must be 64-char hex, no 0x prefix)",
      400,
    );
  }
  if (typeof network !== "string" || !isValidNetwork(network)) {
    return errorResponse(ERRORS.invalidNetwork, 400);
  }

  const humanAddress =
    rawHumanAddress === undefined
      ? deriveEd25519Address(pubkey)
      : parseAddress(rawHumanAddress);
  if (!humanAddress) {
    return errorResponse(
      "humanAddress must be a non-zero 0x-prefixed Ethereum address",
      400,
    );
  }

  const networkConfig = getNetworkConfig(network);
  let nonce: bigint;
  try {
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = typedRegistry(networkConfig.registryAddress, provider);
    nonce = await registry.ed25519Nonce("0x" + pubkey.toLowerCase());
  } catch (err) {
    console.error("ed25519-challenge: nonce lookup failed", err);
    return errorResponse(ERRORS.rpc, 502);
  }

  const challengeHash = computeEd25519ChallengeHash({
    humanAddress,
    chainId: BigInt(networkConfig.chainId),
    registryAddress: networkConfig.registryAddress,
    nonce,
  });

  return jsonResponse({ challengeHash, nonce: nonce.toString() });
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
