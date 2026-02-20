use alloy::primitives::{keccak256, Address, B256, FixedBytes, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::Signer;
use reqwest::{Client, Method, RequestBuilder, Response};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::constants::{
    headers, network_config, IAgentRegistry, NetworkName, DEFAULT_NETWORK,
};

/// Configuration for creating a [`SelfAgent`].
#[derive(Debug, Clone)]
pub struct SelfAgentConfig {
    /// Agent's private key (hex, with or without 0x prefix).
    pub private_key: String,
    /// Network to use: Mainnet (default) or Testnet.
    pub network: Option<NetworkName>,
    /// Override: custom registry address (takes precedence over network).
    pub registry_address: Option<Address>,
    /// Override: custom RPC URL (takes precedence over network).
    pub rpc_url: Option<String>,
}

/// Full agent info from the registry.
#[derive(Debug, Clone)]
pub struct AgentInfo {
    pub address: Address,
    pub agent_key: B256,
    pub agent_id: U256,
    pub is_verified: bool,
    pub nullifier: U256,
    pub agent_count: U256,
}

/// Agent-side SDK for Self Agent ID.
///
/// The agent's on-chain identity is its Ethereum address, zero-padded to bytes32.
/// For off-chain authentication, the agent signs each request with its private key.
pub struct SelfAgent {
    signer: PrivateKeySigner,
    registry_address: Address,
    rpc_url: String,
    agent_key: B256,
    http_client: Client,
}

impl SelfAgent {
    /// Create a new agent instance.
    pub fn new(config: SelfAgentConfig) -> Result<Self, crate::Error> {
        let net = network_config(config.network.unwrap_or(DEFAULT_NETWORK));
        let signer: PrivateKeySigner = config
            .private_key
            .parse()
            .map_err(|_| crate::Error::InvalidPrivateKey)?;
        let agent_key = address_to_agent_key(signer.address());

        Ok(Self {
            signer,
            registry_address: config.registry_address.unwrap_or(net.registry_address),
            rpc_url: config.rpc_url.unwrap_or_else(|| net.rpc_url.to_string()),
            agent_key,
            http_client: Client::new(),
        })
    }

    /// The agent's Ethereum address.
    pub fn address(&self) -> Address {
        self.signer.address()
    }

    /// The agent's on-chain key (bytes32) — zero-padded address.
    pub fn agent_key(&self) -> B256 {
        self.agent_key
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
                address: self.signer.address(),
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
            address: self.signer.address(),
            agent_key: self.agent_key,
            agent_id,
            is_verified,
            nullifier,
            agent_count,
        })
    }

    /// Generate authentication headers for a request.
    ///
    /// Signature covers: `keccak256(timestamp + METHOD + url + bodyHash)`
    pub async fn sign_request(
        &self,
        method: &str,
        url: &str,
        body: Option<&str>,
    ) -> Result<HashMap<String, String>, crate::Error> {
        let timestamp = now_millis().to_string();
        self.sign_request_with_timestamp(method, url, body, &timestamp)
            .await
    }

    /// Sign a request with a specific timestamp (useful for testing).
    pub async fn sign_request_with_timestamp(
        &self,
        method: &str,
        url: &str,
        body: Option<&str>,
        timestamp: &str,
    ) -> Result<HashMap<String, String>, crate::Error> {
        let body_text = body.unwrap_or("");
        let body_hash = keccak256(body_text.as_bytes());
        // CRITICAL: Format as "0x..." hex string before concatenating — matches TS SDK
        let body_hash_hex = format!("{:#x}", body_hash);

        let concat = format!(
            "{}{}{}{}",
            timestamp,
            method.to_uppercase(),
            url,
            body_hash_hex
        );
        let message = keccak256(concat.as_bytes());

        // EIP-191 personal_sign over the raw 32 bytes
        let signature = self
            .signer
            .sign_message(message.as_ref())
            .await
            .map_err(|e| crate::Error::SigningError(e.to_string()))?;

        let sig_hex = format!("0x{}", hex::encode(signature.as_bytes()));

        let mut headers_map = HashMap::new();
        headers_map.insert(
            headers::ADDRESS.to_string(),
            format!("{:#x}", self.signer.address()),
        );
        headers_map.insert(headers::SIGNATURE.to_string(), sig_hex);
        headers_map.insert(headers::TIMESTAMP.to_string(), timestamp.to_string());

        Ok(headers_map)
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

        let auth_headers = self.sign_request(method_str, url, body_ref).await?;

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

/// Convert a 20-byte address to a 32-byte agent key (left zero-padded).
/// Matches TS: `ethers.zeroPadValue(address, 32)`
pub fn address_to_agent_key(address: Address) -> B256 {
    let mut bytes = [0u8; 32];
    bytes[12..32].copy_from_slice(address.as_ref());
    FixedBytes(bytes)
}

/// Current time in milliseconds since Unix epoch.
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}

/// Compute the signing message from request components.
/// Exposed for use by the verifier.
pub(crate) fn compute_signing_message(
    timestamp: &str,
    method: &str,
    url: &str,
    body: Option<&str>,
) -> B256 {
    let body_text = body.unwrap_or("");
    let body_hash = keccak256(body_text.as_bytes());
    let body_hash_hex = format!("{:#x}", body_hash);
    let concat = format!(
        "{}{}{}{}",
        timestamp,
        method.to_uppercase(),
        url,
        body_hash_hex
    );
    keccak256(concat.as_bytes())
}
