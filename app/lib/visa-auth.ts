// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Guards for the relayer-funded visa write routes (claim, migrate, request-review).
 *
 * The relayer is the only holder of MINTER_ROLE / METRICS_UPDATER_ROLE on the
 * visa contract, so every write it makes for a caller must be (1) signed by
 * someone allowed to act for the agent and (2) paid for out of a bounded
 * budget. Callers sign buildVisaRequestMessage(...) with personal_sign
 * (EIP-191) and send `signature` + `timestamp` (unix ms) in the JSON body.
 */

import { ethers } from "ethers";
import type { NextResponse } from "next/server";
import {
  errorResponse,
  jsonResponse,
  rateLimitResponse,
} from "@/lib/agent-api-helpers";
import { validateAgentId } from "@/lib/agent-api-helpers";
import type { TypedRegistryContract } from "@/lib/contract-types";
import { checkRateLimit } from "@/lib/rate-limit";
import { setIfAbsentWithTtl } from "@/lib/security-store";

/** Display names of visa tiers (0 = no visa). */
export const TIER_NAMES: Record<number, string> = {
  0: "None",
  1: "Tourist Visa",
  2: "Work Visa",
  3: "Citizenship",
};

/** Max clock skew between the signed timestamp and the server, either way. */
const VISA_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/** Visa write action named in the signed message. */
export type VisaAction = "claim" | "migrate" | "request-review";

/** Fields covered by the signed visa request message. */
interface VisaRequestFields {
  action: VisaAction;
  chainId: string;
  /** The visa agent ID (for migrate: the old wallet-based ID). */
  agentId: bigint;
  /** migrate only: the registry agent that receives the visa. */
  newAgentId?: bigint;
  targetTier: number;
  /** Unix epoch milliseconds. */
  timestamp: number;
}

/**
 * Build the exact text a caller signs.
 *
 * Newline-separated, no trailing newline, IDs and chainId in canonical
 * decimal. SDKs must reproduce this byte for byte.
 *
 * @param f - Action, chain ID, agent ID(s), target tier and timestamp.
 * @returns The message to sign with personal_sign.
 */
export function buildVisaRequestMessage(f: VisaRequestFields): string {
  return [
    "Self Agent ID visa request",
    `action: ${f.action}`,
    `chainId: ${f.chainId}`,
    `agentId: ${f.agentId}`,
    ...(f.newAgentId === undefined ? [] : [`newAgentId: ${f.newAgentId}`]),
    `targetTier: ${f.targetTier}`,
    `timestamp: ${f.timestamp}`,
  ].join("\n");
}

/**
 * Parse a visa agent ID from a JSON body field.
 *
 * @param raw - A safe integer or canonical decimal string.
 * @returns The agent ID, or null if invalid (including 0 and negatives).
 */
export function parseVisaAgentId(raw: unknown): bigint | null {
  if (typeof raw === "number" && Number.isSafeInteger(raw)) {
    return validateAgentId(String(raw));
  }
  return typeof raw === "string" ? validateAgentId(raw) : null;
}

/**
 * Parse a visa tier from a JSON body field.
 *
 * @param raw - Request value; strings and fractions are rejected.
 * @param min - Lowest accepted tier (default 1).
 * @returns The tier in [min, 3], or null.
 */
export function parseTier(raw: unknown, min = 1): number | null {
  return Number.isInteger(raw) && (raw as number) >= min && (raw as number) <= 3
    ? (raw as number)
    : null;
}

/**
 * Read a chain ID from a JSON body field as a string.
 *
 * Not validated here; callers look it up in CHAIN_CONFIG.
 *
 * @param raw - String or number.
 * @returns String(raw), or null for any other type.
 */
export function parseChainId(raw: unknown): string | null {
  return typeof raw === "string" || typeof raw === "number"
    ? String(raw)
    : null;
}

/**
 * Recover the signer of a visa request and consume it against replay.
 *
 * Checks `signature` / `timestamp` from the body against the canonical
 * message. Each signer+message is accepted once (within 10 minutes). Does not
 * check that the signer may act for the agent (see checkAgentSigner).
 *
 * @param fields - Message fields except the timestamp (taken from the body).
 * @param body - Parsed JSON body with `signature` (0x + 65 bytes) and
 *   `timestamp` (unix ms).
 * @returns `{ ok: true, signer }`, or `{ ok: false, response }` with 401 for a
 *   malformed signature/timestamp, a timestamp more than 5 minutes off, an
 *   unrecoverable signature, or a replay.
 */
