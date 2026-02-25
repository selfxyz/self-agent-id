// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1

//! Integration tests for A2AAgentCard, provider scoring helpers, and serde behaviour.

use self_agent_sdk::{
    A2AAgentCard, AgentSkill, CardCredentials, SelfProtocolExtension, TrustModel,
    get_provider_label, get_strength_color,
};

// =========================================================================
// 1. get_provider_label boundaries
// =========================================================================

#[test]
fn provider_label_passport_at_100() {
    assert_eq!(get_provider_label(100), "passport");
}

#[test]
fn provider_label_passport_at_max() {
    assert_eq!(get_provider_label(255), "passport");
}

#[test]
fn provider_label_kyc_at_99() {
    assert_eq!(get_provider_label(99), "kyc");
}

#[test]
fn provider_label_kyc_at_80() {
    assert_eq!(get_provider_label(80), "kyc");
}

#[test]
fn provider_label_govt_id_at_79() {
    assert_eq!(get_provider_label(79), "govt_id");
}

#[test]
fn provider_label_govt_id_at_60() {
    assert_eq!(get_provider_label(60), "govt_id");
}

#[test]
fn provider_label_liveness_at_59() {
    assert_eq!(get_provider_label(59), "liveness");
}

#[test]
fn provider_label_liveness_at_40() {
    assert_eq!(get_provider_label(40), "liveness");
}

#[test]
fn provider_label_unknown_at_39() {
    assert_eq!(get_provider_label(39), "unknown");
}

#[test]
fn provider_label_unknown_at_0() {
    assert_eq!(get_provider_label(0), "unknown");
}

#[test]
fn provider_label_unknown_at_1() {
    assert_eq!(get_provider_label(1), "unknown");
}

// =========================================================================
// 2. get_strength_color boundaries
// =========================================================================

#[test]
fn strength_color_green_at_100() {
    assert_eq!(get_strength_color(100), "green");
}

#[test]
fn strength_color_green_at_80() {
    assert_eq!(get_strength_color(80), "green");
}

#[test]
fn strength_color_green_at_255() {
    assert_eq!(get_strength_color(255), "green");
}

#[test]
fn strength_color_blue_at_79() {
    assert_eq!(get_strength_color(79), "blue");
}

#[test]
fn strength_color_blue_at_60() {
    assert_eq!(get_strength_color(60), "blue");
}

#[test]
fn strength_color_amber_at_59() {
    assert_eq!(get_strength_color(59), "amber");
}

#[test]
fn strength_color_amber_at_40() {
    assert_eq!(get_strength_color(40), "amber");
}

#[test]
fn strength_color_gray_at_39() {
    assert_eq!(get_strength_color(39), "gray");
}

#[test]
fn strength_color_gray_at_0() {
    assert_eq!(get_strength_color(0), "gray");
}

#[test]
fn strength_color_gray_at_1() {
    assert_eq!(get_strength_color(1), "gray");
}

// =========================================================================
// Helper: build a fully-populated card for reuse
// =========================================================================

fn full_card() -> A2AAgentCard {
    A2AAgentCard {
        a2a_version: "0.1".into(),
        name: "Test Agent".into(),
        description: Some("A test agent".into()),
        url: Some("https://example.com/a2a".into()),
        capabilities: None,
        skills: Some(vec![AgentSkill {
            name: "chat".into(),
            description: Some("Chat capability".into()),
        }]),
        self_protocol: SelfProtocolExtension {
            agent_id: 42,
            registry: "0x60651482a3033A72128f874623Fc790061cc46D4".into(),
            chain_id: 42220,
            proof_provider: "0xb0F718Bad279e51A9447D36EAa457418dBd4D95b".into(),
            provider_name: "Self Protocol".into(),
            verification_strength: 100,
            trust_model: TrustModel {
                proof_type: "passport".into(),
                sybil_resistant: true,
                ofac_screened: true,
                minimum_age_verified: 18,
            },
            credentials: Some(CardCredentials {
                nationality: Some("US".into()),
                issuing_state: Some("US".into()),
                older_than: Some(21),
                ofac_clean: Some(true),
                has_name: Some(true),
                has_date_of_birth: Some(true),
                has_gender: None,
                document_expiry: Some("2030-01-01".into()),
            }),
        },
    }
}

