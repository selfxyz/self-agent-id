// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

//! REST-based registration and deregistration flow for AI agents.
//!
//! # Example
//!
//! ```no_run
//! use self_agent_sdk::registration_flow::*;
//!
//! # fn main() -> Result<(), Box<dyn std::error::Error>> {
//! # tokio::runtime::Runtime::new()?.block_on(async {
//! let session = RegistrationSession::request(RegistrationRequest {
//!     mode: "linked".into(),
//!     network: "mainnet".into(),
//!     ..Default::default()
//! }, None).await?;
//!
//! println!("QR: {}", session.qr_url);
//! println!("Instructions: {:?}", session.human_instructions);
//!
//! let result = session.wait_for_completion(None, None).await?;
//! println!("Agent ID: {}", result.agent_id);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! # })?;
//! # Ok(())
//! # }
//! ```

use reqwest::Client;
use serde::Serialize;
use std::time::{Duration, Instant};

/// Default API base URL (overridden by `SELF_AGENT_API_BASE` when set).
pub const DEFAULT_API_BASE: &str = "https://self-agent-id.vercel.app";

/// Default polling timeout (30 minutes).
pub const DEFAULT_TIMEOUT_MS: u64 = 30 * 60 * 1000;

/// Default polling interval (5 seconds).
pub const DEFAULT_POLL_INTERVAL_MS: u64 = 5000;

fn resolve_api_base(api_base: Option<&str>) -> String {
    if let Some(base) = api_base {
        return base.to_string();
    }
    if let Ok(base) = std::env::var("SELF_AGENT_API_BASE") {
        let trimmed = base.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    DEFAULT_API_BASE.to_string()
}

/// Errors specific to the registration flow.
#[derive(Debug, thiserror::Error)]
pub enum RegistrationError {
    #[error("session expired — call request_registration() again")]
    ExpiredSession,
    #[error("registration failed: {0}")]
    Failed(String),
    #[error("registration timed out")]
    Timeout,
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("API error: {0}")]
    Api(String),
}

/// Request payload for initiating a registration.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationRequest {
    pub mode: String,
    pub network: String,
    #[serde(default)]
    pub disclosures: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub human_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_description: Option<String>,
}

/// Request payload for initiating a deregistration.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeregistrationRequest {
    pub network: String,
    pub agent_address: String,
}

/// Successful registration result.
#[derive(Debug, Clone)]
pub struct RegistrationResult {
    pub agent_id: u64,
    pub agent_address: String,
    pub credentials: Option<serde_json::Value>,
    pub tx_hash: Option<String>,
}

/// An in-progress registration session.
#[derive(Debug, Clone)]
pub struct RegistrationSession {
    pub session_token: String,
    pub stage: String,
    pub qr_url: String,
    pub deep_link: String,
    pub agent_address: String,
    pub expires_at: String,
    pub time_remaining_ms: u64,
    pub human_instructions: Vec<String>,
    api_base: String,
    http: Client,
}

impl RegistrationSession {
    /// Initiate a registration via the REST API.
    pub async fn request(
        req: RegistrationRequest,
        api_base: Option<&str>,
    ) -> Result<Self, RegistrationError> {
        let base = resolve_api_base(api_base);
        let http = Client::new();
        let resp = http
            .post(format!("{}/api/agent/register", base))
            .json(&req)
            .send()
            .await
            .map_err(|e| RegistrationError::Http(e.to_string()))?;

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| RegistrationError::Http(e.to_string()))?;

