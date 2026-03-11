// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

//! Agent-side SDK for Self Agent ID using Ed25519 key pairs.
//!
//! The agent's on-chain identity is its raw 32-byte Ed25519 public key:
//!   `agentKey = "0x" + hex(publicKey)`
//!
//! For off-chain authentication, the agent signs each request with Ed25519.
//! Services verify the signature using the public key and check on-chain status.

use alloy::primitives::{keccak256, Address, B256, U256};
use alloy::providers::ProviderBuilder;
use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use reqwest::{Client, Method, RequestBuilder, Response};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::agent::{compute_signing_message, AgentInfo};
use crate::constants::{
    headers, network_config, IAgentRegistry, NetworkName, DEFAULT_NETWORK,
};

/// Configuration for creating an [`Ed25519Agent`].
#[derive(Debug, Clone)]
pub struct Ed25519AgentConfig {
    /// Ed25519 private key (hex, with or without 0x prefix). 32 bytes.
    pub private_key: String,
    /// Network to use: Mainnet (default) or Testnet.
    pub network: Option<NetworkName>,
    /// Override: custom registry address.
    pub registry_address: Option<Address>,
    /// Override: custom RPC URL.
    pub rpc_url: Option<String>,
}

/// Agent-side SDK for Self Agent ID using Ed25519 key pairs.
///
/// The agent's on-chain identity is its raw 32-byte Ed25519 public key.
/// For off-chain authentication, the agent signs each request with Ed25519.
/// Services verify the signature using the public key and check on-chain status.
///
/// # Example
///
/// ```no_run
/// use self_agent_sdk::{Ed25519Agent, Ed25519AgentConfig, NetworkName};
///
/// # fn main() -> Result<(), Box<dyn std::error::Error>> {
/// # tokio::runtime::Runtime::new()?.block_on(async {
/// let agent = Ed25519Agent::new(Ed25519AgentConfig {
///     private_key: "0x...".to_string(),
///     network: Some(NetworkName::Testnet),
///     registry_address: None,
///     rpc_url: None,
/// })?;
///
/// let registered = agent.is_registered().await?;
/// let response = agent.fetch("https://api.example.com/data", None, None).await?;
/// # let _ = (registered, response);
/// # Ok::<(), Box<dyn std::error::Error>>(())
/// # })?;
/// # Ok(())
/// # }
/// ```
pub struct Ed25519Agent {
    signing_key: SigningKey,
    registry_address: Address,
    rpc_url: String,
    agent_key: B256,
    address: Address,
    http_client: Client,
}

impl Ed25519Agent {
    /// Create a new Ed25519 agent instance.
    pub fn new(config: Ed25519AgentConfig) -> Result<Self, crate::Error> {
        let network_name = config.network.unwrap_or(DEFAULT_NETWORK);
        let net = network_config(network_name);

        let priv_hex = config
            .private_key
            .strip_prefix("0x")
            .unwrap_or(&config.private_key);

        let key_bytes = hex::decode(priv_hex).map_err(|_| crate::Error::InvalidPrivateKey)?;
        let key_array: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| crate::Error::InvalidPrivateKey)?;

        let signing_key = SigningKey::from_bytes(&key_array);
        let verifying_key: VerifyingKey = signing_key.verifying_key();
        let pubkey_bytes = verifying_key.to_bytes();

        // Agent key = raw 32-byte public key (already bytes32)
        let agent_key = B256::from(pubkey_bytes);

        // Derive deterministic Ethereum-style address: keccak256(pubkey), last 20 bytes
        let address = derive_address_from_pubkey(&pubkey_bytes);

