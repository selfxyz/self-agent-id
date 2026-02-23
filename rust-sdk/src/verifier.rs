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

// ---------------------------------------------------------------------------
// Configuration structs
// ---------------------------------------------------------------------------

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
    /// Minimum age for agent's human (credential check, default: disabled).
    pub minimum_age: Option<u64>,
    /// Require OFAC screening passed (credential check, default: false).
    pub require_ofac_passed: Option<bool>,
    /// Require nationality in list (credential check, default: disabled).
    pub allowed_nationalities: Option<Vec<String>>,
    /// In-memory per-agent rate limiting.
    pub rate_limit_config: Option<RateLimitConfig>,
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
            minimum_age: None,
            require_ofac_passed: None,
            allowed_nationalities: None,
            rate_limit_config: None,
        }
    }
}

/// Rate limit configuration for per-agent request throttling.
#[derive(Debug, Clone)]
pub struct RateLimitConfig {
    /// Max requests per agent per minute.
    pub per_minute: Option<u32>,
    /// Max requests per agent per hour.
    pub per_hour: Option<u32>,
}

/// Config object for the `from_config` static factory.
#[derive(Debug, Clone, Default)]
pub struct VerifierFromConfig {
    pub network: Option<NetworkName>,
    pub registry_address: Option<String>,
    pub rpc_url: Option<String>,
    pub require_age: Option<u64>,
    pub require_ofac: Option<bool>,
    pub require_nationality: Option<Vec<String>>,
    pub require_self_provider: Option<bool>,
    pub sybil_limit: Option<u64>,
    pub rate_limit: Option<RateLimitConfig>,
    pub replay_protection: Option<bool>,
    pub max_age_ms: Option<u64>,
    pub cache_ttl_ms: Option<u64>,
}

// ---------------------------------------------------------------------------
// Credential + result types
// ---------------------------------------------------------------------------

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
    /// Milliseconds until the rate limit resets (only set when rate limited).
    pub retry_after_ms: Option<u64>,
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
            retry_after_ms: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Rate limiter — sliding window, keyed by agent address
// ---------------------------------------------------------------------------

struct RateBucket {
    timestamps: Vec<u64>,
}

struct RateLimitResult {
    error: String,
    retry_after_ms: u64,
}

/// In-memory sliding-window rate limiter keyed by agent address.
struct RateLimiter {
    per_minute: u32,
    per_hour: u32,
    buckets: HashMap<String, RateBucket>,
}

impl RateLimiter {
    fn new(config: &RateLimitConfig) -> Self {
        Self {
            per_minute: config.per_minute.unwrap_or(0),
            per_hour: config.per_hour.unwrap_or(0),
            buckets: HashMap::new(),
        }
    }

    /// Returns `None` if allowed, or a `RateLimitResult` if rate limited.
    fn check(&mut self, agent_address: &str) -> Option<RateLimitResult> {
        let now = now_millis();
        let key = agent_address.to_ascii_lowercase();
        let bucket = self
            .buckets
            .entry(key)
            .or_insert_with(|| RateBucket { timestamps: Vec::new() });

        // Prune timestamps older than 1 hour (longest window we care about)
        let one_hour_ago = now.saturating_sub(60 * 60 * 1000);
        bucket.timestamps.retain(|t| *t > one_hour_ago);

        // Check per-minute limit
        if self.per_minute > 0 {
            let one_minute_ago = now.saturating_sub(60 * 1000);
            let recent_minute: Vec<u64> = bucket
                .timestamps
                .iter()
                .filter(|t| **t > one_minute_ago)
                .copied()
                .collect();
            if recent_minute.len() >= self.per_minute as usize {
                let oldest = recent_minute[0];
                let retry_after = (oldest + 60 * 1000).saturating_sub(now).max(1);
                return Some(RateLimitResult {
                    error: format!("Rate limit exceeded ({}/min)", self.per_minute),
                    retry_after_ms: retry_after,
                });
            }
        }

        // Check per-hour limit
        if self.per_hour > 0 && bucket.timestamps.len() >= self.per_hour as usize {
            let oldest = bucket.timestamps[0];
            let retry_after = (oldest + 60 * 60 * 1000).saturating_sub(now).max(1);
            return Some(RateLimitResult {
                error: format!("Rate limit exceeded ({}/hr)", self.per_hour),
                retry_after_ms: retry_after,
            });
        }

        // Record this request
        bucket.timestamps.push(now);
        None
    }
}