fn minimal_card() -> A2AAgentCard {
    A2AAgentCard {
        a2a_version: "0.1".into(),
        name: "Minimal".into(),
        description: None,
        url: None,
        capabilities: None,
        skills: None,
        self_protocol: SelfProtocolExtension {
            agent_id: 1,
            registry: "0x0000000000000000000000000000000000000001".into(),
            chain_id: 42220,
            proof_provider: "0x0000000000000000000000000000000000000002".into(),
            provider_name: "Test".into(),
            verification_strength: 50,
            trust_model: TrustModel {
                proof_type: "liveness".into(),
                sybil_resistant: false,
                ofac_screened: false,
                minimum_age_verified: 0,
            },
            credentials: None,
        },
    }
}

// =========================================================================
// 3. A2AAgentCard serde round-trip
// =========================================================================

#[test]
fn agent_card_serde_round_trip() {
    let card = full_card();
    let json = serde_json::to_string(&card).unwrap();
    let deserialized: A2AAgentCard = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.a2a_version, "0.1");
    assert_eq!(deserialized.name, "Test Agent");
    assert_eq!(deserialized.description, Some("A test agent".into()));
    assert_eq!(deserialized.url, Some("https://example.com/a2a".into()));
    assert!(deserialized.capabilities.is_none());

    // Skills
    let skills = deserialized.skills.unwrap();
    assert_eq!(skills.len(), 1);
    assert_eq!(skills[0].name, "chat");
    assert_eq!(skills[0].description, Some("Chat capability".into()));

    // Self protocol extension
    let sp = &deserialized.self_protocol;
    assert_eq!(sp.agent_id, 42);
    assert_eq!(sp.registry, "0x60651482a3033A72128f874623Fc790061cc46D4");
    assert_eq!(sp.chain_id, 42220);
    assert_eq!(
        sp.proof_provider,
        "0xb0F718Bad279e51A9447D36EAa457418dBd4D95b"
    );
    assert_eq!(sp.provider_name, "Self Protocol");
    assert_eq!(sp.verification_strength, 100);

    // Trust model
    assert_eq!(sp.trust_model.proof_type, "passport");
    assert!(sp.trust_model.sybil_resistant);
    assert!(sp.trust_model.ofac_screened);
    assert_eq!(sp.trust_model.minimum_age_verified, 18);

    // Credentials
    let creds = sp.credentials.as_ref().unwrap();
    assert_eq!(creds.nationality, Some("US".into()));
    assert_eq!(creds.issuing_state, Some("US".into()));
    assert_eq!(creds.older_than, Some(21));
    assert_eq!(creds.ofac_clean, Some(true));
    assert_eq!(creds.has_name, Some(true));
    assert_eq!(creds.has_date_of_birth, Some(true));
    assert_eq!(creds.has_gender, None);
    assert_eq!(creds.document_expiry, Some("2030-01-01".into()));
}

#[test]
fn agent_card_round_trip_preserves_json_value() {
    let card = full_card();
    let json = serde_json::to_string(&card).unwrap();
    let value: serde_json::Value = serde_json::from_str(&json).unwrap();
    let back: A2AAgentCard = serde_json::from_value(value.clone()).unwrap();
    let json2 = serde_json::to_string(&back).unwrap();

    // Round-tripping through Value should produce identical JSON.
    assert_eq!(json, json2);
}

// =========================================================================
// 4. A2AAgentCard serde with skip_serializing_if
// =========================================================================

#[test]
fn agent_card_skip_serializing_none_fields() {
    let card = minimal_card();
    let json = serde_json::to_string(&card).unwrap();

    // These optional fields are None and should be omitted entirely.
    assert!(
        !json.contains("description"),
        "None description should be omitted from JSON"
    );
    assert!(
        !json.contains("url"),
        "None url should be omitted from JSON"
    );
    assert!(
        !json.contains("capabilities"),
        "None capabilities should be omitted from JSON"
    );
    assert!(
        !json.contains("skills"),
        "None skills should be omitted from JSON"
    );
    assert!(
        !json.contains("credentials"),
        "None credentials should be omitted from JSON"
    );
}

#[test]
fn agent_card_includes_present_optional_fields() {
    let card = full_card();
    let json = serde_json::to_string(&card).unwrap();

    // These are Some(...) and should be present.
    assert!(json.contains("description"));
    assert!(json.contains("url"));
    assert!(json.contains("skills"));
    assert!(json.contains("credentials"));
}

