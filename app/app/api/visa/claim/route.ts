// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/visa/claim — gasless visa mint or tier upgrade via the relayer.
 *
 * Auth: EIP-191 signature (action "claim") by a wallet that owns the agent,
 * is its EVM key, or is the wallet behind a wallet-based ID (see
 * lib/visa-auth.ts). Rate limit: 20 write attempts/h per IP; relayed
 * transactions 5/h per IP, 2/h per signer, 50/h global.
 * The attempt limit is counted before the signature is checked, so a 429 there
 * leaves the signature unused. A signature is single-use once it verifies:
 * after any later error, including a 5xx, sign a fresh timestamp to retry.
 * A 502 that carries `txHash` means a relayer transaction was broadcast but
 * its confirmation failed; it may still mine, so look it up before retrying.
 * Eligibility is decided from reads (metrics from the visa's stored wallet,
 * or the signer when minting) before the relayer sends anything.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { typedRegistry, typedVisa } from "@/lib/contract-types";
import {
  ERRORS,
  parseAddress,
  corsResponse,
  errorResponse,
  getClientIp,
  jsonResponse,
  readJsonObjectBody,
} from "@/lib/agent-api-helpers";
import {
  checkAgentSigner,
  limitVisaWriteAttempts,
  notEligibleResponse,
  parseChainId,
  parseTier,
  parseVisaAgentId,
  planMetrics,
  recoverVisaSigner,
  reserveRelayerTx,
} from "@/lib/visa-auth";

/** Vercel function timeout (s): covers up to two mined relayer transactions. */
export const maxDuration = 60;

/**
 * Verify the signed claim, check eligibility, then mint (tier 0) or upgrade
 * the visa, sending updateMetrics first when the stored metrics fall short.
 *
 * @param req - JSON body: {chainId, agentId, targetTier (1-3), agentWallet?
 *   (must be the signer), signature, timestamp (unix ms)}.
 * @returns 200 {success, agentId, previousTier, newTier, wallet, txHash,
 *   blockNumber}; 400 {error} validation; 401 {error} bad, expired or reused
 *   signature; 403 {error} signer not authorized; 404 {error} unknown agent;
 *   409 {error} already at or above targetTier; 413 {error} body too large;
 *   422 {error, code?} REVIEW_REQUIRED, NOT_ELIGIBLE, not a registry agent or
 *   stale proof (tiers 2-3); 429 {error, retryAfterMs}; 502 {error, txHash?}
 *   RPC or transaction failure (txHash: last relayer tx broadcast, which may
 *   still mine); 503 {error} relayer not configured.
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
  const targetTier = parseTier(body.targetTier);
  if (targetTier === null)
    return errorResponse("targetTier must be 1, 2, or 3", 400);
  const agentWallet =
    body.agentWallet === undefined ? undefined : parseAddress(body.agentWallet);
  if (agentWallet === null) {
    return errorResponse(`${ERRORS.invalidAddress} (agentWallet)`, 400);
  }

  const ip = getClientIp(req);
  const limited = await limitVisaWriteAttempts(ip);
  if (limited) return limited;

  const auth = await recoverVisaSigner(
    { action: "claim", chainId, agentId, targetTier },
    body,
  );
  if (!auth.ok) return auth.response;
  const { signer } = auth;
  if (agentWallet && agentWallet !== signer) {
    return errorResponse("agentWallet must be the signing wallet", 403);
  }

  // Last relayer tx broadcast; reported with a 502 so the caller can check it.
  let sentTxHash: string | undefined;
  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, provider);
    const visa = typedVisa(config.visa, provider);
    const access = await checkAgentSigner(registry, agentId, signer);
    if (!access.authorized) {
      // Like migrate / request-review: an id that is neither a registry agent
      // nor a visa holder is unknown, not forbidden.
      const exists =
        access.inRegistry || Number(await visa.getTier(agentId)) > 0;
      return exists
        ? errorResponse("Signer is not authorized for this agent", 403)
        : errorResponse(ERRORS.agentNotFound, 404);
    }

    const relayerKey = process.env.RELAYER_PRIVATE_KEY;
    if (!relayerKey) return errorResponse("Visa relayer not configured", 503);

    const [tier, storedWallet, thresholds, manualApproved, reviewTier, stored] =
      await Promise.all([
        visa.getTier(agentId),
        visa.getVisaWallet(agentId),
        visa.getTierThresholds(targetTier),
        visa.manualReviewApproved(agentId),
        visa.reviewRequestedTier(agentId),
        visa.getMetrics(agentId),
      ]);
    const currentTier = Number(tier);

    if (currentTier >= targetTier) {
      return errorResponse(
        `Agent already at tier ${currentTier} (requested ${targetTier})`,
        409,
      );
    }
    if (thresholds.requiresManualReview && !manualApproved) {
      return jsonResponse(
        {
          error: "Manual review required for this tier",
          code: "REVIEW_REQUIRED",
          reviewRequested: Number(reviewTier) > 0,
        },
        422,
      );
    }
    if (targetTier > 1) {
      if (!access.inRegistry) {
        return errorResponse(
          "Work and Citizenship visas require an agent registered with a human proof in the Self app",
          422,
        );
      }
      if (!(await registry.isProofFresh(agentId))) {
        return errorResponse(
          "Agent proof has expired — refresh your Self verification first",
          422,
        );
      }
    }

    const wallet =
      storedWallet && storedWallet !== ethers.ZeroAddress
        ? storedWallet
        : signer;
    const liveTx = BigInt(await provider.getTransactionCount(wallet));
    const plan = planMetrics(stored, liveTx, thresholds, manualApproved);
    if (!plan.eligible) {
      return notEligibleResponse(targetTier, plan.metrics, thresholds);
    }

    const reserved = await reserveRelayerTx(ip, signer);
    if (reserved) return reserved;

    const relayer = new ethers.NonceManager(
      new ethers.Wallet(relayerKey, provider),
    );
    const writable = typedVisa(config.visa, relayer);
    if (plan.update) {
      const metricsTx = await writable.updateMetrics(
        agentId,
        plan.metrics.transactionCount,
        plan.metrics.volumeUsd,
      );
      sentTxHash = metricsTx.hash;
      await metricsTx.wait();
    }
    const tx =
      currentTier === 0
        ? await writable.mintVisa(agentId, targetTier, wallet)
        : await writable.claimTierUpgrade(agentId, targetTier);
    sentTxHash = tx.hash;
    const receipt = await tx.wait();

    return jsonResponse({
      success: true,
      agentId: agentId.toString(),
      previousTier: currentTier,
      newTier: targetTier,
      wallet,
      txHash: receipt?.hash ?? tx.hash,
      blockNumber: receipt?.blockNumber ?? null,
    });
  } catch (err) {
    console.error("[visa/claim] failed:", err);
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
