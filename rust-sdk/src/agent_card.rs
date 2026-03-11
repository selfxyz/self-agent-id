// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Helpers ────────────────────────────────────────────────────────────────

/// Slugify a string into a URL/ID-safe lowercase-hyphenated form.
fn slugify(s: &str) -> String {
    let lowered = s.to_lowercase();
    let replaced: String = lowered
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    replaced
        .trim_matches('-')
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

// ─── A2A Agent Card sub-types ───────────────────────────────────────────────

/// A capability or skill advertised by an A2A agent (v0.3.0).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSkill {
    /// Unique identifier for this skill (required per A2A v0.3.0).
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Freeform tags for categorization.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    /// Example prompts or inputs that exercise this skill.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<String>>,
    /// MIME types this skill accepts as input.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub input_modes: Option<Vec<String>>,
    /// MIME types this skill can produce.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_modes: Option<Vec<String>>,
}

/// A2A v0.3.0 agent interface declaration describing a protocol endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentInterface {
    /// The URL of this interface endpoint.
    pub url: String,
    /// The protocol binding used by this interface ("JSONRPC", "GRPC", "HTTP+JSON").
    pub protocol_binding: String,
    /// The A2A protocol version, e.g. "0.3.0".
    pub protocol_version: String,
}

/// Feature flags describing what the A2A agent endpoint supports.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2ACapabilities {
    pub streaming: bool,
    pub push_notifications: bool,
    /// Whether the agent exposes full task state transition history.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_transition_history: Option<bool>,
    /// Whether the agent supports an extended agent card endpoint.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extended_agent_card: Option<bool>,
}

/// Organization or individual that operates the A2A agent.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct A2AProvider {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
}

// ─── Security Scheme types (A2A v0.3.0 / OpenAPI-style) ─────────────────────

/// Discriminated union of all supported A2A security scheme types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum SecurityScheme {
    /// API Key authentication scheme.
    #[serde(rename = "apiKey")]
    ApiKey {
        name: String,
        #[serde(rename = "in")]
        location: String, // "header" | "query" | "cookie"
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    /// HTTP authentication scheme (e.g. Bearer).
    #[serde(rename = "http")]
    Http {
        scheme: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        bearer_format: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    /// OAuth2 authentication scheme.
    #[serde(rename = "oauth2")]
    OAuth2 {
        flows: serde_json::Value,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
    /// OpenID Connect authentication scheme.
    #[serde(rename = "openIdConnect")]
    OpenIdConnect {
        open_id_connect_url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        description: Option<String>,
    },
}

/// Named map of security schemes (OpenAPI-style).
pub type SecuritySchemes = HashMap<String, SecurityScheme>;

/// A security requirement entry: maps scheme name to list of scopes.
pub type SecurityRequirement = HashMap<String, Vec<String>>;

// ─── Signatures & Extensions ─────────────────────────────────────────────────

/// RFC 7515 JWS signature attached to the agent card.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JwsSignature {
    /// The protected header (Base64url-encoded).
    #[serde(rename = "protected")]
    pub protected_header: String,
    /// The JWS signature value (Base64url-encoded).
    pub signature: String,
    /// Optional unprotected header parameters.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<serde_json::Value>,
}

/// An agent card extension declaration.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExtension {
    /// URI identifying the extension specification.
    pub uri: String,
    /// Extension-specific data (flattened into the JSON object).
    #[serde(flatten)]
    pub data: serde_json::Map<String, serde_json::Value>,
}

// ─── Trust & Credentials ─────────────────────────────────────────────────────

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

// ─── ERC-8004 service entry ──────────────────────────────────────────────────

/// A service endpoint entry in the ERC-8004 agent document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc8004Service {
    pub name: String, // "web" | "A2A" | "MCP" | "OASF" | "ENS" | "DID" | "email"
    pub endpoint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

// ─── Cross-chain registration reference (CAIP-10) ───────────────────────────

/// Cross-chain registration reference using CAIP-10 addressing.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc8004Registration {
    pub agent_id: u64,
    pub agent_registry: String, // CAIP-10: eip155:<chainId>:<address>
}

// ─── The combined ERC-8004 + A2A document ────────────────────────────────────

/// Combined ERC-8004 registration document with optional A2A Agent Card fields
/// and Self Protocol on-chain proof metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Erc8004AgentDocument {
    // ── ERC-8004 required ──
    #[serde(rename = "type")]
    pub doc_type: String,
    pub name: String,
    pub description: String,
    pub image: String,
    pub services: Vec<Erc8004Service>,

    // ── ERC-8004 optional ──
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registrations: Option<Vec<Erc8004Registration>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_trust: Option<Vec<String>>,

    // ── A2A optional ──
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<A2AProvider>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<A2ACapabilities>,

    /// Named map of security schemes (A2A v0.3.0 / OpenAPI-style).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security_schemes: Option<SecuritySchemes>,

    /// Security requirements referencing scheme names.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub security: Option<Vec<SecurityRequirement>>,

    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_input_modes: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_output_modes: Option<Vec<String>>,

    /// A2A v0.3.0 structured interface declarations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub supported_interfaces: Option<Vec<AgentInterface>>,

    /// URL to agent icon/avatar. Maps to/from ERC-8004 `image`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon_url: Option<String>,

    /// URL to agent documentation.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation_url: Option<String>,

    /// RFC 7515 JWS signatures attached to this card.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub signatures: Option<Vec<JwsSignature>>,

    /// Agent card extension declarations.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub extensions: Option<Vec<AgentExtension>>,

    // ── Self Protocol extension ──
    #[serde(skip_serializing_if = "Option::is_none")]
    pub self_protocol: Option<SelfProtocolExtension>,

    // ── A2A skills ──
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skills: Option<Vec<AgentSkill>>,
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