// =========================================================================
// 5. A2AAgentCard camelCase serialization
// =========================================================================

#[test]
fn agent_card_camel_case_field_names() {
    let card = full_card();
    let json = serde_json::to_string(&card).unwrap();

    // Top-level camelCase
    assert!(
        json.contains("a2aVersion"),
        "a2a_version should serialize as a2aVersion"
    );
    assert!(
        json.contains("selfProtocol"),
        "self_protocol should serialize as selfProtocol"
    );

    // SelfProtocolExtension camelCase
    assert!(
        json.contains("agentId"),
        "agent_id should serialize as agentId"
    );
    assert!(
        json.contains("chainId"),
        "chain_id should serialize as chainId"
    );
    assert!(
        json.contains("proofProvider"),
        "proof_provider should serialize as proofProvider"
    );
    assert!(
        json.contains("providerName"),
        "provider_name should serialize as providerName"
    );
    assert!(
        json.contains("verificationStrength"),
        "verification_strength should serialize as verificationStrength"
    );
    assert!(
        json.contains("trustModel"),
        "trust_model should serialize as trustModel"
    );

    // TrustModel camelCase
    assert!(
        json.contains("proofType"),
        "proof_type should serialize as proofType"
    );
    assert!(
        json.contains("sybilResistant"),
        "sybil_resistant should serialize as sybilResistant"
    );
    assert!(
        json.contains("ofacScreened"),
        "ofac_screened should serialize as ofacScreened"
    );
    assert!(
        json.contains("minimumAgeVerified"),
        "minimum_age_verified should serialize as minimumAgeVerified"
    );
}

#[test]
fn agent_card_camel_case_credentials() {
    let card = full_card();
    let json = serde_json::to_string(&card).unwrap();

    // CardCredentials camelCase
    assert!(
        json.contains("issuingState"),
        "issuing_state should serialize as issuingState"
    );
    assert!(
        json.contains("olderThan"),
        "older_than should serialize as olderThan"
    );
    assert!(
        json.contains("ofacClean"),
        "ofac_clean should serialize as ofacClean"
    );
    assert!(
        json.contains("hasName"),
        "has_name should serialize as hasName"
    );
    assert!(
        json.contains("hasDateOfBirth"),
        "has_date_of_birth should serialize as hasDateOfBirth"
    );
    assert!(
        json.contains("documentExpiry"),
        "document_expiry should serialize as documentExpiry"
    );
}

#[test]
fn agent_card_no_snake_case_in_json() {
    let card = full_card();
    let json = serde_json::to_string(&card).unwrap();

    // Verify no snake_case field names leaked into the JSON.
    assert!(
        !json.contains("a2a_version"),
        "snake_case a2a_version should NOT appear in JSON"
    );
    assert!(
        !json.contains("self_protocol"),
        "snake_case self_protocol should NOT appear in JSON"
    );
    assert!(
        !json.contains("agent_id"),
        "snake_case agent_id should NOT appear in JSON"
    );
    assert!(
        !json.contains("chain_id"),
        "snake_case chain_id should NOT appear in JSON"
    );
    assert!(
        !json.contains("proof_provider"),
        "snake_case proof_provider should NOT appear in JSON"
    );
    assert!(
        !json.contains("provider_name"),
        "snake_case provider_name should NOT appear in JSON"
    );
    assert!(
        !json.contains("verification_strength"),
        "snake_case verification_strength should NOT appear in JSON"
    );
    assert!(
        !json.contains("trust_model"),
        "snake_case trust_model should NOT appear in JSON"
    );
    assert!(
        !json.contains("proof_type"),
        "snake_case proof_type should NOT appear in JSON"
    );
    assert!(
        !json.contains("sybil_resistant"),
        "snake_case sybil_resistant should NOT appear in JSON"
    );
    assert!(
        !json.contains("ofac_screened"),
        "snake_case ofac_screened should NOT appear in JSON"
    );
    assert!(
        !json.contains("minimum_age_verified"),
        "snake_case minimum_age_verified should NOT appear in JSON"
    );
    assert!(
        !json.contains("issuing_state"),
        "snake_case issuing_state should NOT appear in JSON"
    );
    assert!(
        !json.contains("older_than"),
        "snake_case older_than should NOT appear in JSON"
    );
    assert!(
        !json.contains("ofac_clean"),
        "snake_case ofac_clean should NOT appear in JSON"
    );
    assert!(
        !json.contains("has_name"),
        "snake_case has_name should NOT appear in JSON"
    );
    assert!(
        !json.contains("has_date_of_birth"),
        "snake_case has_date_of_birth should NOT appear in JSON"
    );
    assert!(
        !json.contains("document_expiry"),
        "snake_case document_expiry should NOT appear in JSON"
    );
}

