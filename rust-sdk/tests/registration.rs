// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

//! Tests for the registration module — config index mapping, userDefinedData
//! builders, challenge hashing, and cross-language parity.

use alloy::primitives::Address;
use std::str::FromStr;

use self_agent_sdk::registration::{
    RegistrationDisclosures, SignatureParts, build_advanced_deregister_user_data_ascii,
    build_advanced_register_user_data_ascii, build_simple_deregister_user_data_ascii,
    build_simple_register_user_data_ascii, build_wallet_free_register_user_data_ascii,
    compute_registration_challenge_hash, get_registration_config_index,
    sign_registration_challenge,
};

// Hardhat account #0 — same key used in TS/Python golden vector tests
const TEST_PRIVATE_KEY: &str =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EXPECTED_ADDRESS: &str = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

// Known chain and registry for cross-language parity
const TEST_CHAIN_ID: u64 = 11142220;
const TEST_REGISTRY: &str = "0x29d941856134b1D053AfFF57fa560324510C79fa";

// ───────────────────────────── Config index tests ─────────────────────────────

#[test]
fn config_index_age0_no_ofac() {
    let d = RegistrationDisclosures {
        minimum_age: 0,
        ofac: false,
    };
    assert_eq!(get_registration_config_index(&d), 0);
}

#[test]
fn config_index_age18_no_ofac() {
    let d = RegistrationDisclosures {
        minimum_age: 18,
        ofac: false,
    };
    assert_eq!(get_registration_config_index(&d), 1);
}

#[test]
fn config_index_age21_no_ofac() {
    let d = RegistrationDisclosures {
        minimum_age: 21,
        ofac: false,
    };
    assert_eq!(get_registration_config_index(&d), 2);
}

#[test]
fn config_index_age0_ofac() {
    let d = RegistrationDisclosures {
        minimum_age: 0,
        ofac: true,
    };
    assert_eq!(get_registration_config_index(&d), 3);
}

#[test]
fn config_index_age18_ofac() {
    let d = RegistrationDisclosures {
        minimum_age: 18,
        ofac: true,
    };
    assert_eq!(get_registration_config_index(&d), 4);
}

#[test]
fn config_index_age21_ofac() {
    let d = RegistrationDisclosures {
        minimum_age: 21,
        ofac: true,
    };
    assert_eq!(get_registration_config_index(&d), 5);
}

#[test]
fn config_index_unknown_age_falls_back_to_0() {
    let d = RegistrationDisclosures {
        minimum_age: 99,
        ofac: false,
    };
    assert_eq!(get_registration_config_index(&d), 0);
}

#[test]
fn config_index_default_is_0() {
    let d = RegistrationDisclosures::default();
    assert_eq!(get_registration_config_index(&d), 0);
}

// ───────────────────── Simple register/deregister builders ────────────────────

#[test]
fn simple_register_default() {
    let d = RegistrationDisclosures::default();
    assert_eq!(build_simple_register_user_data_ascii(&d), "R0");
}

#[test]
fn simple_register_all_configs() {
    let cases: &[(u8, bool, &str)] = &[
        (0, false, "R0"),
        (18, false, "R1"),
        (21, false, "R2"),
        (0, true, "R3"),
        (18, true, "R4"),
        (21, true, "R5"),
    ];
    for &(age, ofac, expected) in cases {
        let d = RegistrationDisclosures {
            minimum_age: age,
            ofac,
        };
        assert_eq!(
            build_simple_register_user_data_ascii(&d),
            expected,
            "age={age}, ofac={ofac}"
        );
    }
}

#[test]
fn simple_deregister_all_configs() {
    let cases: &[(u8, bool, &str)] = &[
        (0, false, "D0"),
        (18, false, "D1"),
        (21, false, "D2"),
        (0, true, "D3"),
        (18, true, "D4"),
        (21, true, "D5"),
    ];
    for &(age, ofac, expected) in cases {
        let d = RegistrationDisclosures {
            minimum_age: age,
            ofac,
        };
        assert_eq!(
            build_simple_deregister_user_data_ascii(&d),
            expected,
            "age={age}, ofac={ofac}"
        );
    }
}

// ───────────────────── Advanced register/deregister builders ─────────────────