        if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
            return Err(RegistrationError::Api(err.to_string()));
        }

        Ok(Self {
            session_token: json_str(&data, "sessionToken"),
            stage: json_str(&data, "stage"),
            qr_url: json_str(&data, "qrUrl"),
            deep_link: json_str(&data, "deepLink"),
            agent_address: json_str(&data, "agentAddress"),
            expires_at: json_str(&data, "expiresAt"),
            time_remaining_ms: data
                .get("timeRemainingMs")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            human_instructions: json_str_array(&data, "humanInstructions"),
            api_base: base,
            http,
        })
    }

    /// Poll until registration completes or times out.
    pub async fn wait_for_completion(
        &self,
        timeout_ms: Option<u64>,
        poll_interval_ms: Option<u64>,
    ) -> Result<RegistrationResult, RegistrationError> {
        let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
        let interval = Duration::from_millis(poll_interval_ms.unwrap_or(DEFAULT_POLL_INTERVAL_MS));
        let deadline = Instant::now() + timeout;
        let mut token = self.session_token.clone();

        while Instant::now() < deadline {
            let resp = self
                .http
                .get(format!("{}/api/agent/register/status", self.api_base))
                .query(&[("token", &token)])
                .send()
                .await
                .map_err(|e| RegistrationError::Http(e.to_string()))?;

            let data: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| RegistrationError::Http(e.to_string()))?;

            if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
                if err.to_lowercase().contains("expired") {
                    return Err(RegistrationError::ExpiredSession);
                }
            }

            let stage = json_str(&data, "stage");
            if let Some(t) = data.get("sessionToken").and_then(|v| v.as_str()) {
                token = t.to_string();
            }

            match stage.as_str() {
                "completed" => {
                    return Ok(RegistrationResult {
                        agent_id: data
                            .get("agentId")
                            .and_then(|v| v.as_u64())
                            .unwrap_or(0),
                        agent_address: json_str(&data, "agentAddress"),
                        credentials: data.get("credentials").cloned(),
                        tx_hash: data.get("txHash").and_then(|v| v.as_str()).map(String::from),
                    });
                }
                "failed" => {
                    let err = json_str(&data, "error");
                    return Err(RegistrationError::Failed(
                        if err.is_empty() { "Registration failed".into() } else { err },
                    ));
                }
                "expired" => return Err(RegistrationError::ExpiredSession),
                _ => {}
            }

            tokio::time::sleep(interval).await;
        }

        Err(RegistrationError::Timeout)
    }

    /// Export the agent private key generated during registration.
    ///
    /// Only available for modes that created a new keypair (e.g. linked).
    pub async fn export_key(&self) -> Result<String, RegistrationError> {
        let resp = self
            .http
            .post(format!("{}/api/agent/register/export", self.api_base))
            .json(&serde_json::json!({ "token": self.session_token }))
            .send()
            .await
            .map_err(|e| RegistrationError::Http(e.to_string()))?;

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| RegistrationError::Http(e.to_string()))?;

        if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
            return Err(RegistrationError::Api(err.to_string()));
        }

        Ok(json_str(&data, "privateKey"))
    }
}

/// An in-progress deregistration session.
#[derive(Debug, Clone)]
pub struct DeregistrationSession {
    pub session_token: String,
    pub stage: String,
    pub qr_url: String,
    pub deep_link: String,
    pub expires_at: String,
    pub time_remaining_ms: u64,
    pub human_instructions: Vec<String>,
    api_base: String,
    http: Client,
}

impl DeregistrationSession {
    /// Initiate a deregistration via the REST API.
    pub async fn request(
        req: DeregistrationRequest,
        api_base: Option<&str>,
    ) -> Result<Self, RegistrationError> {
        let base = resolve_api_base(api_base);
        let http = Client::new();
        let resp = http
            .post(format!("{}/api/agent/deregister", base))
            .json(&req)
            .send()
            .await
            .map_err(|e| RegistrationError::Http(e.to_string()))?;

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| RegistrationError::Http(e.to_string()))?;

        if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
            return Err(RegistrationError::Api(err.to_string()));
        }

        Ok(Self {
            session_token: json_str(&data, "sessionToken"),
            stage: json_str(&data, "stage"),
            qr_url: json_str(&data, "qrUrl"),
            deep_link: json_str(&data, "deepLink"),
            expires_at: json_str(&data, "expiresAt"),
            time_remaining_ms: data
                .get("timeRemainingMs")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            human_instructions: json_str_array(&data, "humanInstructions"),
            api_base: base,
            http,
        })
    }

    /// Poll until deregistration completes or times out.
    pub async fn wait_for_completion(
        &self,
        timeout_ms: Option<u64>,
        poll_interval_ms: Option<u64>,
    ) -> Result<(), RegistrationError> {
        let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
        let interval = Duration::from_millis(poll_interval_ms.unwrap_or(DEFAULT_POLL_INTERVAL_MS));
        let deadline = Instant::now() + timeout;
        let mut token = self.session_token.clone();

        while Instant::now() < deadline {
            let resp = self
                .http
                .get(format!("{}/api/agent/deregister/status", self.api_base))
                .query(&[("token", &token)])
                .send()
                .await
                .map_err(|e| RegistrationError::Http(e.to_string()))?;

            let data: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| RegistrationError::Http(e.to_string()))?;

            let stage = json_str(&data, "stage");
            if let Some(t) = data.get("sessionToken").and_then(|v| v.as_str()) {
                token = t.to_string();
            }

            match stage.as_str() {
                "completed" => return Ok(()),
                "failed" => {
                    let err = json_str(&data, "error");
                    return Err(RegistrationError::Failed(
                        if err.is_empty() { "Deregistration failed".into() } else { err },
                    ));
                }
                "expired" => {
                    return Err(RegistrationError::Failed(
                        "Deregistration session expired".into(),
                    ))
                }
                _ => {}
            }

            tokio::time::sleep(interval).await;
        }

        Err(RegistrationError::Timeout)
    }
}

// ---------------------------------------------------------------------------
// Proof Refresh
// ---------------------------------------------------------------------------

