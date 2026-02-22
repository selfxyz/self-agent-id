//! REST-based registration and deregistration flow for AI agents.
//!
//! # Example
//!
//! ```ignore
//! use self_agent_sdk::registration_flow::*;
//!
//! let session = RegistrationSession::request(RegistrationRequest {
//!     mode: "agent-identity".into(),
//!     network: "mainnet".into(),
//!     ..Default::default()
//! }).await?;
//!
//! println!("QR: {}", session.qr_url);
//! println!("Instructions: {:?}", session.human_instructions);
//!
//! let result = session.wait_for_completion(None, None).await?;
//! println!("Agent ID: {}", result.agent_id);
//! ```

use reqwest::Client;
use serde::Serialize;
use std::time::{Duration, Instant};

/// Default API base URL.
pub const DEFAULT_API_BASE: &str = "https://selfagentid.xyz";

/// Default polling timeout (30 minutes).
pub const DEFAULT_TIMEOUT_MS: u64 = 30 * 60 * 1000;

/// Default polling interval (5 seconds).
pub const DEFAULT_POLL_INTERVAL_MS: u64 = 5000;

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
    pub agent_private_key: String,
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
        let base = api_base.unwrap_or(DEFAULT_API_BASE);
        let http = Client::new();
        let resp = http
            .post(format!("{base}/api/agent/register"))
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
            api_base: base.to_string(),
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
    /// Only available for modes that created a new keypair (e.g. agent-identity).
    pub async fn export_key(&self) -> Result<String, RegistrationError> {
        let resp = self
            .http
            .get(format!("{}/api/agent/register/export", self.api_base))
            .query(&[("token", &self.session_token)])
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
        let base = api_base.unwrap_or(DEFAULT_API_BASE);
        let http = Client::new();
        let resp = http
            .post(format!("{base}/api/agent/deregister"))
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
            api_base: base.to_string(),
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