// ---------------------------------------------------------------------------
// VerifierBuilder — chainable builder API
// ---------------------------------------------------------------------------

/// Chainable builder for creating a [`SelfAgentVerifier`].
///
/// # Example
/// ```no_run
/// use self_agent_sdk::{NetworkName, SelfAgentVerifier};
///
/// let verifier = SelfAgentVerifier::create()
///     .network(NetworkName::Testnet)
///     .require_age(18)
///     .require_ofac()
///     .require_nationality(&["US", "GB"])
///     .rate_limit(10, 100)
///     .build();
/// ```
#[derive(Default)]
pub struct VerifierBuilder {
    network: Option<NetworkName>,
    registry_address: Option<String>,
    rpc_url: Option<String>,
    max_age_ms: Option<u64>,
    cache_ttl_ms: Option<u64>,
    max_agents_per_human: Option<u64>,
    include_credentials: Option<bool>,
    require_self_provider: Option<bool>,
    enable_replay_protection: Option<bool>,
    minimum_age: Option<u64>,
    require_ofac_passed: bool,
    allowed_nationalities: Option<Vec<String>>,
    rate_limit_config: Option<RateLimitConfig>,
}

impl VerifierBuilder {
    /// Set the network: `Mainnet` or `Testnet`.
    pub fn network(mut self, name: NetworkName) -> Self {
        self.network = Some(name);
        self
    }

    /// Set a custom registry address.
    pub fn registry(mut self, addr: &str) -> Self {
        self.registry_address = Some(addr.to_string());
        self
    }

    /// Set a custom RPC URL.
    pub fn rpc(mut self, url: &str) -> Self {
        self.rpc_url = Some(url.to_string());
        self
    }

    /// Require the agent's human to be at least `n` years old.
    pub fn require_age(mut self, n: u64) -> Self {
        self.minimum_age = Some(n);
        self
    }

    /// Require OFAC screening passed.
    pub fn require_ofac(mut self) -> Self {
        self.require_ofac_passed = true;
        self
    }

    /// Require nationality in the given list of ISO country codes.
    pub fn require_nationality(mut self, codes: &[&str]) -> Self {
        self.allowed_nationalities = Some(codes.iter().map(|s| s.to_string()).collect());
        self
    }

    /// Require Self Protocol as proof provider (default: on).
    pub fn require_self_provider(mut self) -> Self {
        self.require_self_provider = Some(true);
        self
    }

    /// Max agents per human (default: 1). Set to 0 to disable sybil check.
    pub fn sybil_limit(mut self, n: u64) -> Self {
        self.max_agents_per_human = Some(n);
        self
    }

    /// Enable in-memory per-agent rate limiting.
    pub fn rate_limit(mut self, per_minute: u32, per_hour: u32) -> Self {
        self.rate_limit_config = Some(RateLimitConfig {
            per_minute: Some(per_minute),
            per_hour: Some(per_hour),
        });
        self
    }

    /// Enable replay protection (default: on).
    pub fn replay_protection(mut self) -> Self {
        self.enable_replay_protection = Some(true);
        self
    }

    /// Include ZK credentials in verification result.
    pub fn include_credentials(mut self) -> Self {
        self.include_credentials = Some(true);
        self
    }

    /// Max signed timestamp age in milliseconds.
    pub fn max_age(mut self, ms: u64) -> Self {
        self.max_age_ms = Some(ms);
        self
    }