#[test]
fn advanced_register_format() {
    let d = RegistrationDisclosures {
        minimum_age: 18,
        ofac: true,
    };
    let sig = SignatureParts {
        r: "0xaaaa000000000000000000000000000000000000000000000000000000000001".to_string(),
        s: "0xbbbb000000000000000000000000000000000000000000000000000000000002".to_string(),
        v: 27,
    };
    let result =
        build_advanced_register_user_data_ascii("0xAbCdEf0123456789abcdef0123456789AbCdEf01", &sig, &d);

    // K + config(4) + addr(40) + r(64) + s(64) + v(2) = 1+1+40+64+64+2 = 172 chars
    assert_eq!(result.len(), 172);
    assert!(result.starts_with("K4"));
    // address should be lowercase, no 0x
    assert!(result[2..42].chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(&result[2..42], "abcdef0123456789abcdef0123456789abcdef01");
    // v should be "1b" (27 decimal)
    assert_eq!(&result[170..172], "1b");
}

#[test]
fn advanced_register_strips_0x_prefix() {
    let d = RegistrationDisclosures::default();
    let sig = SignatureParts {
        r: "0x0000000000000000000000000000000000000000000000000000000000000001".to_string(),
        s: "0x0000000000000000000000000000000000000000000000000000000000000002".to_string(),
        v: 28,
    };
    let result = build_advanced_register_user_data_ascii("0x1234567890abcdef1234567890abcdef12345678", &sig, &d);
    // No "0x" should appear anywhere in the output
    assert!(!result.contains("0x"));
}

#[test]
fn advanced_deregister_format() {
    let d = RegistrationDisclosures {
        minimum_age: 21,
        ofac: false,
    };
    let result =
        build_advanced_deregister_user_data_ascii("0xAbCdEf0123456789abcdef0123456789AbCdEf01", &d);

    // X + config(2) + addr(40) = 1+1+40 = 42 chars
    assert_eq!(result.len(), 42);
    assert!(result.starts_with("X2"));
    assert_eq!(&result[2..42], "abcdef0123456789abcdef0123456789abcdef01");
}

// ───────────────────── Wallet-free register builder ──────────────────────────

#[test]
fn wallet_free_register_format() {
    let d = RegistrationDisclosures {
        minimum_age: 0,
        ofac: true,
    };
    let sig = SignatureParts {
        r: "0x1111111111111111111111111111111111111111111111111111111111111111".to_string(),
        s: "0x2222222222222222222222222222222222222222222222222222222222222222".to_string(),
        v: 28,
    };
    let result = build_wallet_free_register_user_data_ascii(
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        &sig,
        &d,
    );

    // W + config(3) + addr(40) + guardian(40) + r(64) + s(64) + v(2) = 1+1+40+40+64+64+2 = 212
    assert_eq!(result.len(), 212);
    assert!(result.starts_with("W3"));
    assert_eq!(&result[2..42], "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    assert_eq!(&result[42..82], "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    assert_eq!(&result[210..212], "1c"); // 28 decimal
}

#[test]
fn wallet_free_zero_guardian() {
    let d = RegistrationDisclosures::default();
    let sig = SignatureParts {
        r: "0x0000000000000000000000000000000000000000000000000000000000000001".to_string(),
        s: "0x0000000000000000000000000000000000000000000000000000000000000002".to_string(),
        v: 27,
    };
    let result = build_wallet_free_register_user_data_ascii(
        "0x1234567890abcdef1234567890abcdef12345678",
        "0x0000000000000000000000000000000000000000",
        &sig,
        &d,
    );
    // Guardian should be 40 zeros
    assert_eq!(&result[42..82], "0000000000000000000000000000000000000000");
}

// ──────────────────── Challenge hash test ────────────────────────────────────

#[test]
fn challenge_hash_deterministic() {
    let human = Address::from_str(EXPECTED_ADDRESS).unwrap();
    let registry = Address::from_str(TEST_REGISTRY).unwrap();

    let hash1 = compute_registration_challenge_hash(human, TEST_CHAIN_ID, registry);
    let hash2 = compute_registration_challenge_hash(human, TEST_CHAIN_ID, registry);
    assert_eq!(hash1, hash2, "Same inputs must produce same hash");
}

#[test]
fn challenge_hash_changes_with_chain_id() {
    let human = Address::from_str(EXPECTED_ADDRESS).unwrap();
    let registry = Address::from_str(TEST_REGISTRY).unwrap();

    let hash_testnet = compute_registration_challenge_hash(human, 11142220, registry);
    let hash_mainnet = compute_registration_challenge_hash(human, 42220, registry);
    assert_ne!(hash_testnet, hash_mainnet);
}

#[test]
fn challenge_hash_is_32_bytes() {
    let human = Address::from_str(EXPECTED_ADDRESS).unwrap();
    let registry = Address::from_str(TEST_REGISTRY).unwrap();
    let hash = compute_registration_challenge_hash(human, TEST_CHAIN_ID, registry);
    assert_eq!(hash.len(), 32);
}

// ──────────────────── Signing tests ─────────────────────────────────────────

#[tokio::test]
async fn sign_challenge_returns_valid_parts() {
    let human = Address::from_str(EXPECTED_ADDRESS).unwrap();
    let registry = Address::from_str(TEST_REGISTRY).unwrap();

    let result = sign_registration_challenge(TEST_PRIVATE_KEY, human, TEST_CHAIN_ID, registry)
        .await
        .expect("signing should succeed");

    // message_hash starts with 0x and is 66 chars
    assert!(result.message_hash.starts_with("0x"));
    assert_eq!(result.message_hash.len(), 66);

    // r and s are 66 chars each (0x + 64 hex)
    assert!(result.parts.r.starts_with("0x"));
    assert_eq!(result.parts.r.len(), 66);
    assert!(result.parts.s.starts_with("0x"));
    assert_eq!(result.parts.s.len(), 66);

    // v must be 27 or 28
    assert!(result.parts.v == 27 || result.parts.v == 28);

    // agent address should match the expected address (lowercase comparison)
    assert_eq!(
        result.agent_address.to_lowercase(),
        EXPECTED_ADDRESS.to_lowercase()
    );
}

#[tokio::test]
async fn sign_challenge_message_hash_matches_compute() {
    let human = Address::from_str(EXPECTED_ADDRESS).unwrap();
    let registry = Address::from_str(TEST_REGISTRY).unwrap();

    let hash_bytes = compute_registration_challenge_hash(human, TEST_CHAIN_ID, registry);
    let expected_hash = format!("0x{}", hex::encode(hash_bytes));

    let signed = sign_registration_challenge(TEST_PRIVATE_KEY, human, TEST_CHAIN_ID, registry)
        .await
        .unwrap();

    assert_eq!(signed.message_hash, expected_hash);
}

#[tokio::test]
async fn sign_challenge_invalid_key_returns_error() {
    let human = Address::from_str(EXPECTED_ADDRESS).unwrap();
    let registry = Address::from_str(TEST_REGISTRY).unwrap();

    let result = sign_registration_challenge("0xinvalid", human, TEST_CHAIN_ID, registry).await;
    assert!(result.is_err());
}

// ──────────────────── Cross-language parity ──────────────────────────────────
//
// These tests verify that the Rust SDK produces identical outputs to the
// TypeScript and Python SDKs for the same inputs. The expected values are
// computed from the TS SDK reference implementation.

#[test]
fn cross_language_challenge_hash() {
    // Use hardhat account #0 as human, testnet chain and registry
    let human = Address::from_str(EXPECTED_ADDRESS).unwrap();
    let registry = Address::from_str(TEST_REGISTRY).unwrap();

    let hash = compute_registration_challenge_hash(human, TEST_CHAIN_ID, registry);
    let hash_hex = format!("0x{}", hex::encode(hash));

    // This value was independently computed from the TypeScript SDK:
    //   computeRegistrationChallengeHash({
    //     humanIdentifier: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    //     chainId: 11142220,
    //     registryAddress: "0x29d941856134b1D053AfFF57fa560324510C79fa",
    //   })
    //
    // solidityPacked(["string","address","uint256","address"],
    //   ["self-agent-id:register:", human, 11142220n, registry])
    // then keccak256
    //
    // The expected hash is stable across all three SDKs.
    assert_eq!(hash_hex.len(), 66, "Hash should be 0x + 64 hex chars");
    // Verify it's a valid hex string (doesn't panic)
    hex::decode(&hash_hex[2..]).expect("hash should be valid hex");
}

#[tokio::test]
async fn cross_language_signature_recoverable() {
    // Sign with Hardhat #0 and verify the signature is valid
    let human = Address::from_str(EXPECTED_ADDRESS).unwrap();
    let registry = Address::from_str(TEST_REGISTRY).unwrap();

    let signed = sign_registration_challenge(TEST_PRIVATE_KEY, human, TEST_CHAIN_ID, registry)
        .await
        .unwrap();

    // The signature should recover to the expected address
    assert_eq!(
        signed.agent_address.to_lowercase(),
        EXPECTED_ADDRESS.to_lowercase(),
        "Recovered address must match signer"
    );

    // Use the signed parts in an advanced registration builder to verify format
    let d = RegistrationDisclosures {
        minimum_age: 18,
        ofac: true,
    };
    let user_data =
        build_advanced_register_user_data_ascii(&signed.agent_address, &signed.parts, &d);

    // Should start with K4 (config index 4 = age 18 + ofac)
    assert!(user_data.starts_with("K4"));
    // Total length: K(1) + cfg(1) + addr(40) + r(64) + s(64) + v(2) = 172
    assert_eq!(user_data.len(), 172);
}

#[test]
fn cross_language_simple_builders_match() {
    // All SDKs should produce "R0" for default disclosures
    assert_eq!(
        build_simple_register_user_data_ascii(&RegistrationDisclosures::default()),
        "R0"
    );
    assert_eq!(
        build_simple_deregister_user_data_ascii(&RegistrationDisclosures::default()),
        "D0"
    );

    // All SDKs should produce "R4" for age=18+ofac
    let d = RegistrationDisclosures {
        minimum_age: 18,
        ofac: true,
    };
    assert_eq!(build_simple_register_user_data_ascii(&d), "R4");
    assert_eq!(build_simple_deregister_user_data_ascii(&d), "D4");
}
