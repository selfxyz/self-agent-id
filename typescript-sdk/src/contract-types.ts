// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Typed ethers views of the SelfAgentRegistry and IHumanProofProvider contracts.
 *
 * The ABIs live in `constants.ts`; these interfaces must stay in sync with them.
 */

import { ethers } from "ethers";
import { REGISTRY_ABI, PROVIDER_ABI } from "./constants";

// ─── Return types ────────────────────────────────────────────────────────────

/** Decoded credentials struct returned by `getAgentCredentials()` (fields are empty when not disclosed). */
export interface AgentCredentials {
  issuingState: string;
  name: string[];
  idNumber: string;
  nationality: string;
  dateOfBirth: string;
  gender: string;
  expiryDate: string;
  olderThan: bigint;
  ofac: [boolean, boolean, boolean];
}

// ─── Typed contract interfaces ───────────────────────────────────────────────

/** Typed view of the SelfAgentRegistry contract. */
export interface TypedRegistryContract extends ethers.BaseContract {
  isVerifiedAgent(agentPubKey: string): Promise<boolean>;
  getAgentId(agentPubKey: string): Promise<bigint>;
  hasHumanProof(agentId: bigint): Promise<boolean>;
  getHumanNullifier(agentId: bigint): Promise<bigint>;
  getAgentCountForHuman(nullifier: bigint): Promise<bigint>;
  sameHuman(agentIdA: bigint, agentIdB: bigint): Promise<boolean>;
  getProofProvider(agentId: bigint): Promise<string>;
  selfProofProvider(): Promise<string>;
  ownerOf(tokenId: bigint): Promise<string>;
  getAgentCredentials(agentId: bigint): Promise<AgentCredentials>;
  getAgentMetadata(agentId: bigint): Promise<string>;
  updateAgentMetadata: ethers.BaseContractMethod<
    [bigint, string],
    void,
    ethers.ContractTransactionResponse
  >;
  agentRegisteredAt(agentId: bigint): Promise<bigint>;
  proofExpiresAt(agentId: bigint): Promise<bigint>;
  isProofFresh(agentId: bigint): Promise<boolean>;
  agentNonces(agent: string): Promise<bigint>;
  getAgentsForNullifier(nullifier: bigint): Promise<bigint[]>;
  agentConfigId(agentId: bigint): Promise<string>; // bytes32
}

/** Typed view of the IHumanProofProvider contract. */
export interface TypedProviderContract extends ethers.BaseContract {
  providerName(): Promise<string>;
  verificationStrength(): Promise<number>;
}

// ─── Constructor helpers ─────────────────────────────────────────────────────

/**
 * Create a typed SelfAgentRegistry contract instance.
 *
 * @param address - Registry contract address.
 * @param runner - Provider (read-only) or signer (for `updateAgentMetadata`).
 * @returns The contract cast to `TypedRegistryContract`.
 */
export function typedRegistry(
  address: string,
  runner: ethers.ContractRunner,
): TypedRegistryContract {
  return new ethers.Contract(
    address,
    REGISTRY_ABI,
    runner,
  ) as unknown as TypedRegistryContract;
}

/**
 * Create a typed IHumanProofProvider contract instance.
 *
 * @param address - Proof provider contract address (from `getProofProvider`).
 * @param runner - Provider or signer to call through.
 * @returns The contract cast to `TypedProviderContract`.
 */
export function typedProvider(
  address: string,
  runner: ethers.ContractRunner,
): TypedProviderContract {
  return new ethers.Contract(
    address,
    PROVIDER_ABI,
    runner,
  ) as unknown as TypedProviderContract;
}