    /// On-chain cache TTL in milliseconds.
    pub fn cache_ttl(mut self, ms: u64) -> Self {
        self.cache_ttl_ms = Some(ms);
        self
    }

    /// Build the [`SelfAgentVerifier`] instance.
    ///
    /// Automatically enables `include_credentials` when any credential
    /// requirement is set (age, OFAC, nationality).
    pub fn build(self) -> SelfAgentVerifier {
        // Auto-enable credentials if any credential requirement is set
        let needs_credentials = self.minimum_age.is_some()
            || self.require_ofac_passed
            || self
                .allowed_nationalities
                .as_ref()
                .map_or(false, |v| !v.is_empty());

        let registry_address = self
            .registry_address
            .and_then(|s| s.parse::<Address>().ok());

        SelfAgentVerifier::new(VerifierConfig {
            network: self.network,
            registry_address,
            rpc_url: self.rpc_url,
            max_age_ms: self.max_age_ms,
            cache_ttl_ms: self.cache_ttl_ms,
            max_agents_per_human: self.max_agents_per_human,
            include_credentials: if needs_credentials || self.include_credentials.unwrap_or(false) {
                Some(true)
            } else {
                self.include_credentials
            },
            require_self_provider: self.require_self_provider,
            enable_replay_protection: self.enable_replay_protection,
            replay_cache_max_entries: None,
            minimum_age: self.minimum_age,
            require_ofac_passed: if self.require_ofac_passed {
                Some(true)
            } else {
                None
            },
            allowed_nationalities: self.allowed_nationalities,
            rate_limit_config: self.rate_limit_config,
        })
    }
}

// ---------------------------------------------------------------------------
// Internal cache types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// SelfAgentVerifier
// ---------------------------------------------------------------------------

/// Service-side verifier for Self Agent ID requests.
///
/// Security chain:
/// 1. Recover signer address from ECDSA signature
/// 2. Derive agent key: zeroPadValue(recoveredAddress, 32)
/// 3. Check on-chain: isVerifiedAgent(agentKey)
/// 4. Check proof provider matches selfProofProvider()
/// 5. Check timestamp freshness (replay protection)
/// 6. Sybil resistance check
/// 7. Credential checks (age, OFAC, nationality)
/// 8. Rate limiting
///
/// # Construction
///
/// ```no_run
/// use self_agent_sdk::{
///     NetworkName, SelfAgentVerifier, VerifierConfig, VerifierFromConfig,
/// };
///
/// // Direct construction
/// let verifier = SelfAgentVerifier::new(VerifierConfig::default());
///
/// // Chainable builder
/// let verifier = SelfAgentVerifier::create()
///     .network(NetworkName::Testnet)
///     .require_age(18)
///     .require_ofac()
///     .build();
///
/// // From config object
/// let verifier = SelfAgentVerifier::from_config(VerifierFromConfig {
///     network: Some(NetworkName::Testnet),
///     require_age: Some(18),
///     ..Default::default()
/// });
/// ```
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
    minimum_age: Option<u64>,
    require_ofac_passed: bool,
    allowed_nationalities: Option<Vec<String>>,
    rate_limiter: Option<RateLimiter>,
    cache: HashMap<B256, CacheEntry>,
    replay_cache: HashMap<String, u64>,
    self_provider_cache: Option<(Address, u64)>,
}

