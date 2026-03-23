// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import {
  CORS_HEADERS,
  corsResponse,
  errorResponse,
  validateAgentId,
} from "@/lib/api-helpers";

import { typedVisa } from "@/lib/contract-types";
import { VISA_ABI } from "@/lib/constants";

const RELAYER_PK = process.env.RELAYER_PRIVATE_KEY;

const TIER_NAMES: Record<number, string> = {
  0: "None",
  1: "Tourist Visa",
  2: "Work Visa",
  3: "Citizenship",
};

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ chainId: string; agentId: string }> },
) {
  const { chainId, agentId } = await params;
  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);

  if (!config.visa)
    return errorResponse("Visa contract not deployed on this network", 404);

  const id = validateAgentId(agentId);
  if (id === null) return errorResponse("Invalid agent ID", 400);

  try {
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const visa = typedVisa(config.visa, rpc);

    // Fetch all visa data in parallel
    const [
      tier,
      metrics,
      eligTourist,
      eligWork,
      eligCitizenship,
      threshTourist,
      threshWork,
      threshCitizenship,
      reviewTier,
      manualApproved,
    ] = await Promise.all([
      visa.getTier(id),
      visa.getMetrics(id),
      visa.checkTierEligibility(id, 1),
      visa.checkTierEligibility(id, 2),
      visa.checkTierEligibility(id, 3),
      visa.getTierThresholds(1),
      visa.getTierThresholds(2),
      visa.getTierThresholds(3),
      visa.reviewRequestedTier(id),
      visa.manualReviewApproved(id),
    ]);

    const tierNum = Number(tier);

    // Refresh metrics: read live tx count from RPC and use it directly.
    // Also fire-and-forget an on-chain updateMetrics so eligibility checks stay current.
    let liveTxCount = Number(metrics.transactionCount);
    if (RELAYER_PK && tierNum > 0) {
      try {
        const walletAddr = await visa.getVisaWallet(id);
        const wallet =
          walletAddr && walletAddr !== ethers.ZeroAddress
            ? walletAddr
            : ethers.getAddress(
                "0x" + id.toString(16).padStart(40, "0"),
              );
        const txCount = await rpc.getTransactionCount(wallet);
        if (txCount > liveTxCount) {
          liveTxCount = txCount;
          // Fire-and-forget: push update on-chain so eligibility checks work on next call
          const relayer = new ethers.Wallet(RELAYER_PK, rpc);
          const writable = new ethers.Contract(config.visa, VISA_ABI, relayer);
          writable.updateMetrics(id, BigInt(txCount), BigInt(0)).catch(() => {});
        }
      } catch {
        // Non-fatal — use on-chain metrics as fallback
      }
    }

    // Recompute eligibility using the live tx count
    const liveEligWork = liveTxCount >= Number(threshWork.minTransactions);
    const liveEligCitizenship =
      liveTxCount >= Number(threshCitizenship.minTransactions);

    return NextResponse.json(
      {
        agentId: Number(id),
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
          2: liveEligWork,
          3: liveEligCitizenship,
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
      },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      message.includes("could not coalesce") ||
      message.includes("BAD_DATA")
    ) {
      return errorResponse("Agent not found", 404);
    }
    return errorResponse("RPC error", 502);
  }
}

export function OPTIONS() {
  return corsResponse();
}
