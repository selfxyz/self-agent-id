// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Human-readable ethers ABIs for the registry, proof provider and visa contracts.
 *
 * The registry ABI here is a superset of the SDK's REGISTRY_ABI: it adds the
 * public mapping getters (agentGuardian, agentNonces, ...), management calls
 * and events. API routes use these via the typed wrappers in contract-types.ts.
 */

/** SelfAgentRegistry functions and events the API reads or calls. */
export const REGISTRY_ABI = [
  "function isVerifiedAgent(bytes32 agentPubKey) view returns (bool)",
  "function getAgentId(bytes32 agentPubKey) view returns (uint256)",
  "function hasHumanProof(uint256 agentId) view returns (bool)",
  "function getHumanNullifier(uint256 agentId) view returns (uint256)",
  "function getAgentCountForHuman(uint256 nullifier) view returns (uint256)",
  "function sameHuman(uint256 agentIdA, uint256 agentIdB) view returns (bool)",
  "function agentRegisteredAt(uint256 agentId) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function scope() view returns (uint256)",
  "function agentIdToAgentKey(uint256 agentId) view returns (bytes32)",
  "function agentHasHumanProof(uint256 agentId) view returns (bool)",
  "function agentProofProvider(uint256 agentId) view returns (address)",
  // V4 additions
  "function agentGuardian(uint256 agentId) view returns (address)",
  "function getAgentMetadata(uint256 agentId) view returns (string)",
  "function guardianRevoke(uint256 agentId)",
  "function selfDeregister(uint256 agentId)",
  "function updateAgentMetadata(uint256 agentId, string metadata)",
  // V5: ZK-attested credentials
  "function getAgentCredentials(uint256 agentId) view returns ((string issuingState, string[] name, string idNumber, string nationality, string dateOfBirth, string gender, string expiryDate, uint256 olderThan, bool[3] ofac))",
  // V5: per-agent nonce for replay-attack prevention on advanced/wallet-free registration
  "function agentNonces(address agent) view returns (uint256)",
  // Ed25519 registration nonce
  "function ed25519Nonce(bytes32 pubkey) view returns (uint256)",
  // Standard interface aliases (match SDK REGISTRY_ABI naming)
  "function getProofProvider(uint256 agentId) view returns (address)",
  "function selfProofProvider() view returns (address)",
  // ERC-8004: proof expiry
  "function proofExpiresAt(uint256 agentId) view returns (uint256)",
  "function isProofFresh(uint256 agentId) view returns (bool)",
  // ERC-8004: agents-by-nullifier lookup
  "function getAgentsForNullifier(uint256 nullifier) view returns (uint256[])",
  "function getAgentsForNullifier(uint256 nullifier, uint256 offset, uint256 limit) view returns (uint256[])",
  // Agent config identifier (used for proof refresh)
  "function agentConfigId(uint256 agentId) view returns (bytes32)",
  "function configIds(uint256 index) view returns (bytes32)",
  "function getAgentWallet(uint256 agentId) external view returns (address)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
  // Proof refresh event
  "event HumanProofRefreshed(uint256 indexed agentId, uint256 nullifier, uint256 newExpiresAt, bytes32 configId)",
  "event NullifierIdentified(uint256 indexed nullifier, uint256 agentCount)",
] as const;

/** IHumanProofProvider metadata getters. */
export const PROVIDER_ABI = [
  "function providerName() view returns (string)",
  "function verificationStrength() view returns (uint8)",
] as const;

/** CeloAgentVisa: on-chain visa / reputation tiers. */
export const VISA_ABI = [
  "function getTier(uint256 agentId) external view returns (uint8)",
  "function getMetrics(uint256 agentId) external view returns (uint256 transactionCount, uint256 volumeUsd, uint64 lastUpdated)",
  "function checkTierEligibility(uint256 agentId, uint8 tier) external view returns (bool)",
  "function getTokenId(uint256 agentId) external view returns (uint256)",
  "function getAgentId(uint256 tokenId) external view returns (uint256)",
  "function getTierThresholds(uint8 tier) external view returns (uint256 minTransactions, uint256 minVolumeUsd, bool requiresBoth, bool requiresManualReview)",
  "function claimTierUpgrade(uint256 agentId, uint8 targetTier) external",
  "function mintVisa(uint256 agentId, uint8 tier, address wallet) external",
  "function getVisaWallet(uint256 agentId) external view returns (address)",
  "function setVisaWallet(uint256 agentId, address wallet) external",
  "function requestReview(uint256 agentId, uint8 targetTier) external",
  "function reviewRequestedTier(uint256 agentId) external view returns (uint8)",
  "function manualReviewApproved(uint256 agentId) external view returns (bool)",
  "function hasRole(bytes32 role, address account) external view returns (bool)",
  "function UPGRADER_ROLE() external view returns (bytes32)",
  "function setManualReviewStatus(uint256 agentId, bool approved) external",
  "function updateMetrics(uint256 agentId, uint256 transactionCount, uint256 volumeUsd) external",
  "event ReviewRequested(uint256 indexed agentId, uint8 targetTier)",
] as const;
