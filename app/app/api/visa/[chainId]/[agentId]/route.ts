// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/visa/{chainId}/{agentId} — visa tier, metrics and eligibility.
 *
 * Auth: none. Rate limit: 120/min per IP (shared read budget).
 * Read-only: eligibility is recomputed with the visa wallet's live
 * transaction count, but nothing is written on-chain.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import {
  ERRORS,
  corsResponse,
  errorResponse,
  jsonResponse,
  validateAgentId,
} from "@/lib/agent-api-helpers";
import { readRateLimited } from "@/lib/agent-read";
import { typedRegistry, typedVisa } from "@/lib/contract-types";
import {
  TIER_NAMES,
  meetsTierThresholds,
  ownerOfOrNull,
} from "@/lib/visa-auth";

/**
 * Read an agent's visa state and recompute per-tier eligibility.
 *
 * @param req - Incoming request (counted against the per-IP read budget).
 * @param context.params - Path params: `chainId` (must have a visa
 *   contract), `agentId` (registry or wallet-based ID).
 * @returns 200 {agentId, chainId, tier, tierName, metrics: {transactionCount,
 *   volumeUsd, lastUpdated}, eligibility: {1,2,3}, reviewRequestedTier,
 *   manualReviewApproved, thresholds: {1,2,3}}; 400 {error} bad chain or
 *   agent ID; 404 {error} no visa and no registry agent; 429 {error,
 *   retryAfterMs}; 502 {error} RPC failure.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const limited = await readRateLimited(req);
  if (limited) return limited;
  const { chainId, agentId } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config?.visa) return errorResponse(ERRORS.unsupportedChain, 400);

  const id = validateAgentId(agentId);
  if (id === null) return errorResponse(ERRORS.invalidAgentId, 400);

  try {
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const visa = typedVisa(config.visa, rpc);

    const [
      tier,
      metrics,
      threshTourist,
      threshWork,
      threshCitizenship,
      reviewTier,
      manualApproved,
      visaWallet,
    ] = await Promise.all([
      visa.getTier(id),
      visa.getMetrics(id),
      visa.getTierThresholds(1),
      visa.getTierThresholds(2),
      visa.getTierThresholds(3),
      visa.reviewRequestedTier(id),
      visa.manualReviewApproved(id),
      visa.getVisaWallet(id),
    ]);

    const tierNum = Number(tier);
    // No visa and not in the registry (e.g. a wallet-based id that never
    // claimed): nothing exists under this id.
    if (
      tierNum === 0 &&
      (await ownerOfOrNull(typedRegistry(config.registry, rpc), id)) === null
    ) {
      return errorResponse(ERRORS.agentNotFound, 404);
    }

    // Use the visa wallet's live tx count when it is ahead of the stored
    // metrics. Read-only: a public GET never writes on-chain.
    let liveTxCount = Number(metrics.transactionCount);
    if (visaWallet && visaWallet !== ethers.ZeroAddress) {
      try {
        liveTxCount = Math.max(
          liveTxCount,
          await rpc.getTransactionCount(visaWallet),
        );
      } catch {
        // Non-fatal — use on-chain metrics as fallback
      }
    }

    // Recompute eligibility with the live tx count, using the exact contract
    // rule (incl. manual review). Volume isn't refreshed live, so it's stored.
    const live = {
      transactionCount: BigInt(liveTxCount),
      volumeUsd: metrics.volumeUsd,
    };
    const eligTourist = meetsTierThresholds(
      live,
      threshTourist,
      manualApproved,
    );
    const eligWork = meetsTierThresholds(live, threshWork, manualApproved);
    const eligCitizenship = meetsTierThresholds(
      live,
      threshCitizenship,
      manualApproved,
    );

    return jsonResponse({
      agentId: id.toString(),
      chainId: Number(chainId),
      tier: tierNum,
      tierName: TIER_NAMES[tierNum] ?? `Tier ${tierNum}`,
      metrics: {
        transactionCount: liveTxCount,
        volumeUsd: Number(metrics.volumeUsd) / 1e6,
        lastUpdated: Number(metrics.lastUpdated),
      },
      eligibility: {
        1: eligTourist,
        2: eligWork,
        3: eligCitizenship,
      },
      reviewRequestedTier: Number(reviewTier),
      manualReviewApproved: manualApproved,
      thresholds: {
        1: {
          minTransactions: Number(threshTourist.minTransactions),
          minVolumeUsd: Number(threshTourist.minVolumeUsd) / 1e6,
          requiresBoth: threshTourist.requiresBoth,
          requiresManualReview: threshTourist.requiresManualReview,
        },
        2: {
          minTransactions: Number(threshWork.minTransactions),
          minVolumeUsd: Number(threshWork.minVolumeUsd) / 1e6,
          requiresBoth: threshWork.requiresBoth,
          requiresManualReview: threshWork.requiresManualReview,
        },
        3: {
          minTransactions: Number(threshCitizenship.minTransactions),
          minVolumeUsd: Number(threshCitizenship.minVolumeUsd) / 1e6,
          requiresBoth: threshCitizenship.requiresBoth,
          requiresManualReview: threshCitizenship.requiresManualReview,
        },
      },
    });
  } catch (err) {
    console.error("[visa] read failed:", err);
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
