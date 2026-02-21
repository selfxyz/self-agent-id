use alloy::primitives::{Address, B256, U256};
use alloy::providers::ProviderBuilder;
use alloy::signers::Signature;
use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::agent::{address_to_agent_key, compute_signing_message};
use crate::constants::{
    network_config, IAgentRegistry, NetworkName, DEFAULT_CACHE_TTL_MS, DEFAULT_MAX_AGE_MS,
    DEFAULT_NETWORK,
};

/// Configuration for creating a [`SelfAgentVerifier`].
#[derive(Debug, Clone)]
pub struct VerifierConfig {
    /// Network to use: Mainnet (default) or Testnet.
    pub network: Option<NetworkName>,
    /// Override: custom registry address.
    pub registry_address: Option<Address>,
    /// Override: custom RPC URL.
    pub rpc_url: Option<String>,
    /// Max age for signed timestamps in ms (default: 5 min).
    pub max_age_ms: Option<u64>,
    /// TTL for on-chain status cache in ms (default: 1 min).
    pub cache_ttl_ms: Option<u64>,
    /// Max agents allowed per human (default: 1). Set to 0 to disable.
    pub max_agents_per_human: Option<u64>,
    /// Include ZK-attested credentials in verification result (default: false).
    pub include_credentials: Option<bool>,
    /// Require proof-of-human was provided by Self Protocol (default: true).
    pub require_self_provider: Option<bool>,
    /// Reject duplicate signatures within validity window (default: true).
    pub enable_replay_protection: Option<bool>,
    /// Max replay cache entries before pruning (default: 10k).
    pub replay_cache_max_entries: Option<usize>,
}

impl Default for VerifierConfig {
    fn default() -> Self {
        Self {
            network: None,
            registry_address: None,
            rpc_url: None,
            max_age_ms: None,
            cache_ttl_ms: None,
            max_agents_per_human: None,
            include_credentials: None,
            require_self_provider: None,
            enable_replay_protection: None,
            replay_cache_max_entries: None,
        }
    }
}

/// ZK-attested credential claims stored on-chain for an agent.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AgentCredentials {
    pub issuing_state: String,
    pub name: Vec<String>,
    pub id_number: String,
    pub nationality: String,
    pub date_of_birth: String,
    pub gender: String,
    pub expiry_date: String,
    pub older_than: U256,
    pub ofac: Vec<bool>,
}

/// Result of verifying an agent request.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct VerificationResult {
    pub valid: bool,
    /// The agent's Ethereum address (recovered from signature).
    pub agent_address: Address,
    /// The agent's on-chain key (bytes32).
    pub agent_key: B256,
    pub agent_id: U256,
    /// Number of agents registered by the same human.
    pub agent_count: U256,
    /// Human's nullifier (for rate limiting by human identity).
    pub nullifier: U256,
    /// ZK-attested credentials (only populated when include_credentials is true).
    pub credentials: Option<AgentCredentials>,
    pub error: Option<String>,
}

impl VerificationResult {
    fn empty_with_error(error: &str) -> Self {
        Self {
            valid: false,
            agent_address: Address::ZERO,
            agent_key: B256::ZERO,
            agent_id: U256::ZERO,
            agent_count: U256::ZERO,
            nullifier: U256::ZERO,
            credentials: None,
            error: Some(error.to_string()),
        }
    }
}

struct CacheEntry {
    is_verified: bool,
    agent_id: U256,
    agent_count: U256,
    nullifier: U256,
    provider_address: Address,
    expires_at: u64,
}

struct OnChainStatus {
    is_verified: bool,
    agent_id: U256,
    agent_count: U256,
    nullifier: U256,
    provider_address: Address,
}

