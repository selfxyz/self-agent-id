// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/visa/migrate — move a wallet-based visa to a registry agent.
 *
 * Auth: EIP-191 signature (action "migrate") by the wallet behind oldAgentId
 * (= uint160(wallet), an app convention), which must also own or be the key
 * of newAgentId. Rate limit: 20 write attempts/h per IP; relayed
 * transactions 5/h per IP, 2/h per signer, 50/h global.
 * The attempt limit is counted before the signature is checked, so a 429 there
 * leaves the signature unused. A signature is single-use once it verifies:
 * after any later error, including a 5xx, sign a fresh timestamp to retry.
 * A 502 that carries `txHash` means a relayer transaction was broadcast but
 * its confirmation failed; it may still mine, so look it up before retrying.
 * Mints a visa under newAgentId with the old visa's wallet; the old visa stays
 * on-chain (soulbound, no burn).
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
 * Verify the signed migration, check the new agent's proof and eligibility,
 * then mint its visa (updating metrics first when they fall short).
 *
 * @param req - JSON body: {chainId, oldAgentId, newAgentId, connectedWallet
 *   (must be the signer), targetTier? (1-3, default 1), signature,
 *   timestamp (unix ms)}.
 * @returns 200 {success, oldAgentId, newAgentId, migratedWallet,
 *   migratedTxCount, newTier, txHash}; 400 {error} validation; 401 {error}
 *   bad, expired or reused signature; 403 {error} signer mismatch or not
 *   authorized for newAgentId; 404 {error} newAgentId not in the registry;
 *   409 {error} new agent already has a visa; 413 {error} body too large;
 *   422 {error, code?} no old visa or wallet, stale proof, REVIEW_REQUIRED
 *   (with reviewRequested) or NOT_ELIGIBLE; 429 {error, retryAfterMs};
 *   502 {error, txHash?} RPC or transaction failure (txHash: last relayer tx
 *   broadcast, which may still mine); 503 {error} relayer not configured.
 */
export async function POST(req: NextRequest) {
  const parsed = await readJsonObjectBody(req);
  if (!parsed.ok) return parsed.response;
  const { body } = parsed;

  const chainId = parseChainId(body.chainId);
  const config = chainId ? CHAIN_CONFIG[chainId] : undefined;
  if (!chainId || !config?.visa)
    return errorResponse(ERRORS.unsupportedChain, 400);
  const oldId = parseVisaAgentId(body.oldAgentId);
  const newId = parseVisaAgentId(body.newAgentId);
  if (oldId === null || newId === null) {
    return errorResponse(
      `${ERRORS.invalidAgentId} (oldAgentId, newAgentId)`,
      400,
    );
  }
  const connectedWallet = parseAddress(body.connectedWallet);
  if (!connectedWallet) {
    return errorResponse(`${ERRORS.invalidAddress} (connectedWallet)`, 400);
  }
  const targetTier =
    body.targetTier === undefined ? 1 : parseTier(body.targetTier);
  if (targetTier === null)
    return errorResponse("targetTier must be 1, 2, or 3", 400);

  const ip = getClientIp(req);
  const limited = await limitVisaWriteAttempts(ip);
  if (limited) return limited;

  const auth = await recoverVisaSigner(
    {
      action: "migrate",
      chainId,
      agentId: oldId,
      newAgentId: newId,
      targetTier,
    },
    body,
  );
  if (!auth.ok) return auth.response;
  const { signer } = auth;
  if (connectedWallet !== signer) {
    return errorResponse("connectedWallet must be the signing wallet", 403);
  }
  if (oldId !== BigInt(signer)) {
    return errorResponse(
      "oldAgentId must be the wallet-based id of the signing wallet",
      403,
    );
  }

  // Last relayer tx broadcast; reported with a 502 so the caller can check it.
  let sentTxHash: string | undefined;
  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, provider);
    const access = await checkAgentSigner(registry, newId, signer);
    if (!access.inRegistry) return errorResponse(ERRORS.agentNotFound, 404);
    if (!access.authorized) {
      return errorResponse("Signer is not authorized for newAgentId", 403);
    }

    const relayerKey = process.env.RELAYER_PRIVATE_KEY;
    if (!relayerKey) return errorResponse("Visa relayer not configured", 503);

    const visa = typedVisa(config.visa, provider);
    const [
      oldTier,
      newTier,
      proofFresh,
      agentWallet,
      thresholds,
      manualApproved,
      reviewTier,
      stored,
    ] = await Promise.all([
      visa.getTier(oldId),
      visa.getTier(newId),
      registry.isProofFresh(newId),
      visa.getVisaWallet(oldId),
      visa.getTierThresholds(targetTier),
      visa.manualReviewApproved(newId),
      visa.reviewRequestedTier(newId),
      visa.getMetrics(newId),
    ]);

    if (Number(oldTier) === 0) {
      return errorResponse("Old agent has no visa to migrate", 422);
    }
    if (Number(newTier) > 0) {
      return errorResponse("New agent already has a visa", 409);
    }
    // Same answer as claim, so callers handle one code for manual-review tiers.
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
    if (!proofFresh) {
      return errorResponse(
        "New agent does not have a fresh human proof in Self Agent Registry",
        422,
      );
    }
    if (!agentWallet || agentWallet === ethers.ZeroAddress) {
      return errorResponse("Old visa has no wallet address stored", 422);
    }

    const liveTx = BigInt(await provider.getTransactionCount(agentWallet));
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
    // Non-atomic with the mint: orphaned metrics on a visa-less agent are
    // inert and get overwritten by the next update.
    if (plan.update) {
      const metricsTx = await writable.updateMetrics(
        newId,
        plan.metrics.transactionCount,
        plan.metrics.volumeUsd,
      );
      sentTxHash = metricsTx.hash;
      await metricsTx.wait();
    }
    const mintTx = await writable.mintVisa(newId, targetTier, agentWallet);
    sentTxHash = mintTx.hash;
    const receipt = await mintTx.wait();

    return jsonResponse({
      success: true,
      oldAgentId: oldId.toString(),
      newAgentId: newId.toString(),
      migratedWallet: agentWallet,
      migratedTxCount: Number(plan.metrics.transactionCount),
      newTier: targetTier,
      txHash: receipt?.hash ?? mintTx.hash,
    });
  } catch (err) {
    console.error("[visa/migrate] failed:", err);
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