impl SelfAgentVerifier {
    /// Create a new verifier instance from a [`VerifierConfig`].
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
            minimum_age: config.minimum_age,
            require_ofac_passed: config.require_ofac_passed.unwrap_or(false),
            allowed_nationalities: config.allowed_nationalities,
            rate_limiter: config.rate_limit_config.as_ref().map(RateLimiter::new),
            cache: HashMap::new(),
            replay_cache: HashMap::new(),
            self_provider_cache: None,
        }
    }

    /// Create a chainable [`VerifierBuilder`] for configuring a verifier.
    pub fn create() -> VerifierBuilder {
        VerifierBuilder::default()
    }

    /// Create a verifier from a flat config object.
    ///
    /// Automatically enables `include_credentials` when any credential
    /// requirement is set (age, OFAC, nationality).
    pub fn from_config(cfg: VerifierFromConfig) -> Self {
        let needs_credentials = cfg.require_age.is_some()
            || cfg.require_ofac.unwrap_or(false)
            || cfg
                .require_nationality
                .as_ref()
                .map_or(false, |v| !v.is_empty());

        let registry_address = cfg
            .registry_address
            .and_then(|s| s.parse::<Address>().ok());

        Self::new(VerifierConfig {
            network: cfg.network,
            registry_address,
            rpc_url: cfg.rpc_url,
            max_age_ms: cfg.max_age_ms,
            cache_ttl_ms: cfg.cache_ttl_ms,
            max_agents_per_human: cfg.sybil_limit,
            include_credentials: if needs_credentials { Some(true) } else { None },
            require_self_provider: cfg.require_self_provider,
            enable_replay_protection: cfg.replay_protection,
            replay_cache_max_entries: None,
            minimum_age: cfg.require_age,
            require_ofac_passed: cfg.require_ofac,
            allowed_nationalities: cfg.require_nationality,
            rate_limit_config: cfg.rate_limit,
        })
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
                    retry_after_ms: None,
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
                    retry_after_ms: None,
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
                retry_after_ms: None,
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
                        retry_after_ms: None,
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
                    retry_after_ms: None,
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
                retry_after_ms: None,
            };
        }

        // 9. Fetch credentials if requested
        let credentials = if self.include_credentials && on_chain.agent_id > U256::ZERO {
            self.fetch_credentials(on_chain.agent_id).await.ok()
        } else {
            None
        };

        // 10. Credential checks (post-verify — only if credentials were fetched)
        if let Some(ref creds) = credentials {
            if let Some(min_age) = self.minimum_age {
                if creds.older_than < U256::from(min_age) {
                    return VerificationResult {
                        valid: false,
                        agent_address: signer_address,
                        agent_key,
                        agent_id: on_chain.agent_id,
                        agent_count: on_chain.agent_count,
                        nullifier: on_chain.nullifier,
                        credentials: credentials.clone(),
                        error: Some(format!(
                            "Agent's human does not meet minimum age (required: {}, got: {})",
                            min_age, creds.older_than
                        )),
                        retry_after_ms: None,
                    };
                }
            }

            if self.require_ofac_passed && !creds.ofac.first().copied().unwrap_or(false) {
                return VerificationResult {
                    valid: false,
                    agent_address: signer_address,
                    agent_key,
                    agent_id: on_chain.agent_id,
                    agent_count: on_chain.agent_count,
                    nullifier: on_chain.nullifier,
                    credentials: credentials.clone(),
                    error: Some("Agent's human did not pass OFAC screening".to_string()),
                    retry_after_ms: None,
                };
            }

            if let Some(ref allowed) = self.allowed_nationalities {
                if !allowed.is_empty() && !allowed.contains(&creds.nationality) {
                    return VerificationResult {
                        valid: false,
                        agent_address: signer_address,
                        agent_key,
                        agent_id: on_chain.agent_id,
                        agent_count: on_chain.agent_count,
                        nullifier: on_chain.nullifier,
                        credentials: credentials.clone(),
                        error: Some(format!(
                            "Nationality \"{}\" not in allowed list",
                            creds.nationality
                        )),
                        retry_after_ms: None,
                    };
                }
            }
        }

        // 11. Rate limiting (per-agent, in-memory sliding window)
        if let Some(ref mut limiter) = self.rate_limiter {
            let addr_str = format!("{:#x}", signer_address);
            if let Some(limited) = limiter.check(&addr_str) {
                return VerificationResult {
                    valid: false,
                    agent_address: signer_address,
                    agent_key,
                    agent_id: on_chain.agent_id,
                    agent_count: on_chain.agent_count,
                    nullifier: on_chain.nullifier,
                    credentials,
                    error: Some(limited.error),
                    retry_after_ms: Some(limited.retry_after_ms),
                };
            }
        }

        VerificationResult {
            valid: true,
            agent_address: signer_address,
            agent_key,
            agent_id: on_chain.agent_id,
            agent_count: on_chain.agent_count,
            nullifier: on_chain.nullifier,
            credentials,
            error: None,
            retry_after_ms: None,
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
        .expect("system clock before UNIX epoch")
        .as_millis() as u64
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn create_build_default() {
        let v = SelfAgentVerifier::create().build();
        // Defaults: mainnet, max_agents_per_human=1, require_self_provider=true
        assert_eq!(v.max_agents_per_human, 1);
        assert!(v.require_self_provider);
        assert!(v.enable_replay_protection);
        assert!(!v.include_credentials);
        assert!(v.minimum_age.is_none());
        assert!(!v.require_ofac_passed);
        assert!(v.allowed_nationalities.is_none());
        assert!(v.rate_limiter.is_none());
    }

    #[test]
    fn create_build_testnet() {
        let v = SelfAgentVerifier::create()
            .network(NetworkName::Testnet)
            .build();
        let expected = network_config(NetworkName::Testnet);
        assert_eq!(v.registry_address, expected.registry_address);
        assert_eq!(v.rpc_url, expected.rpc_url);
    }

    #[test]
    fn chain_credentials() {
        let v = SelfAgentVerifier::create()
            .network(NetworkName::Testnet)
            .require_age(18)
            .require_ofac()
            .require_nationality(&["US", "GB"])
            .build();

        // Auto-enabled include_credentials
        assert!(v.include_credentials);
        assert_eq!(v.minimum_age, Some(18));
        assert!(v.require_ofac_passed);
        assert_eq!(
            v.allowed_nationalities.as_deref(),
            Some(vec!["US".to_string(), "GB".to_string()].as_slice())
        );
    }

    #[test]
    fn auto_enable_credentials_age_only() {
        let v = SelfAgentVerifier::create()
            .require_age(21)
            .build();
        assert!(v.include_credentials);
        assert_eq!(v.minimum_age, Some(21));
    }

    #[test]
    fn auto_enable_credentials_ofac_only() {
        let v = SelfAgentVerifier::create()
            .require_ofac()
            .build();
        assert!(v.include_credentials);
        assert!(v.require_ofac_passed);
    }

    #[test]
    fn auto_enable_credentials_nationality_only() {
        let v = SelfAgentVerifier::create()
            .require_nationality(&["DE"])
            .build();
        assert!(v.include_credentials);
    }

    #[test]
    fn no_auto_credentials_without_requirements() {
        let v = SelfAgentVerifier::create()
            .network(NetworkName::Testnet)
            .sybil_limit(3)
            .build();
        assert!(!v.include_credentials);
    }

    #[test]
    fn explicit_include_credentials() {
        let v = SelfAgentVerifier::create()
            .include_credentials()
            .build();
        assert!(v.include_credentials);
    }

    #[test]
    fn from_config_works() {
        let v = SelfAgentVerifier::from_config(VerifierFromConfig {
            network: Some(NetworkName::Testnet),
            require_age: Some(18),
            require_ofac: Some(true),
            sybil_limit: Some(1),
            ..Default::default()
        });
        assert!(v.include_credentials);
        assert_eq!(v.minimum_age, Some(18));
        assert!(v.require_ofac_passed);
        assert_eq!(v.max_agents_per_human, 1);
    }

    #[test]
    fn from_config_auto_credentials_disabled() {
        let v = SelfAgentVerifier::from_config(VerifierFromConfig {
            network: Some(NetworkName::Testnet),
            sybil_limit: Some(5),
            ..Default::default()
        });
        assert!(!v.include_credentials);
    }

    #[test]
    fn from_config_nationality() {
        let v = SelfAgentVerifier::from_config(VerifierFromConfig {
            require_nationality: Some(vec!["FR".to_string(), "IT".to_string()]),
            ..Default::default()
        });
        assert!(v.include_credentials);
        assert_eq!(
            v.allowed_nationalities.as_deref(),
            Some(vec!["FR".to_string(), "IT".to_string()].as_slice())
        );
    }

    #[test]
    fn rate_limit_builder() {
        let v = SelfAgentVerifier::create()
            .rate_limit(10, 100)
            .build();
        assert!(v.rate_limiter.is_some());
        let limiter = v.rate_limiter.as_ref().unwrap();
        assert_eq!(limiter.per_minute, 10);
        assert_eq!(limiter.per_hour, 100);
    }

    #[test]
    fn rate_limit_from_config() {
        let v = SelfAgentVerifier::from_config(VerifierFromConfig {
            rate_limit: Some(RateLimitConfig {
                per_minute: Some(5),
                per_hour: Some(50),
            }),
            ..Default::default()
        });
        assert!(v.rate_limiter.is_some());
    }

    #[test]
    fn rate_limiter_allows_within_limit() {
        let config = RateLimitConfig {
            per_minute: Some(3),
            per_hour: None,
        };
        let mut limiter = RateLimiter::new(&config);
        assert!(limiter.check("0xabc").is_none());
        assert!(limiter.check("0xabc").is_none());
        assert!(limiter.check("0xabc").is_none());
        // 4th request should be rate limited
        let result = limiter.check("0xabc");
        assert!(result.is_some());
        let r = result.unwrap();
        assert!(r.error.contains("3/min"));
        assert!(r.retry_after_ms > 0);
    }

    #[test]
    fn rate_limiter_separate_agents() {
        let config = RateLimitConfig {
            per_minute: Some(1),
            per_hour: None,
        };
        let mut limiter = RateLimiter::new(&config);
        assert!(limiter.check("0xabc").is_none());
        assert!(limiter.check("0xdef").is_none());
        // Same agent again = limited
        assert!(limiter.check("0xabc").is_some());
        // Different agent still allowed
        assert!(limiter.check("0xghi").is_none());
    }

    #[test]
    fn builder_custom_max_age_and_cache_ttl() {
        let v = SelfAgentVerifier::create()
            .max_age(10_000)
            .cache_ttl(30_000)
            .build();
        assert_eq!(v.max_age_ms, 10_000);
        assert_eq!(v.cache_ttl_ms, 30_000);
    }

    #[test]
    fn builder_sybil_limit_zero_disables() {
        let v = SelfAgentVerifier::create()
            .sybil_limit(0)
            .build();
        assert_eq!(v.max_agents_per_human, 0);
    }

    #[test]
    fn builder_replay_protection() {
        let v = SelfAgentVerifier::create()
            .replay_protection()
            .build();
        assert!(v.enable_replay_protection);
    }

    #[test]
    fn builder_require_self_provider() {
        let v = SelfAgentVerifier::create()
            .require_self_provider()
            .build();
        assert!(v.require_self_provider);
    }

    #[test]
    fn new_constructor_still_works() {
        let v = SelfAgentVerifier::new(VerifierConfig::default());
        assert_eq!(v.max_age_ms, DEFAULT_MAX_AGE_MS);
        assert_eq!(v.cache_ttl_ms, DEFAULT_CACHE_TTL_MS);
        assert_eq!(v.max_agents_per_human, 1);
        assert!(v.require_self_provider);
    }

    #[test]
    fn new_constructor_with_credentials() {
        let v = SelfAgentVerifier::new(VerifierConfig {
            minimum_age: Some(21),
            require_ofac_passed: Some(true),
            include_credentials: Some(true),
            ..Default::default()
        });
        assert!(v.include_credentials);
        assert_eq!(v.minimum_age, Some(21));
        assert!(v.require_ofac_passed);
    }

    #[test]
    fn verification_result_has_retry_after() {
        let r = VerificationResult::empty_with_error("test");
        assert!(r.retry_after_ms.is_none());
    }
}
