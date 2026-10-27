// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/visa/request-review — file a manual-review request for tier 2 or 3.
 *
 * Auth: EIP-191 signature (action "request-review") by a wallet authorized for
 * the agent (see lib/visa-auth.ts). Rate limit: 20 write attempts/h per IP; relayed
 * transactions 5/h per IP, 2/h per signer, 50/h global.
 * The attempt limit is counted before the signature is checked, so a 429 there
 * leaves the signature unused. A signature is single-use once it verifies:
 * after any later error, including a 5xx, sign a fresh timestamp to retry.
 * A 502 that carries `txHash` means a relayer transaction was broadcast but
 * its confirmation failed; it may still mine, so look it up before retrying.
 * The agent must be a registry agent holding a visa below targetTier.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { typedRegistry, typedVisa } from "@/lib/contract-types";
import {
  ERRORS,
  corsResponse,
  errorResponse,
  getClientIp,
  jsonResponse,
  readJsonObjectBody,
} from "@/lib/agent-api-helpers";
import {
  checkAgentSigner,
  limitVisaWriteAttempts,
  parseChainId,
  parseTier,
  parseVisaAgentId,
  recoverVisaSigner,
  reserveRelayerTx,
} from "@/lib/visa-auth";

/** Vercel function timeout (s): covers one mined relayer transaction. */
export const maxDuration = 60;

/**
 * Verify the signed request and relay requestReview on-chain.
 *
 * @param req - JSON body: {chainId, agentId, targetTier (2-3), signature,
 *   timestamp (unix ms)}.
 * @returns 200 {success, agentId, targetTier, txHash}; 400 {error}
 *   validation; 401 {error} bad, expired or reused signature; 403 {error}
 *   signer not authorized; 404 {error} unknown agent; 409 {error} already at
 *   or above the tier, or review already requested; 413 {error} body too
 *   large; 422 {error} no visa yet or not a registry agent; 429 {error,
 *   retryAfterMs}; 502 {error, txHash?} RPC or transaction failure (txHash:
 *   the relayer tx, broadcast but unconfirmed, which may still mine);
 *   503 {error} relayer not configured.
 */
export async function POST(req: NextRequest) {
  const parsed = await readJsonObjectBody(req);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const chainId = parseChainId(body.chainId);
  const config = chainId ? CHAIN_CONFIG[chainId] : undefined;
  if (!chainId || !config?.visa)
    return errorResponse(ERRORS.unsupportedChain, 400);
  const agentId = parseVisaAgentId(body.agentId);
  if (agentId === null) return errorResponse(ERRORS.invalidAgentId, 400);
  const targetTier = parseTier(body.targetTier, 2);
  if (targetTier === null)
    return errorResponse("targetTier must be 2 or 3", 400);

  const ip = getClientIp(req);
  const limited = await limitVisaWriteAttempts(ip);
  if (limited) return limited;

  const auth = await recoverVisaSigner(
    { action: "request-review", chainId, agentId, targetTier },
    body,
  );
  if (!auth.ok) return auth.response;

  // Relayer tx once broadcast; reported with a 502 so the caller can check it.
  let sentTxHash: string | undefined;
  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, provider);
    const visa = typedVisa(config.visa, provider);
    const [access, tier, requested] = await Promise.all([
      checkAgentSigner(registry, agentId, auth.signer),
      visa.getTier(agentId),
      visa.reviewRequestedTier(agentId),
    ]);
    const currentTier = Number(tier);

    if (!access.inRegistry && currentTier === 0) {
      return errorResponse(ERRORS.agentNotFound, 404);
    }
    if (!access.authorized) {
      return errorResponse("Signer is not authorized for this agent", 403);
    }

    const relayerKey = process.env.RELAYER_PRIVATE_KEY;
    if (!relayerKey) return errorResponse("Visa relayer not configured", 503);

    if (currentTier === 0) {
      return errorResponse(
        "Agent has no visa — claim a Tourist visa first",
        422,
      );
    }
    if (!access.inRegistry) {
      return errorResponse(
        "Work and Citizenship visas require an agent registered with a human proof in the Self app",
        422,
      );
    }
    if (targetTier <= currentTier) {
      return errorResponse(
        "Agent is already at or above the requested tier",
        409,
      );
    }
    if (Number(requested) === targetTier) {
      return errorResponse("Review already requested for this tier", 409);
    }

    const reserved = await reserveRelayerTx(ip, auth.signer);
    if (reserved) return reserved;

    // NonceManager like claim / migrate, so concurrent relays on one instance
    // do not race for the same nonce.
    const relayer = new ethers.NonceManager(
      new ethers.Wallet(relayerKey, provider),
    );
    const tx = await typedVisa(config.visa, relayer).requestReview(
      agentId,
      targetTier,
    );
    sentTxHash = tx.hash;
    const receipt = await tx.wait();

    return jsonResponse({
      success: true,
      agentId: agentId.toString(),
      targetTier,
      txHash: receipt?.hash ?? tx.hash,
    });
  } catch (err) {
    console.error("[visa/request-review] failed:", err);
    return sentTxHash
      ? jsonResponse({ error: ERRORS.rpc, txHash: sentTxHash }, 502)
      : errorResponse(ERRORS.rpc, 502);
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
