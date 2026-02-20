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
            registry_address: Address::from_str("0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095")
                .unwrap(),
            rpc_url: "https://forno.celo.org",
        },
        NetworkName::Testnet => NetworkConfig {
            registry_address: Address::from_str("0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b")
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
    }
}
