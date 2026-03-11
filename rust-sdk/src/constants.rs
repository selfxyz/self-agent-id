// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

use alloy::primitives::Address;
use alloy::sol;
use std::str::FromStr;

/// Supported network names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NetworkName {
    Mainnet,
    Testnet,
}

/// Per-network configuration (registry address + RPC URL).
#[derive(Debug, Clone)]
pub struct NetworkConfig {
    pub registry_address: Address,
    pub rpc_url: &'static str,
}

/// Get the network configuration for a given network.
pub fn network_config(network: NetworkName) -> NetworkConfig {
    match network {
        NetworkName::Mainnet => NetworkConfig {
            registry_address: Address::from_str("0xaC3DF9ABf80d0F5c020C06B04Cced27763355944")
                .unwrap(),
            rpc_url: "https://forno.celo.org",
        },
        NetworkName::Testnet => NetworkConfig {
            registry_address: Address::from_str("0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379")
                .unwrap(),
            rpc_url: "https://forno.celo-sepolia.celo-testnet.org",
        },
    }
}

/// Default network — production-safe.
pub const DEFAULT_NETWORK: NetworkName = NetworkName::Mainnet;

/// Default signature validity window (5 minutes).
pub const DEFAULT_MAX_AGE_MS: u64 = 5 * 60 * 1000;

/// Default cache TTL for on-chain status (1 minute).
pub const DEFAULT_CACHE_TTL_MS: u64 = 60_000;

/// Warning threshold: proofs expiring within this many days trigger `is_expiring_soon`.
pub const EXPIRY_WARNING_DAYS: i32 = 30;

/// Action byte for proof refresh requests.
pub const ACTION_REFRESH: u8 = 0x46;

/// Action byte for read-only nullifier identification.
pub const ACTION_IDENTIFY: u8 = 0x49;

/// Request headers used by the signing protocol.
pub mod headers {
    /// Agent's Ethereum address (informational — identity is recovered from signature).
    pub const ADDRESS: &str = "x-self-agent-address";
    /// ECDSA or Ed25519 signature over the request.
    pub const SIGNATURE: &str = "x-self-agent-signature";
    /// Unix timestamp (milliseconds) for replay protection.
    pub const TIMESTAMP: &str = "x-self-agent-timestamp";
    /// Key type: "ed25519" for Ed25519 agents; absent implies secp256k1 ECDSA.
    pub const KEYTYPE: &str = "x-self-agent-keytype";
    /// Agent's public key (used for Ed25519 agents).
    pub const KEY: &str = "x-self-agent-key";
}

// Registry ABI — matches the TS SDK's REGISTRY_ABI exactly.
sol! {
    #[sol(rpc)]
    interface IAgentRegistry {
        function isVerifiedAgent(bytes32 agentPubKey) external view returns (bool);
        function getAgentId(bytes32 agentPubKey) external view returns (uint256);
        function hasHumanProof(uint256 agentId) external view returns (bool);
        function getHumanNullifier(uint256 agentId) external view returns (uint256);
        function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
        function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);
        function getProofProvider(uint256 agentId) external view returns (address);
        function isProofFresh(uint256 agentId) external view returns (bool);
        function selfProofProvider() external view returns (address);
        function ownerOf(uint256 tokenId) external view returns (address);

        struct AgentCredentials {
            string issuingState;
            string[] name;
            string idNumber;
            string nationality;
            string dateOfBirth;
            string gender;
            string expiryDate;
            uint256 olderThan;
            bool[3] ofac;
        }
        function getAgentCredentials(uint256 agentId) external view returns (AgentCredentials);

        // A2A Agent Cards
        function getAgentMetadata(uint256 agentId) external view returns (string);
        function updateAgentMetadata(uint256 agentId, string metadata) external;
        function agentRegisteredAt(uint256 agentId) external view returns (uint256);
        // ERC-8004: proof expiry
        function proofExpiresAt(uint256 agentId) external view returns (uint256);
        // Replay-protection nonces for registration signatures
        function agentNonces(address agent) external view returns (uint256);
    }
}

// Provider ABI — used to query provider metadata.
sol! {
    #[sol(rpc)]
    interface IHumanProofProvider {
        function providerName() external view returns (string);
        function verificationStrength() external view returns (uint8);
    }
}
