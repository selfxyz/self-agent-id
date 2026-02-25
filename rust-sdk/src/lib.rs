// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

//! Rust SDK for Self Agent ID — on-chain AI agent identity with proof-of-human.
//!
//! # Quick Start
//!
//! ## Agent side (signing requests)
//!
//! ```no_run
//! use self_agent_sdk::{SelfAgent, SelfAgentConfig, NetworkName};
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! # tokio::runtime::Runtime::new()?.block_on(async {
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
//! # let _ = (registered, response);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! # })?;
//! # Ok(())
//! # }
//! ```
//!
//! ## Service side (verifying requests)
//!
//! ```no_run
//! use self_agent_sdk::{SelfAgentVerifier, VerifierConfig};
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! # tokio::runtime::Runtime::new()?.block_on(async {
//! let mut verifier = SelfAgentVerifier::new(VerifierConfig::default());
//! let signature = "0x...";
//! let timestamp = "1700000000000";
//! let body = r#"{"test":true}"#;
//! let result = verifier.verify(signature, timestamp, "POST", "/api/data", Some(body)).await;
//! if result.valid {
//!     println!("Verified agent: {:?}", result.agent_address);
//! }
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! # })?;
//! # Ok(())
//! # }
//! ```

pub mod agent;
pub mod agent_card;
pub mod constants;
pub mod registration;
pub mod registration_flow;
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
pub use registration::{
    RegistrationDisclosures, SignatureParts, SignedRegistrationChallenge,
    build_advanced_deregister_user_data_ascii, build_advanced_register_user_data_ascii,
    build_simple_deregister_user_data_ascii, build_simple_register_user_data_ascii,
    build_wallet_free_register_user_data_ascii, compute_registration_challenge_hash,
    get_registration_config_index, sign_registration_challenge,
};
pub use registration_flow::{
    DeregistrationRequest, DeregistrationSession, RegistrationError, RegistrationRequest,
    RegistrationResult, RegistrationSession,
};
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
