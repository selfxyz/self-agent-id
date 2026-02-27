// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";
import {
  REGISTRY_ABI,
  PROVIDER_ABI,
  AGENT_DEMO_VERIFIER_ABI,
  AGENT_GATE_ABI,
} from "./constants";

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

/** Decoded result from AgentGate.checkAccess(). */
export interface GateAccessResult {
  agentId: bigint;
  olderThan: bigint;
  nationality: string;
}

// ─── Typed contract interfaces ───────────────────────────────────────────────

/** App-layer registry (superset of SDK registry — includes guardian, nonce, events). */
export interface TypedRegistryContract extends ethers.BaseContract {
  isVerifiedAgent(agentPubKey: string): Promise<boolean>;
  getAgentId(agentPubKey: string): Promise<bigint>;
  hasHumanProof(agentId: bigint): Promise<boolean>;
  getHumanNullifier(agentId: bigint): Promise<bigint>;
  getAgentCountForHuman(nullifier: bigint): Promise<bigint>;
  sameHuman(agentIdA: bigint, agentIdB: bigint): Promise<boolean>;
  agentRegisteredAt(agentId: bigint): Promise<bigint>;
  ownerOf(tokenId: bigint): Promise<string>;
  balanceOf(owner: string): Promise<bigint>;
  scope(): Promise<bigint>;
  agentIdToAgentKey(agentId: bigint): Promise<string>;
  agentHasHumanProof(agentId: bigint): Promise<boolean>;
  agentProofProvider(agentId: bigint): Promise<string>;
  agentGuardian(agentId: bigint): Promise<string>;
  getAgentMetadata(agentId: bigint): Promise<string>;
  guardianRevoke: ethers.BaseContractMethod<
    [bigint],
    void,
    ethers.ContractTransactionResponse
  >;
  selfDeregister: ethers.BaseContractMethod<
    [bigint],
    void,
    ethers.ContractTransactionResponse
  >;
  updateAgentMetadata: ethers.BaseContractMethod<
    [bigint, string],
    void,
    ethers.ContractTransactionResponse
  >;
  getAgentCredentials(agentId: bigint): Promise<AgentCredentials>;
  agentNonces(agent: string): Promise<bigint>;
  getProofProvider(agentId: bigint): Promise<string>;
  selfProofProvider(): Promise<string>;
  proofExpiresAt(agentId: bigint): Promise<bigint>;
  isProofFresh(agentId: bigint): Promise<boolean>;
}

/** Typed view of the IHumanProofProvider contract. */
export interface TypedProviderContract extends ethers.BaseContract {
  providerName(): Promise<string>;
  verificationStrength(): Promise<number>;
}

/** Typed view of the AgentDemoVerifier contract. */
export interface TypedDemoVerifierContract extends ethers.BaseContract {
  metaVerifyAgent: ethers.BaseContractMethod<
    [string, bigint, bigint, string],
    bigint,
    ethers.ContractTransactionResponse
  >;
  checkAccess(agentKey: string): Promise<bigint>;
  hasVerified(agentKey: string): Promise<boolean>;
  verificationCount(agentKey: string): Promise<bigint>;
  nonces(agentKey: string): Promise<bigint>;
  totalVerifications(): Promise<bigint>;
  DOMAIN_SEPARATOR(): Promise<string>;
  registry(): Promise<string>;
}

/** Typed view of the AgentGate demo contract. */
export interface TypedGateContract extends ethers.BaseContract {
  checkAccess(agentKey: string): Promise<GateAccessResult>;
  gatedAction: ethers.BaseContractMethod<
    [string],
    void,
    ethers.ContractTransactionResponse
  >;
  registry(): Promise<string>;
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

/** Create a typed demo verifier contract instance. */
export function typedDemoVerifier(
  address: string,
  runner: ethers.ContractRunner,
): TypedDemoVerifierContract {
  return new ethers.Contract(
    address,
    AGENT_DEMO_VERIFIER_ABI,
    runner,
  ) as unknown as TypedDemoVerifierContract;
}

/** Create a typed gate contract instance. */
export function typedGate(
  address: string,
  runner: ethers.ContractRunner,
): TypedGateContract {
  return new ethers.Contract(
    address,
    AGENT_GATE_ABI,
    runner,
  ) as unknown as TypedGateContract;
}
