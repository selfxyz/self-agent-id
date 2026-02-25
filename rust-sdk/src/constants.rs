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
            registry_address: Address::from_str("0x60651482a3033A72128f874623Fc790061cc46D4")
                .unwrap(),
            rpc_url: "https://forno.celo.org",
        },
        NetworkName::Testnet => NetworkConfig {
            registry_address: Address::from_str("0x29d941856134b1D053AfFF57fa560324510C79fa")
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

/// Request headers used by the signing protocol.
pub mod headers {
    /// Agent's Ethereum address (informational — identity is recovered from signature).
    pub const ADDRESS: &str = "x-self-agent-address";
    /// ECDSA signature over the request.
    pub const SIGNATURE: &str = "x-self-agent-signature";
    /// Unix timestamp (milliseconds) for replay protection.
    pub const TIMESTAMP: &str = "x-self-agent-timestamp";
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
