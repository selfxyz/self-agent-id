// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Result type for the standalone `verifyAgent()` helper, plus proof-expiry helpers.
 */

/**
 * Discriminated union result type for standalone `verifyAgent()`.
 *
 * - `verified: true`  → agent is registered, has a valid (non-expired) human proof
 * - `verified: false, reason: 'NOT_REGISTERED'` → no agent found for this key
 * - `verified: false, reason: 'NO_HUMAN_PROOF'` → agent exists but has no human proof
 * - `verified: false, reason: 'PROOF_EXPIRED'`  → proof existed but has lapsed
 */
export type VerifyResult =
  | { verified: true; agentId: bigint; expiresAt: Date | null }
  | { verified: false; reason: "NOT_REGISTERED" | "NO_HUMAN_PROOF" }
  | {
      verified: false;
      reason: "PROOF_EXPIRED";
      expiredAt: Date;
      reauthUrl: string;
    };

/** Seconds before expiry at which the proof is considered "expiring soon" (30 days). */
export const EXPIRY_WARNING_THRESHOLD_SECS = 30 * 24 * 60 * 60;

/**
 * Check whether a proof is still valid but expires within the warning threshold.
 *
 * Use this to prompt users to re-authenticate before the proof lapses.
 *
 * @param expiresAt - When the human proof expires.
 * @param thresholdSecs - Warning window in seconds (default 30 days).
 * @returns True if `expiresAt` is in the future and less than `thresholdSecs` away.
 */
export function isProofExpiringSoon(
  expiresAt: Date,
  thresholdSecs = EXPIRY_WARNING_THRESHOLD_SECS,
): boolean {
  const secsUntilExpiry = (expiresAt.getTime() - Date.now()) / 1000;
  return secsUntilExpiry > 0 && secsUntilExpiry < thresholdSecs;
}
