// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

export const REGISTRY_ABI = [
  "function isVerifiedAgent(bytes32 agentPubKey) view returns (bool)",
  "function getAgentId(bytes32 agentPubKey) view returns (uint256)",
  "function hasHumanProof(uint256 agentId) view returns (bool)",
  "function getHumanNullifier(uint256 agentId) view returns (uint256)",
  "function getAgentCountForHuman(uint256 nullifier) view returns (uint256)",
  "function sameHuman(uint256 agentIdA, uint256 agentIdB) view returns (bool)",
  "function getProofProvider(uint256 agentId) view returns (address)",
  "function selfProofProvider() view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  // V5: ZK-attested credentials
  "function getAgentCredentials(uint256 agentId) view returns ((string issuingState, string[] name, string idNumber, string nationality, string dateOfBirth, string gender, string expiryDate, uint256 olderThan, bool[3] ofac))",
  // A2A Agent Cards
  "function getAgentMetadata(uint256 agentId) view returns (string)",
  "function updateAgentMetadata(uint256 agentId, string metadata)",
  "function agentRegisteredAt(uint256 agentId) view returns (uint256)",
  // ERC-8004: proof expiry
  "function proofExpiresAt(uint256 agentId) view returns (uint256)",
  "function isProofFresh(uint256 agentId) view returns (bool)",
  // Replay-protection nonces for registration signatures
  "function agentNonces(address agent) view returns (uint256)",
  // Nullifier → agent lookups
  "function getAgentsForNullifier(uint256 nullifier) view returns (uint256[])",
  "function getAgentsForNullifier(uint256 nullifier, uint256 offset, uint256 limit) view returns (uint256[])",
  // Agent config identifier
  "function agentConfigId(uint256 agentId) view returns (bytes32)",
  // Proof refresh event
  "event HumanProofRefreshed(uint256 indexed agentId, uint256 newExpiry, uint256 nullifier, bytes32 configId)",
  // Nullifier identification event (read-only passport scan)
  "event NullifierIdentified(uint256 indexed nullifier, uint256 agentCount)",
] as const;

/** ABI for IHumanProofProvider — used to query provider metadata */
export const PROVIDER_ABI = [
  "function providerName() view returns (string)",
  "function verificationStrength() view returns (uint8)",
] as const;

/** Supported network names */
export type NetworkName = "mainnet" | "testnet";

/** Per-network configuration (registry address + RPC URL) */
export const NETWORKS: Record<
  NetworkName,
  { registryAddress: string; rpcUrl: string }
> = {
  mainnet: {
    registryAddress: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
    rpcUrl: "https://forno.celo.org",
  },
  testnet: {
    registryAddress: "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
    rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
  },
};

/** Default network — production-safe */
export const DEFAULT_NETWORK: NetworkName = "mainnet";

/** @deprecated Use NETWORKS[network].registryAddress instead */
export const DEFAULT_REGISTRY_ADDRESS = NETWORKS.mainnet.registryAddress;

/** @deprecated Use NETWORKS[network].rpcUrl instead */
export const DEFAULT_RPC_URL = NETWORKS.mainnet.rpcUrl;

/** Self Hub V2 action byte for proof refresh */
export const ACTION_REFRESH = 0x46; // 'F'
export const ACTION_IDENTIFY = 0x49; // 'I'

/** Default signature validity window (5 minutes) */
export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/** Default cache TTL for on-chain status (1 minute) */
export const DEFAULT_CACHE_TTL_MS = 60_000;

/** Base URL for the human proof re-authentication portal. */
export const REAUTH_BASE_URL = "https://app.ai.self.xyz";

/** Request headers used by the signing protocol */
export const HEADERS = {
  /** Agent's Ethereum address (informational — identity is recovered from signature) */
  ADDRESS: "x-self-agent-address",
  /** ECDSA or Ed25519 signature over the request */
  SIGNATURE: "x-self-agent-signature",
  /** Unix timestamp (milliseconds) for replay protection */
  TIMESTAMP: "x-self-agent-timestamp",
  /** Key type: "ed25519" for Ed25519 agents; absent implies secp256k1 ECDSA */
  KEYTYPE: "x-self-agent-keytype",
  /** Agent's public key (used for Ed25519 agents) */
  KEY: "x-self-agent-key",
} as const;
