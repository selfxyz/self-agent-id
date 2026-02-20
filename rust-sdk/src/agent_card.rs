use serde::{Deserialize, Serialize};

// ─── Types ───────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2AAgentCard {
    pub a2a_version: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<AgentSkill>>,
    pub self_protocol: SelfProtocolExtension,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkill {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelfProtocolExtension {
    pub agent_id: u64,
    pub registry: String,
    pub chain_id: u64,
    pub proof_provider: String,
    pub provider_name: String,
    pub verification_strength: u8,
    pub trust_model: TrustModel,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credentials: Option<CardCredentials>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustModel {
    pub proof_type: String,
    pub sybil_resistant: bool,
    pub ofac_screened: bool,
    pub minimum_age_verified: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CardCredentials {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nationality: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuing_state: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub older_than: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ofac_clean: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_name: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_date_of_birth: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub has_gender: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_expiry: Option<String>,
}

// ─── Provider Scoring ────────────────────────────────────────────────────────

pub fn get_provider_label(strength: u8) -> &'static str {
    match strength {
        100..=u8::MAX => "passport",
        80..=99 => "kyc",
        60..=79 => "govt_id",
        40..=59 => "liveness",
        _ => "unknown",
    }
}

pub fn get_strength_color(strength: u8) -> &'static str {
    match strength {
        80..=u8::MAX => "green",
        60..=79 => "blue",
        40..=59 => "amber",
        _ => "gray",
    }
}
