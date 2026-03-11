// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";
import { REGISTRY_ABI, PROVIDER_ABI } from "./constants";

// ─── Return types ────────────────────────────────────────────────────────────

/** Decoded credentials struct returned by getAgentCredentials(). */
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

/** Create a typed registry contract instance. */
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

/** Create a typed provider contract instance. */
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