        Ok(Self {
            signing_key,
            registry_address: config.registry_address.unwrap_or(net.registry_address),
            rpc_url: config.rpc_url.unwrap_or_else(|| net.rpc_url.to_string()),
            agent_key,
            address,
            http_client: Client::new(),
        })
    }

    /// The agent's deterministic Ethereum-style address derived from keccak256(pubkey).
    pub fn address(&self) -> Address {
        self.address
    }

    /// The agent's on-chain key (bytes32) — raw Ed25519 public key.
    pub fn agent_key(&self) -> B256 {
        self.agent_key
    }

    /// The agent's raw 32-byte Ed25519 public key as 0x-prefixed hex.
    pub fn agent_key_hex(&self) -> String {
        format!("0x{}", hex::encode(self.agent_key.as_slice()))
    }

    fn make_provider(
        &self,
    ) -> Result<impl alloy::providers::Provider + Clone, crate::Error> {
        let url: reqwest::Url = self
            .rpc_url
            .parse()
            .map_err(|_| crate::Error::InvalidRpcUrl)?;
        Ok(ProviderBuilder::new().connect_http(url))
    }

    /// Check if this agent is registered and verified on-chain.
    pub async fn is_registered(&self) -> Result<bool, crate::Error> {
        let provider = self.make_provider()?;
        let registry = IAgentRegistry::new(self.registry_address, provider);
        let result = registry
            .isVerifiedAgent(self.agent_key)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        Ok(result)
    }

    /// Get full agent info from the registry.
    pub async fn get_info(&self) -> Result<AgentInfo, crate::Error> {
        let provider = self.make_provider()?;
        let registry = IAgentRegistry::new(self.registry_address, provider);

        let agent_id = registry
            .getAgentId(self.agent_key)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;

        if agent_id == U256::ZERO {
            return Ok(AgentInfo {
                address: self.address,
                agent_key: self.agent_key,
                agent_id: U256::ZERO,
                is_verified: false,
                nullifier: U256::ZERO,
                agent_count: U256::ZERO,
            });
        }

        let is_verified = registry
            .hasHumanProof(agent_id)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        let nullifier = registry
            .getHumanNullifier(agent_id)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        let agent_count = registry
            .getAgentCountForHuman(nullifier)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;

        Ok(AgentInfo {
            address: self.address,
            agent_key: self.agent_key,
            agent_id,
            is_verified,
            nullifier,
            agent_count,
        })
    }

    /// Generate authentication headers for a request.
    ///
    /// Signature covers: `keccak256(timestamp + METHOD + canonicalPathAndQuery + bodyHash)`
    /// Signed with Ed25519 instead of ECDSA.
    pub fn sign_request(
        &self,
        method: &str,
        url: &str,
        body: Option<&str>,
    ) -> HashMap<String, String> {
        let timestamp = now_millis().to_string();
        self.sign_request_with_timestamp(method, url, body, &timestamp)
    }

    /// Sign a request with a specific timestamp (useful for testing).
    pub fn sign_request_with_timestamp(
        &self,
        method: &str,
        url: &str,
        body: Option<&str>,
        timestamp: &str,
    ) -> HashMap<String, String> {
        let message = compute_signing_message(timestamp, method, url, body);

        // Sign the raw 32-byte keccak256 hash with Ed25519 (no EIP-191 prefix)
        let signature = self.signing_key.sign(message.as_ref());
        let sig_hex = format!("0x{}", hex::encode(signature.to_bytes()));

        let mut headers_map = HashMap::new();
        headers_map.insert(
            headers::KEY.to_string(),
            self.agent_key_hex(),
        );
        headers_map.insert(
            headers::KEYTYPE.to_string(),
            "ed25519".to_string(),
        );
        headers_map.insert(headers::SIGNATURE.to_string(), sig_hex);
        headers_map.insert(headers::TIMESTAMP.to_string(), timestamp.to_string());

        headers_map
    }

    /// Wrapper around reqwest that automatically adds agent signature headers.
    pub async fn fetch(
        &self,
        url: &str,
        method: Option<Method>,
        body: Option<String>,
    ) -> Result<Response, crate::Error> {
        let method = method.unwrap_or(Method::GET);
        let method_str = method.as_str();
        let body_ref = body.as_deref();

        let auth_headers = self.sign_request(method_str, url, body_ref);

        let mut request: RequestBuilder = self.http_client.request(method, url);
        for (k, v) in &auth_headers {
            request = request.header(k, v);
        }
        if let Some(b) = body {
            request = request.header("content-type", "application/json");
            request = request.body(b);
        }

        request
            .send()
            .await
            .map_err(|e| crate::Error::HttpError(e.to_string()))
    }
}

/// Derive a deterministic Ethereum-style address from an Ed25519 public key.
///
/// Matches the on-chain `Ed25519Verifier.deriveAddress()`:
///   `address(uint160(uint256(keccak256(pubkey))))`
pub fn derive_address_from_pubkey(pubkey: &[u8; 32]) -> Address {
    Address::from_slice(&keccak256(pubkey)[12..])
}

