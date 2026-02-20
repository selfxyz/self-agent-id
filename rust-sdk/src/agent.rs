use alloy::primitives::{keccak256, Address, B256, FixedBytes, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::Signer;
use reqwest::{Client, Method, RequestBuilder, Response};
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::agent_card::{
    A2AAgentCard, AgentSkill, CardCredentials, SelfProtocolExtension, TrustModel,
    get_provider_label,
};
use crate::constants::{
    headers, network_config, IAgentRegistry, IHumanProofProvider, NetworkName, DEFAULT_NETWORK,
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

    // ─── A2A Agent Card Methods ────────────────────────────────────────────

    /// Read the A2A Agent Card from on-chain metadata (if set).
    pub async fn get_agent_card(&self) -> Result<Option<A2AAgentCard>, crate::Error> {
        let provider = self.make_provider()?;
        let registry = IAgentRegistry::new(self.registry_address, provider);

        let agent_id = registry
            .getAgentId(self.agent_key)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        if agent_id == U256::ZERO {
            return Ok(None);
        }

        let raw = registry
            .getAgentMetadata(agent_id)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        if raw.is_empty() {
            return Ok(None);
        }

        match serde_json::from_str::<A2AAgentCard>(&raw) {
            Ok(card) if card.a2a_version == "0.1" => Ok(Some(card)),
            _ => Ok(None),
        }
    }

    /// Build and write an A2A Agent Card to on-chain metadata.
    /// Returns the transaction hash.
    pub async fn set_agent_card(
        &self,
        name: String,
        description: Option<String>,
        url: Option<String>,
        skills: Option<Vec<AgentSkill>>,
    ) -> Result<B256, crate::Error> {
        let provider = self.make_provider()?;
        let registry = IAgentRegistry::new(self.registry_address, &provider);

        let agent_id = registry
            .getAgentId(self.agent_key)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        if agent_id == U256::ZERO {
            return Err(crate::Error::RpcError("Agent not registered".into()));
        }

        let proof_provider_addr = registry
            .getProofProvider(agent_id)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;

        let proof_provider =
            IHumanProofProvider::new(proof_provider_addr, &provider);

        let provider_name = proof_provider
            .providerName()
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        let strength = proof_provider
            .verificationStrength()
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;

        let credentials = registry
            .getAgentCredentials(agent_id)
            .call()
            .await
            .ok();

        let proof_type = get_provider_label(strength).to_string();

        let mut trust_model = TrustModel {
            proof_type,
            sybil_resistant: true,
            ofac_screened: false,
            minimum_age_verified: 0,
        };

        let card_credentials = credentials.map(|creds| {
            let older_than = creds.olderThan.try_into().unwrap_or(0u64);
            let ofac_screened = creds.ofac.first().copied().unwrap_or(false);
            trust_model.ofac_screened = ofac_screened;
            trust_model.minimum_age_verified = older_than;

            CardCredentials {
                nationality: non_empty(&creds.nationality),
                issuing_state: non_empty(&creds.issuingState),
                older_than: if older_than > 0 { Some(older_than) } else { None },
                ofac_clean: if ofac_screened { Some(creds.ofac[0]) } else { None },
                has_name: if !creds.name.is_empty() { Some(true) } else { None },
                has_date_of_birth: non_empty(&creds.dateOfBirth).map(|_| true),
                has_gender: non_empty(&creds.gender).map(|_| true),
                document_expiry: non_empty(&creds.expiryDate),
            }
        });

        let chain_id: u64 = alloy::providers::Provider::get_chain_id(&provider)
            .await
            .map_err(|e: alloy::transports::RpcError<alloy::transports::TransportErrorKind>| crate::Error::RpcError(e.to_string()))?;

        let card = A2AAgentCard {
            a2a_version: "0.1".into(),
            name,
            description,
            url,
            capabilities: None,
            skills,
            self_protocol: SelfProtocolExtension {
                agent_id: agent_id.try_into().unwrap_or(0),
                registry: format!("{:#x}", self.registry_address),
                chain_id,
                proof_provider: format!("{:#x}", proof_provider_addr),
                provider_name,
                verification_strength: strength,
                trust_model,
                credentials: card_credentials,
            },
        };

        let json =
            serde_json::to_string(&card).map_err(|e| crate::Error::RpcError(e.to_string()))?;

        let tx_hash = registry
            .updateAgentMetadata(agent_id, json)
            .send()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?
            .watch()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;

        Ok(tx_hash)
    }

    /// Returns a `data:` URI containing the base64-encoded Agent Card JSON.
    pub async fn to_agent_card_data_uri(&self) -> Result<String, crate::Error> {
        let card = self
            .get_agent_card()
            .await?
            .ok_or_else(|| crate::Error::RpcError("No A2A Agent Card set".into()))?;
        let json =
            serde_json::to_string(&card).map_err(|e| crate::Error::RpcError(e.to_string()))?;
        use base64::Engine;
        let encoded = base64::engine::general_purpose::STANDARD.encode(json.as_bytes());
        Ok(format!("data:application/json;base64,{}", encoded))
    }

    /// Read ZK-attested credentials for this agent from on-chain.
    pub async fn get_credentials(
        &self,
    ) -> Result<Option<IAgentRegistry::AgentCredentials>, crate::Error> {
        let provider = self.make_provider()?;
        let registry = IAgentRegistry::new(self.registry_address, provider);

        let agent_id = registry
            .getAgentId(self.agent_key)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        if agent_id == U256::ZERO {
            return Ok(None);
        }

        let creds = registry
            .getAgentCredentials(agent_id)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        Ok(Some(creds))
    }

    /// Read the verification strength score from the provider contract.
    pub async fn get_verification_strength(&self) -> Result<u8, crate::Error> {
        let provider = self.make_provider()?;
        let registry = IAgentRegistry::new(self.registry_address, &provider);

        let agent_id = registry
            .getAgentId(self.agent_key)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        if agent_id == U256::ZERO {
            return Ok(0);
        }

        let provider_addr = registry
            .getProofProvider(agent_id)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        if provider_addr == Address::ZERO {
            return Ok(0);
        }

        let proof_provider = IHumanProofProvider::new(provider_addr, &provider);
        let strength = proof_provider
            .verificationStrength()
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        Ok(strength)
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

/// Returns `Some(s)` if non-empty, `None` otherwise.
fn non_empty(s: &str) -> Option<String> {
    if s.is_empty() {
        None
    } else {
        Some(s.to_string())
    }
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