// ─── Registration JSON Builder ──────────────────────────────────────────────

/// A2A-specific options for generating an ERC-8004 + A2A hybrid document.
#[derive(Debug, Clone)]
pub struct A2AOptions {
    pub version: String,
    pub url: String,
    pub provider: Option<A2AProvider>,
    pub capabilities: Option<A2ACapabilities>,
    pub security_schemes: Option<SecuritySchemes>,
    pub security: Option<Vec<SecurityRequirement>>,
    pub default_input_modes: Option<Vec<String>>,
    pub default_output_modes: Option<Vec<String>>,
    pub skills: Option<Vec<AgentSkill>>,
    pub supported_interfaces: Option<Vec<AgentInterface>>,
    pub icon_url: Option<String>,
    pub documentation_url: Option<String>,
    pub signatures: Option<Vec<JwsSignature>>,
    pub extensions: Option<Vec<AgentExtension>>,
}

/// Options for building an ERC-8004 registration JSON document.
#[derive(Debug, Clone)]
pub struct GenerateRegistrationJsonOptions {
    pub name: String,
    pub description: String,
    pub image: String,
    pub services: Vec<Erc8004Service>,
    pub active: Option<bool>,
    pub registrations: Option<Vec<Erc8004Registration>>,
    pub supported_trust: Option<Vec<String>>,
    pub a2a: Option<A2AOptions>,
}

/// Build an ERC-8004 registration document synchronously from plain options.
///
/// When `options.a2a` is provided, the returned document is also a valid A2A
/// Agent Card. Skills without an explicit `id` will have one auto-generated
/// from the skill name.
pub fn generate_registration_json(
    options: GenerateRegistrationJsonOptions,
) -> Erc8004AgentDocument {
    let a2a = &options.a2a;

    // Auto-generate skill IDs if missing
    let skills = a2a.as_ref().and_then(|a| {
        a.skills.as_ref().map(|skills| {
            skills
                .iter()
                .map(|s| AgentSkill {
                    id: if s.id.is_empty() {
                        slugify(&s.name)
                    } else {
                        s.id.clone()
                    },
                    ..s.clone()
                })
                .collect()
        })
    });

    // Auto-generate supportedInterfaces from url if not explicitly provided
    let supported_interfaces = a2a.as_ref().map(|a| {
        a.supported_interfaces.clone().unwrap_or_else(|| {
            vec![AgentInterface {
                url: a.url.clone(),
                protocol_binding: "JSONRPC".to_string(),
                protocol_version: "0.3.0".to_string(),
            }]
        })
    });

    // Ensure services array contains an A2A entry when a2a is provided
    let mut services = options.services;
    if let Some(a) = a2a.as_ref() {
        if !services.iter().any(|s| s.name == "A2A") {
            services.push(Erc8004Service {
                name: "A2A".to_string(),
                endpoint: a.url.clone(),
                version: Some(a.version.clone()),
            });
        }
    }

    let (version, url, provider, capabilities, security_schemes, security,
         default_input_modes, default_output_modes, icon_url, documentation_url,
         signatures, extensions) = match a2a.as_ref() {
        Some(a) => (
            Some(a.version.clone()),
            Some(a.url.clone()),
            a.provider.clone(),
            Some(a.capabilities.clone().unwrap_or(A2ACapabilities {
                streaming: false,
                push_notifications: false,
                state_transition_history: Some(false),
                extended_agent_card: Some(false),
            })),
            a.security_schemes.clone(),
            a.security.clone(),
            a.default_input_modes.clone(),
            a.default_output_modes.clone(),
            Some(a.icon_url.clone().unwrap_or_else(|| options.image.clone())),
            a.documentation_url.clone(),
            a.signatures.clone(),
            a.extensions.clone(),
        ),
        None => (None, None, None, None, None, None, None, None, None, None, None, None),
    };

    Erc8004AgentDocument {
        doc_type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1".to_string(),
        name: options.name,
        description: options.description,
        image: options.image,
        services,
        active: options.active,
        registrations: options.registrations,
        supported_trust: options.supported_trust,
        version,
        url,
        provider,
        capabilities,
        security_schemes,
        security,
        default_input_modes,
        default_output_modes,
        supported_interfaces,
        icon_url,
        documentation_url,
        signatures,
        extensions,
        self_protocol: None,
        skills,
    }
}
