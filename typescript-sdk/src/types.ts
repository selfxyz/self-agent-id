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
export const EXPIRY_WARNING_THRESHOLD_SECS = 30 * 24 * 60 * 60; // 30 days

/**
 * Returns true if the proof expires within the warning threshold and has not
 * yet expired. Use this to prompt users to re-authenticate proactively.
 */
export function isProofExpiringSoon(
  expiresAt: Date,
  thresholdSecs = EXPIRY_WARNING_THRESHOLD_SECS,
): boolean {
  const secsUntilExpiry = (expiresAt.getTime() - Date.now()) / 1000;
  return secsUntilExpiry > 0 && secsUntilExpiry < thresholdSecs;
}