/// Service-side verifier for Self Agent ID requests.
///
/// Security chain:
/// 1. Recover signer address from ECDSA signature
/// 2. Derive agent key: zeroPadValue(recoveredAddress, 32)
/// 3. Check on-chain: isVerifiedAgent(agentKey)
/// 4. Check proof provider matches selfProofProvider()
/// 5. Check timestamp freshness (replay protection)
/// 6. Sybil resistance check
pub struct SelfAgentVerifier {
    registry_address: Address,
    rpc_url: String,
    max_age_ms: u64,
    cache_ttl_ms: u64,
    max_agents_per_human: u64,
    include_credentials: bool,
    require_self_provider: bool,
    enable_replay_protection: bool,
    replay_cache_max_entries: usize,
    cache: HashMap<B256, CacheEntry>,
    replay_cache: HashMap<String, u64>,
    self_provider_cache: Option<(Address, u64)>,
}

impl SelfAgentVerifier {
    /// Create a new verifier instance.
    pub fn new(config: VerifierConfig) -> Self {
        let net = network_config(config.network.unwrap_or(DEFAULT_NETWORK));
        Self {
            registry_address: config.registry_address.unwrap_or(net.registry_address),
            rpc_url: config.rpc_url.unwrap_or_else(|| net.rpc_url.to_string()),
            max_age_ms: config.max_age_ms.unwrap_or(DEFAULT_MAX_AGE_MS),
            cache_ttl_ms: config.cache_ttl_ms.unwrap_or(DEFAULT_CACHE_TTL_MS),
            max_agents_per_human: config.max_agents_per_human.unwrap_or(1),
            include_credentials: config.include_credentials.unwrap_or(false),
            require_self_provider: config.require_self_provider.unwrap_or(true),
            enable_replay_protection: config.enable_replay_protection.unwrap_or(true),
            replay_cache_max_entries: config.replay_cache_max_entries.unwrap_or(10_000),
            cache: HashMap::new(),
            replay_cache: HashMap::new(),
            self_provider_cache: None,
        }
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

    /// Verify a signed agent request.
    ///
    /// The agent's identity is derived from the signature — not from any header.
    pub async fn verify(
        &mut self,
        signature: &str,
        timestamp: &str,
        method: &str,
        url: &str,
        body: Option<&str>,
    ) -> VerificationResult {
        // 1. Check timestamp freshness (replay protection)
        let ts: u64 = match timestamp.parse() {
            Ok(v) => v,
            Err(_) => return VerificationResult::empty_with_error("Timestamp expired or invalid"),
        };
        let now = now_millis();
        let diff = if now > ts { now - ts } else { ts - now };
        if diff > self.max_age_ms {
            return VerificationResult::empty_with_error("Timestamp expired or invalid");
        }

        // 2. Reconstruct the signed message
        let message = compute_signing_message(timestamp, method, url, body);
        let message_key = format!("{:#x}", message);

        // 3. Recover signer address from signature
        let signer_address = match recover_address(&message, signature) {
            Ok(addr) => addr,
            Err(_) => return VerificationResult::empty_with_error("Invalid signature"),
        };

        // 4. Replay cache check (after signature validity to avoid cache poisoning)
        if self.enable_replay_protection {
            if let Some(err) = self.check_and_record_replay(signature, &message_key, ts, now) {
                return VerificationResult {
                    valid: false,
                    agent_address: signer_address,
                    agent_key: address_to_agent_key(signer_address),
                    agent_id: U256::ZERO,
                    agent_count: U256::ZERO,
                    nullifier: U256::ZERO,
                    credentials: None,
                    error: Some(err),
                };
            }
        }

        // 5. Derive the on-chain agent key from the recovered address
        let agent_key = address_to_agent_key(signer_address);

        // 6. Check on-chain status (with cache)
        let on_chain = match self.check_on_chain(agent_key).await {
            Ok(v) => v,
            Err(e) => {
                return VerificationResult {
                    valid: false,
                    agent_address: signer_address,
                    agent_key,
                    agent_id: U256::ZERO,
                    agent_count: U256::ZERO,
                    nullifier: U256::ZERO,
                    credentials: None,
                    error: Some(format!("RPC error: {}", e)),
                };
            }
        };

        if !on_chain.is_verified {
            return VerificationResult {
                valid: false,
                agent_address: signer_address,
                agent_key,
                agent_id: on_chain.agent_id,
                agent_count: on_chain.agent_count,
                nullifier: on_chain.nullifier,
                credentials: None,
                error: Some("Agent not verified on-chain".to_string()),
            };
        }

        // 7. Provider check: ensure agent was verified by Self Protocol
        if self.require_self_provider && on_chain.agent_id > U256::ZERO {
            let self_provider = match self.get_self_provider_address().await {
                Ok(addr) => addr,
                Err(_) => {
                    return VerificationResult {
                        valid: false,
                        agent_address: signer_address,
                        agent_key,
                        agent_id: on_chain.agent_id,
                        agent_count: on_chain.agent_count,
                        nullifier: on_chain.nullifier,
                        credentials: None,
                        error: Some(
                            "Unable to verify proof provider — RPC error".to_string(),
                        ),
                    };
                }
            };
            if on_chain.provider_address != self_provider {
                return VerificationResult {
                    valid: false,
                    agent_address: signer_address,
                    agent_key,
                    agent_id: on_chain.agent_id,
                    agent_count: on_chain.agent_count,
                    nullifier: on_chain.nullifier,
                    credentials: None,
                    error: Some(
                        "Agent was not verified by Self — proof provider mismatch".to_string(),
                    ),
                };
            }
        }

        // 8. Sybil resistance: reject if human has too many agents
        if self.max_agents_per_human > 0
            && on_chain.agent_count > U256::from(self.max_agents_per_human)
        {
            return VerificationResult {
                valid: false,
                agent_address: signer_address,
                agent_key,
                agent_id: on_chain.agent_id,
                agent_count: on_chain.agent_count,
                nullifier: on_chain.nullifier,
                credentials: None,
                error: Some(format!(
                    "Human has {} agents (max {})",
                    on_chain.agent_count, self.max_agents_per_human
                )),
            };
        }

        // 9. Fetch credentials if requested
        let credentials = if self.include_credentials && on_chain.agent_id > U256::ZERO {
            self.fetch_credentials(on_chain.agent_id).await.ok()
        } else {
            None
        };

        VerificationResult {
            valid: true,
            agent_address: signer_address,
            agent_key,
            agent_id: on_chain.agent_id,
            agent_count: on_chain.agent_count,
            nullifier: on_chain.nullifier,
            credentials,
            error: None,
        }
    }

    /// Check on-chain agent status with caching.
    async fn check_on_chain(&mut self, agent_key: B256) -> Result<OnChainStatus, crate::Error> {
        let now = now_millis();
        if let Some(cached) = self.cache.get(&agent_key) {
            if cached.expires_at > now {
                return Ok(OnChainStatus {
                    is_verified: cached.is_verified,
                    agent_id: cached.agent_id,
                    agent_count: cached.agent_count,
                    nullifier: cached.nullifier,
                    provider_address: cached.provider_address,
                });
            }
        }

        let provider = self.make_provider()?;
        let registry = IAgentRegistry::new(self.registry_address, &provider);

        let is_verified = registry
            .isVerifiedAgent(agent_key)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;
        let agent_id = registry
            .getAgentId(agent_key)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;

        let mut agent_count = U256::ZERO;
        let mut nullifier = U256::ZERO;
        let mut provider_address = Address::ZERO;

        if agent_id > U256::ZERO {
            if self.max_agents_per_human > 0 {
                nullifier = registry
                    .getHumanNullifier(agent_id)
                    .call()
                    .await
                    .map_err(|e| crate::Error::RpcError(e.to_string()))?;
                agent_count = registry
                    .getAgentCountForHuman(nullifier)
                    .call()
                    .await
                    .map_err(|e| crate::Error::RpcError(e.to_string()))?;
            }

            if self.require_self_provider {
                provider_address = registry
                    .getProofProvider(agent_id)
                    .call()
                    .await
                    .map_err(|e| crate::Error::RpcError(e.to_string()))?;
            }
        }

        self.cache.insert(
            agent_key,
            CacheEntry {
                is_verified,
                agent_id,
                agent_count,
                nullifier,
                provider_address,
                expires_at: now + self.cache_ttl_ms,
            },
        );

        Ok(OnChainStatus {
            is_verified,
            agent_id,
            agent_count,
            nullifier,
            provider_address,
        })
    }

    /// Get Self Protocol's own proof provider address from the registry.
    async fn get_self_provider_address(&mut self) -> Result<Address, crate::Error> {
        let now = now_millis();
        if let Some((addr, expires_at)) = self.self_provider_cache {
            if expires_at > now {
                return Ok(addr);
            }
        }

        let provider = self.make_provider()?;
        let registry = IAgentRegistry::new(self.registry_address, &provider);

        let address = registry
            .selfProofProvider()
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;

        // Cache for longer (12x normal TTL — ~1 hour at default)
        self.self_provider_cache = Some((address, now + self.cache_ttl_ms * 12));

        Ok(address)
    }

    /// Fetch ZK-attested credentials for an agent.
    async fn fetch_credentials(&self, agent_id: U256) -> Result<AgentCredentials, crate::Error> {
        let provider = self.make_provider()?;
        let registry = IAgentRegistry::new(self.registry_address, &provider);

        let raw = registry
            .getAgentCredentials(agent_id)
            .call()
            .await
            .map_err(|e| crate::Error::RpcError(e.to_string()))?;

        Ok(AgentCredentials {
            issuing_state: raw.issuingState,
            name: raw.name,
            id_number: raw.idNumber,
            nationality: raw.nationality,
            date_of_birth: raw.dateOfBirth,
            gender: raw.gender,
            expiry_date: raw.expiryDate,
            older_than: raw.olderThan,
            ofac: raw.ofac.to_vec(),
        })
    }

    /// Clear the on-chain status cache.
    pub fn clear_cache(&mut self) {
        self.cache.clear();
        self.replay_cache.clear();
        self.self_provider_cache = None;
    }

    fn check_and_record_replay(
        &mut self,
        signature: &str,
        message: &str,
        ts: u64,
        now: u64,
    ) -> Option<String> {
        self.prune_replay_cache(now);

        let key = format!(
            "{}:{}",
            signature.to_ascii_lowercase(),
            message.to_ascii_lowercase()
        );
        if let Some(expires_at) = self.replay_cache.get(&key) {
            if *expires_at > now {
                return Some("Replay detected".to_string());
            }
        }

        self.replay_cache.insert(key, ts.saturating_add(self.max_age_ms));
        None
    }

    fn prune_replay_cache(&mut self, now: u64) {
        self.replay_cache.retain(|_, exp| *exp > now);

        if self.replay_cache.len() <= self.replay_cache_max_entries {
            return;
        }

        let overflow = self.replay_cache.len() - self.replay_cache_max_entries;
        let mut items: Vec<(String, u64)> =
            self.replay_cache.iter().map(|(k, v)| (k.clone(), *v)).collect();
        items.sort_by_key(|(_, exp)| *exp);

        for (key, _) in items.into_iter().take(overflow) {
            self.replay_cache.remove(&key);
        }
    }
}

/// Recover signer address from an EIP-191 personal_sign signature over raw 32 bytes.
///
/// Matches TS: `ethers.verifyMessage(ethers.getBytes(message), signature)`
fn recover_address(message: &B256, signature_hex: &str) -> Result<Address, crate::Error> {
    let sig_bytes = hex::decode(signature_hex.strip_prefix("0x").unwrap_or(signature_hex))
        .map_err(|_| crate::Error::InvalidSignature)?;

    let signature = Signature::try_from(sig_bytes.as_slice())
        .map_err(|_| crate::Error::InvalidSignature)?;

    // EIP-191: prefix with "\x19Ethereum Signed Message:\n32" then hash
    let prefixed = alloy::primitives::eip191_hash_message(message.as_slice());

    let recovered = signature
        .recover_address_from_prehash(&prefixed)
        .map_err(|_| crate::Error::InvalidSignature)?;

    Ok(recovered)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
}