export async function recoverVisaSigner(
  fields: Omit<VisaRequestFields, "timestamp">,
  body: Record<string, unknown>,
): Promise<
  { ok: true; signer: string } | { ok: false; response: NextResponse }
> {
  const { signature, timestamp } = body;
  const fail = (message: string) => ({
    ok: false as const,
    response: errorResponse(message, 401),
  });

  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    return fail("Missing or malformed signature");
  if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp))
    return fail("Missing or malformed timestamp (unix ms)");
  if (Math.abs(Date.now() - timestamp) > VISA_SIGNATURE_MAX_AGE_MS)
    return fail("Signature expired: sign a fresh timestamp");

  const message = buildVisaRequestMessage({ ...fields, timestamp });
  let signer: string;
  try {
    signer = ethers.verifyMessage(message, signature);
  } catch {
    return fail("Invalid signature");
  }

  // Keyed on signer + message (not the signature bytes) so a malleated
  // signature over the same message is still a replay.
  const fresh = await setIfAbsentWithTtl(
    `visa-sig:${signer}:${ethers.id(message)}`,
    2 * VISA_SIGNATURE_MAX_AGE_MS,
  );
  if (!fresh) return fail("Signature already used");
  return { ok: true, signer };
}

/**
 * Look up the registry NFT owner of an agent.
 *
 * @param registry - Registry contract.
 * @param agentId - Agent ID.
 * @returns The owner, or null if it was never minted / was burned.
 * @throws On RPC errors other than a revert.
 */
export async function ownerOfOrNull(
  registry: TypedRegistryContract,
  agentId: bigint,
): Promise<string | null> {
  try {
    return await registry.ownerOf(agentId);
  } catch (err) {
    if (ethers.isError(err, "CALL_EXCEPTION")) return null;
    throw err;
  }
}

/**
 * Check whether a signer may act for an agent.
 *
 * Allowed: the registry NFT owner, the agent's own EVM key (agentKey =
 * zero-padded address), or, for wallet-based visa IDs (uint160(wallet), never
 * in the registry), that wallet.
 *
 * @param registry - Registry contract.
 * @param agentId - Agent ID (registry or wallet-based).
 * @param signer - Address from recoverVisaSigner.
 * @returns `inRegistry` (the agent ID is minted) and `authorized`.
 * @throws On RPC errors.
 */
export async function checkAgentSigner(
  registry: TypedRegistryContract,
  agentId: bigint,
  signer: string,
): Promise<{ inRegistry: boolean; authorized: boolean }> {
  const owner = await ownerOfOrNull(registry, agentId);
  if (owner === null) {
    return { inRegistry: false, authorized: BigInt(signer) === agentId };
  }
  if (owner === signer) return { inRegistry: true, authorized: true };
  const agentKey = await registry.agentIdToAgentKey(agentId);
  return {
    inRegistry: true,
    authorized:
      agentKey.toLowerCase() === ethers.zeroPadValue(signer, 32).toLowerCase(),
  };
}

const HOUR_MS = 60 * 60 * 1000;

/**
 * Count one hit against an hourly bucket.
 *
 * @param key - Rate-limit key.
 * @param max - Hits allowed per hour.
 * @param message - Error message for the 429.
 * @returns null when allowed, otherwise the 429 response to send.
 */
async function limit(
  key: string,
  max: number,
  message: string,
): Promise<NextResponse | null> {
  const r = await checkRateLimit({ key, limit: max, windowMs: HOUR_MS });
  return r.allowed ? null : rateLimitResponse(r.retryAfterMs, message);
}

/**
 * Apply the per-IP cap on signed visa write attempts (20/hour).
 *
 * Bounds the RPC reads behind each attempt.
 *
 * @param ip - Client IP (getClientIp).
 * @returns null when allowed, otherwise a 429 response.
 */
export function limitVisaWriteAttempts(
  ip: string,
): Promise<NextResponse | null> {
  return limit(
    `visa-write:${ip}`,
    20,
    "Too many visa requests. Try again later.",
  );
}

