//! Rust SDK for Self Agent ID — on-chain AI agent identity with proof-of-human.
//!
//! # Quick Start
//!
//! ## Agent side (signing requests)
//!
//! ```ignore
//! use self_agent_sdk::{SelfAgent, SelfAgentConfig, NetworkName};
//!
//! let agent = SelfAgent::new(SelfAgentConfig {
//!     private_key: "0x...".to_string(),
//!     network: Some(NetworkName::Testnet),
//!     registry_address: None,
//!     rpc_url: None,
//! })?;
//!
//! // Check on-chain status
//! let registered = agent.is_registered().await?;
//!
//! // Auto-signed HTTP request
//! let response = agent.fetch("https://api.example.com/data", None, None).await?;
//! ```
//!
//! ## Service side (verifying requests)
//!
//! ```ignore
//! use self_agent_sdk::{SelfAgentVerifier, VerifierConfig};
//!
//! let mut verifier = SelfAgentVerifier::new(VerifierConfig::default());
//! let result = verifier.verify(signature, timestamp, "POST", "/api/data", Some(body)).await;
//! if result.valid {
//!     println!("Verified agent: {:?}", result.agent_address);
//! }
//! ```

pub mod agent;
pub mod agent_card;
pub mod constants;
pub mod verifier;

#[cfg(feature = "axum")]
pub mod middleware;

// Re-exports
pub use agent::{AgentInfo, SelfAgent, SelfAgentConfig};
pub use agent_card::{
    A2AAgentCard, AgentSkill, CardCredentials, SelfProtocolExtension, TrustModel,
    get_provider_label, get_strength_color,
};
pub use constants::{headers, NetworkName};
pub use verifier::{
    AgentCredentials, RateLimitConfig, SelfAgentVerifier, VerificationResult, VerifierBuilder,
    VerifierConfig, VerifierFromConfig,
};

#[cfg(feature = "axum")]
pub use middleware::{self_agent_auth, VerifiedAgent};

/// Errors that can occur in the SDK.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid private key")]
    InvalidPrivateKey,
    #[error("invalid RPC URL")]
    InvalidRpcUrl,
    #[error("invalid signature")]
    InvalidSignature,
    #[error("signing error: {0}")]
    SigningError(String),
    #[error("RPC error: {0}")]
    RpcError(String),
    #[error("HTTP error: {0}")]
    HttpError(String),
}