/// Current time in milliseconds since Unix epoch.
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ed25519_agent_creation() {
        // Known test key (32 bytes of zeros is a valid Ed25519 private key for testing)
        let config = Ed25519AgentConfig {
            private_key: "0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
                .to_string(),
            network: Some(NetworkName::Testnet),
            registry_address: None,
            rpc_url: None,
        };

        let agent = Ed25519Agent::new(config).unwrap();

        // Agent key should be 0x-prefixed 64 hex chars (32 bytes)
        let key_hex = agent.agent_key_hex();
        assert!(key_hex.starts_with("0x"));
        assert_eq!(key_hex.len(), 66); // "0x" + 64 hex chars

        // Address should be a valid 20-byte address
        assert_ne!(agent.address(), Address::ZERO);
    }

    #[test]
    fn ed25519_sign_request_headers() {
        let config = Ed25519AgentConfig {
            private_key: "0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
                .to_string(),
            network: Some(NetworkName::Testnet),
            registry_address: None,
            rpc_url: None,
        };

        let agent = Ed25519Agent::new(config).unwrap();
        let headers = agent.sign_request_with_timestamp("GET", "/api/test", None, "1700000000000");

        assert!(headers.contains_key(headers::KEY));
        assert_eq!(headers.get(headers::KEYTYPE).unwrap(), "ed25519");
        assert!(headers.get(headers::SIGNATURE).unwrap().starts_with("0x"));
        assert_eq!(headers.get(headers::TIMESTAMP).unwrap(), "1700000000000");

        // Signature should be 64 bytes (128 hex chars + "0x" prefix)
        let sig = headers.get(headers::SIGNATURE).unwrap();
        assert_eq!(sig.len(), 130); // "0x" + 128 hex chars
    }

    #[test]
    fn ed25519_sign_request_deterministic() {
        let config = Ed25519AgentConfig {
            private_key: "0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
                .to_string(),
            network: Some(NetworkName::Testnet),
            registry_address: None,
            rpc_url: None,
        };

        let agent = Ed25519Agent::new(config).unwrap();

        let h1 = agent.sign_request_with_timestamp("POST", "/api/data", Some(r#"{"test":true}"#), "1700000000000");
        let h2 = agent.sign_request_with_timestamp("POST", "/api/data", Some(r#"{"test":true}"#), "1700000000000");

        // Same input should produce the same signature (Ed25519 is deterministic)
        assert_eq!(
            h1.get(headers::SIGNATURE),
            h2.get(headers::SIGNATURE),
        );
    }

    #[test]
    fn ed25519_derive_address() {
        let config = Ed25519AgentConfig {
            private_key: "0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
                .to_string(),
            network: Some(NetworkName::Testnet),
            registry_address: None,
            rpc_url: None,
        };

        let agent = Ed25519Agent::new(config).unwrap();

        // Verify the address derivation is consistent
        let pubkey_bytes: [u8; 32] = agent.agent_key().0;
        let derived = derive_address_from_pubkey(&pubkey_bytes);
        assert_eq!(derived, agent.address());
    }

    #[test]
    fn ed25519_invalid_key_length() {
        let config = Ed25519AgentConfig {
            private_key: "0xdeadbeef".to_string(), // too short
            network: None,
            registry_address: None,
            rpc_url: None,
        };
        assert!(Ed25519Agent::new(config).is_err());
    }

    #[test]
    fn ed25519_invalid_key_hex() {
        let config = Ed25519AgentConfig {
            private_key: "not-hex-at-all".to_string(),
            network: None,
            registry_address: None,
            rpc_url: None,
        };
        assert!(Ed25519Agent::new(config).is_err());
    }

    #[test]
    fn ed25519_sign_verify_roundtrip() {
        use ed25519_dalek::Verifier;

        let config = Ed25519AgentConfig {
            private_key: "0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60"
                .to_string(),
            network: Some(NetworkName::Testnet),
            registry_address: None,
            rpc_url: None,
        };

        let agent = Ed25519Agent::new(config).unwrap();
        let headers = agent.sign_request_with_timestamp("GET", "/api/test", None, "1700000000000");

        // Reconstruct the message the same way verifier would
        let message = compute_signing_message("1700000000000", "GET", "/api/test", None);

        // Parse signature
        let sig_hex = headers.get(headers::SIGNATURE).unwrap();
        let sig_bytes = hex::decode(sig_hex.strip_prefix("0x").unwrap()).unwrap();
        let signature = ed25519_dalek::Signature::from_bytes(&sig_bytes.try_into().unwrap());

        // Parse public key from the KEY header
        let key_hex = headers.get(headers::KEY).unwrap();
        let key_bytes = hex::decode(key_hex.strip_prefix("0x").unwrap()).unwrap();
        let pubkey = VerifyingKey::from_bytes(&key_bytes.try_into().unwrap()).unwrap();

        // Verify
        assert!(pubkey.verify(message.as_ref(), &signature).is_ok());
    }
}
