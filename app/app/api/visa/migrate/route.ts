// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// POST /api/visa/migrate — migrates a wallet-based Tourist visa to a registry-based agent
//
// After Self registration completes, this endpoint transfers visa metrics and
// mints a new visa under the human-verified agentId. The old wallet-based agent
// must be owned by the connected wallet (oldAgentId == uint256(connectedWallet)).

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { VISA_ABI, REGISTRY_ABI } from "@/lib/constants";
import { CORS_HEADERS, corsResponse, errorResponse } from "@/lib/api-helpers";
import { checkRateLimit, recordRelayerTx } from "@/lib/rate-limit";

export const maxDuration = 60;

const RELAYER_PK = process.env.RELAYER_PRIVATE_KEY;

interface MigrateRequest {
  chainId: string;
  oldAgentId: string;
  newAgentId: string;
  connectedWallet: string;
  targetTier?: number;
}

export async function POST(req: NextRequest) {
  if (!RELAYER_PK) {
    return errorResponse("Relayer not configured", 503);
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rateLimitError = checkRateLimit(ip);
  if (rateLimitError) {
    return errorResponse(rateLimitError, 429);
  }

  let body: MigrateRequest;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return errorResponse("Invalid JSON body", 400);
    }
    body = parsed as MigrateRequest;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { chainId, oldAgentId, newAgentId, connectedWallet, targetTier } = body;

  if (!chainId || !oldAgentId || !newAgentId || !connectedWallet) {
    return errorResponse("chainId, oldAgentId, newAgentId, and connectedWallet are required", 400);
  }

  // Validate agentId formats
  let oldId: bigint;
  let newId: bigint;
  try {
    oldId = BigInt(oldAgentId);
    newId = BigInt(newAgentId);
    if (oldId <= 0n || newId <= 0n) throw new Error();
  } catch {
    return errorResponse("oldAgentId and newAgentId must be valid positive integers", 400);
  }

  // Validate wallet address format
  let checksumWallet: string;
  try {
    checksumWallet = ethers.getAddress(connectedWallet);
  } catch {
    return errorResponse("connectedWallet is not a valid Ethereum address", 400);
  }

  // Ownership check: oldAgentId must be uint256(connectedWallet)
  // This prevents anyone from migrating someone else's visa metrics
  if (oldId !== BigInt(checksumWallet)) {
    return errorResponse("oldAgentId does not match connected wallet", 403);
  }

  const config = CHAIN_CONFIG[chainId];
  if (!config) return errorResponse(`Unsupported chain: ${chainId}`, 400);
  if (!config.visa)
    return errorResponse("Visa contract not deployed on this network", 404);
  if (!config.registry)
    return errorResponse("Registry contract not deployed on this network", 404);

  try {
    const provider = new ethers.JsonRpcProvider(config.rpc);
    const relayer = new ethers.Wallet(RELAYER_PK, provider);
    const visa = new ethers.Contract(config.visa, VISA_ABI, relayer);
    const registry = new ethers.Contract(config.registry, REGISTRY_ABI, provider);

    // 1. Verify the old agent has a visa to migrate
    const oldTier = Number(await visa.getTier(oldId));
    if (oldTier === 0) {
      return errorResponse("Old agent has no visa to migrate", 422);
    }

    // 2. Verify the new agentId exists in the Self registry with a fresh proof
    const proofFresh = (await registry.isProofFresh(newId)) as boolean;
    if (!proofFresh) {
      return errorResponse("New agent does not have a fresh human proof in Self Agent Registry", 422);
    }

    // 3. Verify the new agentId doesn't already have a visa
    const newTier = Number(await visa.getTier(newId));
    if (newTier > 0) {
      return errorResponse("New agent already has a visa", 409);
    }

    // 4. Read wallet from old visa
    const agentWallet = (await visa.getVisaWallet(oldId)) as string;
    if (!agentWallet || agentWallet === ethers.ZeroAddress) {
      return errorResponse("Old visa has no wallet address stored", 422);
    }

    // 5. Fetch live tx count for the agent wallet
    const txCount = await provider.getTransactionCount(agentWallet);

    // 6. Push metrics to new agentId (non-atomic with mint — orphaned metrics
    // on a visa-less agent are inert and will be overwritten on next update)
    if (txCount > 0) {
      const metricsTx = (await visa.updateMetrics(
        newId,
        BigInt(txCount),
        BigInt(0),
      )) as ethers.ContractTransactionResponse;
      await metricsTx.wait();
    }

    // 7. Mint visa directly at target tier under new agentId.
    // mintVisa supports minting at any tier (1-3) in a single call — no need to
    // mint Tourist first and then upgrade. The contract checks eligibility + registry
    // for tier 2+ in the same call.
    // Note: The old wallet-based visa is NOT burned (soulbound contract has no burn).
    // It remains on-chain at tier 1 but becomes stale — the registry-based visa is canonical.
    const mintTier = targetTier && targetTier >= 1 && targetTier <= 3 ? targetTier : 1;
    const mintTx = (await visa.mintVisa(
      newId,
      mintTier,
      agentWallet,
    )) as ethers.ContractTransactionResponse;
    const mintReceipt = await mintTx.wait();

    recordRelayerTx(ip);

    return NextResponse.json(
      {
        success: true,
        oldAgentId,
        newAgentId,
        migratedWallet: agentWallet,
        migratedTxCount: txCount,
        mintTxHash: mintReceipt?.hash,
        newTier: mintTier,
      },
      { headers: CORS_HEADERS },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("AgentNotRegistered")) {
      return errorResponse(
        "Self registration not found on-chain yet. Please wait a moment and try again.",
        422,
      );
    }
    if (message.includes("ProofNotFresh")) {
      return errorResponse(
        "Self verification has expired. Please re-verify in the Self app.",
        422,
      );
    }
    if (message.includes("VisaAlreadyExists")) {
      return errorResponse("New agent already has a visa", 409);
    }
    return errorResponse(`Migration failed: ${message}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
