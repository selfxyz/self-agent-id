// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// POST /api/visa/claim — gasless visa claim via server-side relayer
//
// claimTierUpgrade is permissionless (no role required), but we relay it
// so users never need to pay gas. The relayer wallet pays the gas cost.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { VISA_ABI } from "@/lib/constants";
import { CORS_HEADERS, corsResponse, errorResponse } from "@/lib/api-helpers";
import { checkRateLimit, recordRelayerTx } from "@/lib/rate-limit";

export const maxDuration = 60;

const RELAYER_PK = process.env.RELAYER_PRIVATE_KEY;

interface ClaimRequest {
  chainId: string;
  agentId: string;
  targetTier: number;
  agentWallet?: string;
}

export async function POST(req: NextRequest) {
  if (!RELAYER_PK) {
    return errorResponse(
      "Visa claim relayer not configured (RELAYER_PRIVATE_KEY)",
      503,
    );
  }

  // Rate limit to prevent relayer drain
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitError = checkRateLimit(ip);
  if (rateLimitError) {
    return errorResponse(rateLimitError, 429);
  }

  let body: ClaimRequest;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return errorResponse("Invalid JSON body", 400);
    }
    body = parsed as ClaimRequest;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { chainId, agentId, targetTier, agentWallet } = body;

  if (!chainId || !agentId) {
    return errorResponse("chainId and agentId are required", 400);
  }

  if (!targetTier || targetTier < 1 || targetTier > 3) {
    return errorResponse("targetTier must be 1, 2, or 3", 400);
  }

  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);
  if (!config.visa)
    return errorResponse("Visa contract not deployed on this network", 404);

  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const relayer = new ethers.Wallet(RELAYER_PK, provider);
    const visa = new ethers.Contract(config.visa, VISA_ABI, relayer);

    // Check current tier first
    const currentTier = Number(await visa.getTier(BigInt(agentId)));
    if (currentTier >= targetTier) {
      return errorResponse(
        `Agent already at tier ${currentTier} (requested ${targetTier})`,
        409,
      );
    }

    // Check if tier requires manual review (read from on-chain thresholds)
    const thresholds = (await visa.getTierThresholds(targetTier)) as {
      requiresManualReview: boolean;
    };
    if (thresholds.requiresManualReview) {
      const [manualApproved, reviewTier] = (await Promise.all([
        visa.manualReviewApproved(BigInt(agentId)),
        visa.reviewRequestedTier(BigInt(agentId)),
      ])) as [boolean, bigint];

      if (!manualApproved) {
        return NextResponse.json(
          {
            error: "Manual review required for this tier",
            code: "REVIEW_REQUIRED",
            reviewRequested: Number(reviewTier) > 0,
          },
          { status: 422, headers: CORS_HEADERS },
        );
      }
    }

    // Seed on-chain metrics from the agent wallet's real activity.
    // This resolves the chicken-and-egg problem where the scoring daemon
    // hasn't discovered this agent yet (no visa = no discovery = no metrics).
    // Priority: 1) visa contract stored wallet, 2) request body, 3) derive from agentId
    let walletForMetrics = agentWallet || "";
    if (currentTier > 0) {
      try {
        const stored = (await visa.getVisaWallet(BigInt(agentId))) as string;
        if (stored && stored !== ethers.ZeroAddress) walletForMetrics = stored;
      } catch {
        // fall through
      }
    }
    if (!walletForMetrics) {
      walletForMetrics = ethers.getAddress(
        "0x" + BigInt(agentId).toString(16).padStart(40, "0"),
      );
    }
    const txCount = await provider.getTransactionCount(walletForMetrics);
    if (txCount > 0) {
      // Preserve existing on-chain volume — only update tx count
      let existingVolume = 0n;
      try {
        const m = (await visa.getMetrics(BigInt(agentId))) as {
          volumeUsd: bigint;
        };
        existingVolume = m.volumeUsd;
      } catch {
        // No existing metrics yet
      }
      const metricsTx = (await visa.updateMetrics(
        BigInt(agentId),
        BigInt(txCount),
        existingVolume,
      )) as ethers.ContractTransactionResponse;
      await metricsTx.wait();
    }

    // Check eligibility — if not eligible, return detailed diagnostics
    const eligible = (await visa.checkTierEligibility(
      BigInt(agentId),
      targetTier,
    )) as boolean;
    if (!eligible) {
      const [metrics, tierThresholds] = (await Promise.all([
        visa.getMetrics(BigInt(agentId)),
        visa.getTierThresholds(targetTier),
      ])) as [
        { transactionCount: bigint; volumeUsd: bigint; lastUpdated: bigint },
        {
          minTransactions: bigint;
          minVolumeUsd: bigint;
          requiresBoth: boolean;
          requiresManualReview: boolean;
        },
      ];
      return NextResponse.json(
        {
          error: `Agent does not meet requirements for tier ${targetTier}`,
          code: "NOT_ELIGIBLE",
          metrics: {
            transactionCount: Number(metrics.transactionCount),
            volumeUsd: Number(metrics.volumeUsd) / 1e6,
          },
          required: {
            minTransactions: Number(tierThresholds.minTransactions),
            minVolumeUsd: Number(tierThresholds.minVolumeUsd) / 1e6,
            requiresBoth: tierThresholds.requiresBoth,
          },
        },
        { status: 422, headers: CORS_HEADERS },
      );
    }

    // If agent has no visa yet (tier 0), mint instead of claim upgrade
    let tx: ethers.ContractTransactionResponse;
    if (currentTier === 0) {
      // Wallet is required for minting — use provided wallet or derive from agentId
      const wallet =
        agentWallet ||
        ethers.getAddress(
          "0x" + BigInt(agentId).toString(16).padStart(40, "0"),
        );
      tx = (await visa.mintVisa(
        BigInt(agentId),
        targetTier,
        wallet,
      )) as ethers.ContractTransactionResponse;
    } else {
      tx = (await visa.claimTierUpgrade(
        BigInt(agentId),
        targetTier,
      )) as ethers.ContractTransactionResponse;
    }

    const receipt = await tx.wait();
    recordRelayerTx(ip);

    return NextResponse.json(
      {
        success: true,
        agentId,
        previousTier: currentTier,
        newTier: targetTier,
        txHash: receipt?.hash,
        blockNumber: receipt?.blockNumber,
      },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("AgentNotRegistered")) {
      return errorResponse(
        "Work and Citizenship visas require Self app verification. Register your agent with a human proof in the Self app first.",
        422,
      );
    }
    if (message.includes("ProofNotFresh")) {
      return errorResponse(
        "Agent proof has expired — refresh your Self verification first",
        422,
      );
    }
    if (message.includes("NoVisaExists")) {
      return errorResponse(
        "Agent has no visa — mint a Tourist visa first",
        422,
      );
    }
    if (message.includes("TierNotHigher")) {
      return errorResponse("Target tier must be higher than current tier", 409);
    }
    if (message.includes("NotEligibleForTier")) {
      return errorResponse(
        "Agent does not meet metric requirements for this tier",
        422,
      );
    }
    return errorResponse(`Claim failed: ${message}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