// =========================================================================
// 6. CardCredentials partial population
// =========================================================================

#[test]
fn card_credentials_partial_population() {
    let creds = CardCredentials {
        nationality: Some("DE".into()),
        issuing_state: None,
        older_than: Some(18),
        ofac_clean: None,
        has_name: None,
        has_date_of_birth: Some(true),
        has_gender: None,
        document_expiry: None,
    };

    let json = serde_json::to_string(&creds).unwrap();

    // Present fields
    assert!(json.contains("nationality"));
    assert!(json.contains("olderThan"));
    assert!(json.contains("hasDateOfBirth"));

    // Omitted fields (skip_serializing_if = None)
    assert!(!json.contains("issuingState"));
    assert!(!json.contains("ofacClean"));
    assert!(!json.contains("hasName"));
    assert!(!json.contains("hasGender"));
    assert!(!json.contains("documentExpiry"));

    // Round-trip
    let deserialized: CardCredentials = serde_json::from_str(&json).unwrap();
    assert_eq!(deserialized.nationality, Some("DE".into()));
    assert_eq!(deserialized.issuing_state, None);
    assert_eq!(deserialized.older_than, Some(18));
    assert_eq!(deserialized.ofac_clean, None);
    assert_eq!(deserialized.has_date_of_birth, Some(true));
}

#[test]
fn card_credentials_all_none() {
    let creds = CardCredentials {
        nationality: None,
        issuing_state: None,
        older_than: None,
        ofac_clean: None,
        has_name: None,
        has_date_of_birth: None,
        has_gender: None,
        document_expiry: None,
    };

    let json = serde_json::to_string(&creds).unwrap();

    // Should be an empty object (all fields skipped).
    assert_eq!(json, "{}");
}

#[test]
fn card_credentials_all_populated() {
    let creds = CardCredentials {
        nationality: Some("JP".into()),
        issuing_state: Some("JP".into()),
        older_than: Some(25),
        ofac_clean: Some(true),
        has_name: Some(true),
        has_date_of_birth: Some(true),
        has_gender: Some(true),
        document_expiry: Some("2028-06-15".into()),
    };

    let json = serde_json::to_string(&creds).unwrap();
    let deserialized: CardCredentials = serde_json::from_str(&json).unwrap();

    assert_eq!(deserialized.nationality, Some("JP".into()));
    assert_eq!(deserialized.issuing_state, Some("JP".into()));
    assert_eq!(deserialized.older_than, Some(25));
    assert_eq!(deserialized.ofac_clean, Some(true));
    assert_eq!(deserialized.has_name, Some(true));
    assert_eq!(deserialized.has_date_of_birth, Some(true));
    assert_eq!(deserialized.has_gender, Some(true));
    assert_eq!(deserialized.document_expiry, Some("2028-06-15".into()));
}

// =========================================================================
// 7. TrustModel serialization
// =========================================================================