/**
 * Reserve relayer budget immediately before the first transaction.
 *
 * Counts attempts, not successes, and increments atomically, so concurrent
 * requests cannot all slip past the check. Narrowest bucket first, so a
 * caller over its own budget does not use up the global one.
 *
 * @param ip - Client IP (5/hour).
 * @param signer - Recovered signer (2/hour).
 * @returns null when within every bucket (global: 50/hour), otherwise the
 *   429 response for the first bucket exceeded.
 */
export async function reserveRelayerTx(
  ip: string,
  signer: string,
): Promise<NextResponse | null> {
  return (
    (await limit(
      `visa-relayer:ip:${ip}`,
      5,
      "Rate limit exceeded: max 5 relayed visa transactions per hour.",
    )) ??
    (await limit(
      `visa-relayer:signer:${signer.toLowerCase()}`,
      2,
      "Rate limit exceeded: max 2 relayed visa transactions per signer per hour.",
    )) ??
    (await limit(
      "visa-relayer:global",
      50,
      "Visa relayer is busy. Try again later.",
    ))
  );
}

/** Requirements for one visa tier (getTierThresholds). */
interface TierThresholds {
  minTransactions: bigint;
  minVolumeUsd: bigint;
  requiresBoth: boolean;
  requiresManualReview: boolean;
}

/** Agent activity metrics; volumeUsd has 6 decimals. */
interface Metrics {
  transactionCount: bigint;
  volumeUsd: bigint;
}

/**
 * Check metrics against a tier's thresholds.
 *
 * Exact mirror of CeloAgentVisa._checkEligibility, so the routes can refuse
 * before spending relayer gas on a transaction that would revert.
 *
 * @param m - Agent metrics.
 * @param t - Tier thresholds.
 * @param manualReviewApproved - Whether the agent's manual review passed.
 * @returns True if the tier's requirements are met.
 */
export function meetsTierThresholds(
  m: Metrics,
  t: TierThresholds,
  manualReviewApproved: boolean,
): boolean {
  if (t.requiresManualReview && !manualReviewApproved) return false;
  const meetsTx = m.transactionCount >= t.minTransactions;
  const meetsVolume = m.volumeUsd >= t.minVolumeUsd;
  return t.requiresBoth ? meetsTx && meetsVolume : meetsTx || meetsVolume;
}

/**
 * Decide eligibility from reads alone.
 *
 * Uses stored metrics with the tx count raised to the wallet's live nonce.
 *
 * @param stored - Metrics stored on the visa contract.
 * @param liveTxCount - The agent wallet's current nonce.
 * @param t - Target tier thresholds.
 * @param manualReviewApproved - Whether the agent's manual review passed.
 * @returns `metrics` to use, `eligible` with them, and `update` when the
 *   stored metrics fall short (send updateMetrics before the mint / upgrade).
 */
export function planMetrics(
  stored: Metrics,
  liveTxCount: bigint,
  t: TierThresholds,
  manualReviewApproved: boolean,
): { metrics: Metrics; eligible: boolean; update: boolean } {
  const metrics = {
    transactionCount:
      liveTxCount > stored.transactionCount
        ? liveTxCount
        : stored.transactionCount,
    volumeUsd: stored.volumeUsd,
  };
  return {
    metrics,
    eligible: meetsTierThresholds(metrics, t, manualReviewApproved),
    update: !meetsTierThresholds(stored, t, manualReviewApproved),
  };
}

/**
 * Build the not-eligible response.
 *
 * @param tier - Tier that was requested.
 * @param m - Agent metrics.
 * @param t - Tier thresholds.
 * @returns 422 `{ error, code: "NOT_ELIGIBLE", metrics, required }`, USD
 *   values converted from 6 decimals.
 */
export function notEligibleResponse(
  tier: number,
  m: Metrics,
  t: TierThresholds,
): NextResponse {
  return jsonResponse(
    {
      error: `Agent does not meet requirements for tier ${tier}`,
      code: "NOT_ELIGIBLE",
      metrics: {
        transactionCount: Number(m.transactionCount),
        volumeUsd: Number(m.volumeUsd) / 1e6,
      },
      required: {
        minTransactions: Number(t.minTransactions),
        minVolumeUsd: Number(t.minVolumeUsd) / 1e6,
        requiresBoth: t.requiresBoth,
      },
    },
    422,
  );
}