/// Request payload for initiating a proof refresh.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProofRefreshRequest {
    /// Agent ID (token ID) to refresh the proof for.
    pub agent_id: u64,
    /// Network: "mainnet" (default) or "testnet".
    pub network: String,
    /// Credential disclosures to request (should match original registration).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub disclosures: Option<serde_json::Value>,
}

/// Successful proof refresh result.
#[derive(Debug, Clone)]
pub struct ProofRefreshResult {
    /// Unix timestamp (seconds) when the new proof expires.
    pub proof_expires_at: u64,
}

/// An in-progress proof refresh session.
#[derive(Debug, Clone)]
pub struct RefreshSession {
    pub session_token: String,
    pub stage: String,
    pub deep_link: String,
    pub expires_at: String,
    pub time_remaining_ms: u64,
    pub human_instructions: Vec<String>,
    api_base: String,
    http: Client,
}

impl RefreshSession {
    /// Initiate a proof refresh via the REST API.
    pub async fn request(
        req: ProofRefreshRequest,
        api_base: Option<&str>,
    ) -> Result<Self, RegistrationError> {
        let base = resolve_api_base(api_base);
        let http = Client::new();
        let resp = http
            .post(format!("{}/api/agent/refresh", base))
            .json(&req)
            .send()
            .await
            .map_err(|e| RegistrationError::Http(e.to_string()))?;

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| RegistrationError::Http(e.to_string()))?;

        if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
            return Err(RegistrationError::Api(err.to_string()));
        }

        Ok(Self {
            session_token: json_str(&data, "sessionToken"),
            stage: json_str(&data, "stage"),
            deep_link: json_str(&data, "deepLink"),
            expires_at: json_str(&data, "expiresAt"),
            time_remaining_ms: data
                .get("timeRemainingMs")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            human_instructions: json_str_array(&data, "humanInstructions"),
            api_base: base,
            http,
        })
    }

    /// Poll until proof refresh completes or times out.
    pub async fn wait_for_completion(
        &self,
        timeout_ms: Option<u64>,
        poll_interval_ms: Option<u64>,
    ) -> Result<ProofRefreshResult, RegistrationError> {
        let timeout = Duration::from_millis(timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS));
        let interval = Duration::from_millis(poll_interval_ms.unwrap_or(DEFAULT_POLL_INTERVAL_MS));
        let deadline = Instant::now() + timeout;
        let mut token = self.session_token.clone();

        while Instant::now() < deadline {
            let resp = self
                .http
                .get(format!("{}/api/agent/refresh/status", self.api_base))
                .query(&[("token", &token)])
                .send()
                .await
                .map_err(|e| RegistrationError::Http(e.to_string()))?;

            let data: serde_json::Value = resp
                .json()
                .await
                .map_err(|e| RegistrationError::Http(e.to_string()))?;

            if let Some(err) = data.get("error").and_then(|v| v.as_str()) {
                if err.to_lowercase().contains("expired") {
                    return Err(RegistrationError::ExpiredSession);
                }
            }

            let stage = json_str(&data, "stage");
            if let Some(t) = data.get("sessionToken").and_then(|v| v.as_str()) {
                token = t.to_string();
            }

            match stage.as_str() {
                "completed" => {
                    // The status response may include proofExpiresAt as a unix
                    // timestamp (number) or an ISO date string. Try number first,
                    // then fall back to string-as-number, then 1 year default.
                    let proof_expires_at = data
                        .get("proofExpiresAt")
                        .and_then(|v| {
                            v.as_u64().or_else(|| {
                                v.as_str().and_then(|s| s.parse::<u64>().ok())
                            })
                        })
                        // Fallback: 1 year from now
                        .unwrap_or_else(|| {
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .expect("system clock before UNIX epoch")
                                .as_secs()
                                + 365 * 24 * 60 * 60
                        });
                    return Ok(ProofRefreshResult { proof_expires_at });
                }
                "failed" => {
                    return Err(RegistrationError::Failed(
                        "Proof refresh failed on-chain".into(),
                    ));
                }
                "expired" => return Err(RegistrationError::ExpiredSession),
                _ => {}
            }

            tokio::time::sleep(interval).await;
        }

        Err(RegistrationError::Timeout)
    }
}

/// Initiate a proof refresh for an existing agent through the Self Agent ID REST API.
///
/// Returns a session object with a deep link for the human to scan in the Self app,
/// and a polling method to wait for the new proof to be recorded on-chain.
pub async fn request_proof_refresh(
    req: ProofRefreshRequest,
    api_base: Option<&str>,
) -> Result<RefreshSession, RegistrationError> {
    RefreshSession::request(req, api_base).await
}

/// Helper: extract a string from a JSON value, defaulting to empty string.
fn json_str(data: &serde_json::Value, key: &str) -> String {
    data.get(key)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

/// Helper: extract a string array from a JSON value.
fn json_str_array(data: &serde_json::Value, key: &str) -> Vec<String> {
    data.get(key)
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}
