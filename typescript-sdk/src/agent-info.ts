// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Shared on-chain agent status reader used by `SelfAgent` and `Ed25519Agent`.
 */

import type { TypedRegistryContract } from "./contract-types";
import { isProofExpiringSoon } from "./types";

/** On-chain status of an agent, as returned by `getInfo()` on either agent class. */
export interface AgentInfo {
  /** Agent's address (EVM address; for Ed25519 agents, derived from the public key) */
  address: string;
  /** bytes32 key the registry indexes the agent by */
  agentKey: string;
  /** Agent ID (NFT token ID); `0n` when not registered */
  agentId: bigint;
  /** `hasHumanProof && isProofFresh` — the only meaning of "verified" */
  isVerified: boolean;
  /** A human proof was recorded (it may have expired; see `isProofFresh`) */
  hasHumanProof: boolean;
  /** Human's nullifier (same value for every agent of the same human) */
  nullifier: bigint;
  /** Number of agents registered by the same human */
  agentCount: bigint;
  /** Proof expiry as a Unix timestamp in seconds; `0n` when none */
  proofExpiresAt: bigint;
  isProofFresh: boolean;
  /** Whole days until expiry, rounded down (negative once expired); `null` when no expiry is set */
  daysUntilExpiry: number | null;
  /** Proof has not expired yet but expires within 30 days (`isProofExpiringSoon`) */
  isExpiringSoon: boolean;
  /** All agent IDs registered by the same human (including this one) */
  siblingAgentIds: bigint[];
}

/**
 * Read an agent's on-chain state. Shared by `SelfAgent` and `Ed25519Agent`;
 * not part of the public API.
 *
 * @param registry - Registry contract to read from.
 * @param address - Agent address, echoed back in the result.
 * @param agentKey - bytes32 agent key to look up.
 * @returns The agent's status; an all-zero record with `agentId: 0n` when not registered.
 * @throws If any RPC call fails.
 */
export async function readAgentInfo(
  registry: TypedRegistryContract,
  address: string,
  agentKey: string,
): Promise<AgentInfo> {
  const agentId: bigint = await registry.getAgentId(agentKey);
  if (agentId === 0n) {
    return {
      address,
      agentKey,
      agentId: 0n,
      isVerified: false,
      hasHumanProof: false,
      nullifier: 0n,
      agentCount: 0n,
      proofExpiresAt: 0n,
      isProofFresh: false,
      daysUntilExpiry: null,
      isExpiringSoon: false,
      siblingAgentIds: [],
    };
  }

  const [hasHumanProof, nullifier] = await Promise.all([
    registry.hasHumanProof(agentId),
    registry.getHumanNullifier(agentId),
  ]);

  const [agentCount, proofExpiresAt, isProofFresh, siblingAgentIds] =
    await Promise.all([
      registry.getAgentCountForHuman(nullifier),
      registry.proofExpiresAt(agentId),
      registry.isProofFresh(agentId),
      registry.getAgentsForNullifier(nullifier),
    ]);

  // Math.floor (not bigint division, which truncates toward zero) so this
  // matches VerificationResult.daysUntilExpiry: expired by hours = -1, not 0.
  const now = Math.floor(Date.now() / 1000);
  const daysUntilExpiry =
    proofExpiresAt > 0n
      ? Math.floor((Number(proofExpiresAt) - now) / 86400)
      : null;
  const isExpiringSoon =
    proofExpiresAt > 0n &&
    isProofExpiringSoon(new Date(Number(proofExpiresAt) * 1000));

  return {
    address,
    agentKey,
    agentId,
    isVerified: hasHumanProof && isProofFresh,
    hasHumanProof,
    nullifier,
    agentCount,
    proofExpiresAt,
    isProofFresh,
    daysUntilExpiry,
    isExpiringSoon,
    siblingAgentIds,
  };
}
