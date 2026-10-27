// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/register/ed25519-check — is an Ed25519 key registered?
 *
 * Auth: none. Rate limit: 120/min per IP.
 * Query: `pubkey` (64 hex, no 0x), `network` (mainnet | testnet). Returns
 * the registration state, so clients need not poll the registry themselves.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { isValidEd25519PubkeyHex, deriveEd25519Address } from "@/lib/ed25519";
import {
  ERRORS,
  getNetworkConfig,
  isValidNetwork,
  jsonResponse,
  errorResponse,
  corsResponse,
  getClientIp,
  rateLimitResponse,
} from "@/lib/agent-api-helpers";
import { typedRegistry } from "@/lib/contract-types";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Look the Ed25519 public key up in the registry.
 *
 * "registered" means the key has a human proof (isVerifiedAgent), regardless
 * of proof freshness.
 *
 * @param req - Request with `pubkey` and `network` query params.
 * @returns 200 {registered: false} or {registered: true, agentId,
 *   agentAddress}; 400 {error} bad pubkey or network; 429 {error,
 *   retryAfterMs}; 502 {error} RPC failure.
 */
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `ed25519-check:${getClientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfterMs);
  }

  const pubkey = req.nextUrl.searchParams.get("pubkey");
  const network = req.nextUrl.searchParams.get("network");

  if (!isValidEd25519PubkeyHex(pubkey)) {
    return errorResponse("Invalid pubkey parameter", 400);
  }
  if (network === null || !isValidNetwork(network)) {
    return errorResponse(ERRORS.invalidNetwork, 400);
  }

  try {
    const config = getNetworkConfig(network);
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    const registry = typedRegistry(config.registryAddress, provider);

    const agentKey = "0x" + pubkey.toLowerCase();
    const isVerified: boolean = await registry.isVerifiedAgent(agentKey);

    if (!isVerified) {
      return jsonResponse({ registered: false });
    }

    const agentId: bigint = await registry.getAgentId(agentKey);

    return jsonResponse({
      registered: true,
      agentId: Number(agentId),
      agentAddress: deriveEd25519Address(pubkey),
    });
  } catch (err) {
    console.error("ed25519-check: registry check failed", err);
    return errorResponse(ERRORS.rpc, 502);
  }
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