#[test]
fn trust_model_all_true() {
    let tm = TrustModel {
        proof_type: "passport".into(),
        sybil_resistant: true,
        ofac_screened: true,
        minimum_age_verified: 21,
    };

    let json = serde_json::to_string(&tm).unwrap();
    assert!(json.contains(r#""sybilResistant":true"#));
    assert!(json.contains(r#""ofacScreened":true"#));
    assert!(json.contains(r#""minimumAgeVerified":21"#));
    assert!(json.contains(r#""proofType":"passport""#));

    let deserialized: TrustModel = serde_json::from_str(&json).unwrap();
    assert!(deserialized.sybil_resistant);
    assert!(deserialized.ofac_screened);
    assert_eq!(deserialized.minimum_age_verified, 21);
    assert_eq!(deserialized.proof_type, "passport");
}

#[test]
fn trust_model_all_false() {
    let tm = TrustModel {
        proof_type: "unknown".into(),
        sybil_resistant: false,
        ofac_screened: false,
        minimum_age_verified: 0,
    };

    let json = serde_json::to_string(&tm).unwrap();
    assert!(json.contains(r#""sybilResistant":false"#));
    assert!(json.contains(r#""ofacScreened":false"#));
    assert!(json.contains(r#""minimumAgeVerified":0"#));

    let deserialized: TrustModel = serde_json::from_str(&json).unwrap();
    assert!(!deserialized.sybil_resistant);
    assert!(!deserialized.ofac_screened);
    assert_eq!(deserialized.minimum_age_verified, 0);
}

#[test]
fn trust_model_mixed_booleans() {
    let tm = TrustModel {
        proof_type: "kyc".into(),
        sybil_resistant: true,
        ofac_screened: false,
        minimum_age_verified: 18,
    };

    let json = serde_json::to_string(&tm).unwrap();
    let deserialized: TrustModel = serde_json::from_str(&json).unwrap();
    assert!(deserialized.sybil_resistant);
    assert!(!deserialized.ofac_screened);
    assert_eq!(deserialized.minimum_age_verified, 18);
    assert_eq!(deserialized.proof_type, "kyc");
}

// =========================================================================
// AgentSkill serde
// =========================================================================

#[test]
fn agent_skill_with_description() {
    let skill = AgentSkill {
        name: "summarize".into(),
        description: Some("Summarize documents".into()),
    };
    let json = serde_json::to_string(&skill).unwrap();
    assert!(json.contains(r#""name":"summarize""#));
    assert!(json.contains(r#""description":"Summarize documents""#));
}

#[test]
fn agent_skill_without_description() {
    let skill = AgentSkill {
        name: "translate".into(),
        description: None,
    };
    let json = serde_json::to_string(&skill).unwrap();
    assert!(json.contains(r#""name":"translate""#));
    assert!(
        !json.contains("description"),
        "None description should be omitted"
    );
}

// =========================================================================
// Deserialization from external JSON
// =========================================================================

#[test]
fn deserialize_from_external_json() {
    let external_json = r#"{
        "a2aVersion": "0.1",
        "name": "External Agent",
        "selfProtocol": {
            "agentId": 99,
            "registry": "0x1234567890abcdef1234567890abcdef12345678",
            "chainId": 11142220,
            "proofProvider": "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            "providerName": "Test Provider",
            "verificationStrength": 80,
            "trustModel": {
                "proofType": "kyc",
                "sybilResistant": false,
                "ofacScreened": true,
                "minimumAgeVerified": 0
            }
        }
    }"#;

    let card: A2AAgentCard = serde_json::from_str(external_json).unwrap();
    assert_eq!(card.name, "External Agent");
    assert_eq!(card.self_protocol.agent_id, 99);
    assert_eq!(card.self_protocol.chain_id, 11142220);
    assert_eq!(card.self_protocol.verification_strength, 80);
    assert_eq!(card.self_protocol.trust_model.proof_type, "kyc");
    assert!(card.self_protocol.trust_model.ofac_screened);
    assert!(!card.self_protocol.trust_model.sybil_resistant);
    assert!(card.description.is_none());
    assert!(card.skills.is_none());
    assert!(card.self_protocol.credentials.is_none());
}

#[test]
fn deserialize_with_unknown_fields_is_permissive() {
    // serde default allows (and ignores) unknown fields — verify this works.
    let json_with_extras = r#"{
        "a2aVersion": "0.1",
        "name": "Flexible Agent",
        "extraField": "should be ignored",
        "selfProtocol": {
            "agentId": 1,
            "registry": "0x0000000000000000000000000000000000000001",
            "chainId": 42220,
            "proofProvider": "0x0000000000000000000000000000000000000002",
            "providerName": "Test",
            "verificationStrength": 50,
            "trustModel": {
                "proofType": "liveness",
                "sybilResistant": false,
                "ofacScreened": false,
                "minimumAgeVerified": 0,
                "futureField": true
            }
        }
    }"#;

    let card: A2AAgentCard = serde_json::from_str(json_with_extras).unwrap();
    assert_eq!(card.name, "Flexible Agent");
}
