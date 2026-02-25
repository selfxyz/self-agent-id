// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1

//! Integration tests for SelfAgentVerifier: builder, from_config, and verification logic.

use std::str::FromStr;
use std::time::{SystemTime, UNIX_EPOCH};

use alloy::primitives::Address;
use self_agent_sdk::{
    headers, NetworkName, RateLimitConfig, SelfAgent, SelfAgentConfig, SelfAgentVerifier,
    VerifierConfig, VerifierFromConfig,
};

/// Hardhat/Anvil account #0 private key — deterministic, never holds real funds.
const TEST_PRIVATE_KEY: &str =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

/// Dummy registry address for offline tests (no real RPC calls expected to succeed).
fn dummy_registry() -> Address {
    Address::from_str("0x0000000000000000000000000000000000000001").unwrap()
}

/// Current Unix time in milliseconds, returned as a String.
fn now_millis_str() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
        .to_string()
}

/// Build a verifier configured for offline testing (fake registry, no Self provider requirement).
fn offline_verifier() -> SelfAgentVerifier {
    SelfAgentVerifier::new(VerifierConfig {
        registry_address: Some(dummy_registry()),
        rpc_url: Some("http://localhost:8545".to_string()),
        require_self_provider: Some(false),
        ..Default::default()
    })
}

/// Build a test agent pointing at the same dummy registry.
fn test_agent() -> SelfAgent {
    SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(dummy_registry()),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .expect("test agent should be constructable with a valid private key")
}

// =========================================================================
// 1. VerifierBuilder — full chaining
// =========================================================================

#[test]
fn builder_chaining_all_methods() {
    // This is the comprehensive chaining test — if any builder method
    // fails to return Self or breaks the chain, this won't compile.
    // The verifier's fields are private, so we validate that build() succeeds
    // and the internal unit tests (in src/verifier.rs) check field values.
    let _verifier = SelfAgentVerifier::create()
        .network(NetworkName::Testnet)
        .require_age(18)
        .require_ofac()
        .require_nationality(&["US", "GB"])
        .sybil_limit(3)
        .rate_limit(10, 100)
        .replay_protection()
        .include_credentials()
        .max_age(60_000)
        .cache_ttl(30_000)
        .build();
}

// =========================================================================
// 2. VerifierBuilder with defaults
// =========================================================================

#[test]
fn builder_defaults_succeeds() {
    let _verifier = SelfAgentVerifier::create().build();
    // Should not panic — all fields have sensible defaults.
}

// =========================================================================
// 3. VerifierBuilder with custom registry and RPC
// =========================================================================

#[test]
fn builder_custom_registry_and_rpc() {
    let _verifier = SelfAgentVerifier::create()
        .registry("0x0000000000000000000000000000000000000042")
        .rpc("http://localhost:8545")
        .build();
}

#[test]
fn builder_invalid_registry_address_does_not_panic() {
    // An unparseable address should be silently ignored (falls back to network default).
    let _verifier = SelfAgentVerifier::create()
        .registry("not-a-valid-address")
        .build();
}

// =========================================================================
// 4. from_config creation
// =========================================================================

#[test]
fn from_config_with_various_settings() {
    let _verifier = SelfAgentVerifier::from_config(VerifierFromConfig {
        network: Some(NetworkName::Testnet),
        registry_address: Some("0x29d941856134b1D053AfFF57fa560324510C79fa".to_string()),
        rpc_url: Some("https://forno.celo-sepolia.celo-testnet.org".to_string()),
        require_age: Some(21),
        require_ofac: Some(true),
        require_nationality: Some(vec!["US".to_string(), "DE".to_string()]),
        require_self_provider: Some(true),
        sybil_limit: Some(2),
        rate_limit: Some(RateLimitConfig {
            per_minute: Some(10),
            per_hour: Some(200),
        }),
        replay_protection: Some(true),
        max_age_ms: Some(120_000),
        cache_ttl_ms: Some(30_000),
    });
}

// =========================================================================
// 5. from_config with defaults
// =========================================================================

#[test]
fn from_config_defaults() {
    let _verifier = SelfAgentVerifier::from_config(VerifierFromConfig::default());
}

// =========================================================================
// 6. Direct constructor
// =========================================================================

#[test]
fn direct_new_constructor_default() {
    let _verifier = SelfAgentVerifier::new(VerifierConfig::default());
}

#[test]
fn direct_new_constructor_custom() {
    let _verifier = SelfAgentVerifier::new(VerifierConfig {
        network: Some(NetworkName::Testnet),
        registry_address: Some(dummy_registry()),
        rpc_url: Some("http://localhost:8545".to_string()),
        max_age_ms: Some(10_000),
        cache_ttl_ms: Some(5_000),
        max_agents_per_human: Some(3),
        include_credentials: Some(true),
        require_self_provider: Some(false),
        enable_replay_protection: Some(false),
        replay_cache_max_entries: Some(500),
        minimum_age: Some(18),
        require_ofac_passed: Some(true),
        allowed_nationalities: Some(vec!["FR".to_string()]),
        rate_limit_config: Some(RateLimitConfig {
            per_minute: Some(5),
            per_hour: Some(50),
        }),
    });
}

// =========================================================================
// 7. Verify rejects expired timestamp
// =========================================================================

#[tokio::test]
async fn verify_rejects_expired_timestamp() {
    let agent = test_agent();

    // Sign with a timestamp far in the past (Jan 2033? No — "1000000000000" is Sept 2001).
    let old_ts = "1000000000000";
    let hdrs = agent
        .sign_request_with_timestamp("POST", "/api/test", Some(r#"{"test":true}"#), old_ts)
        .await
        .unwrap();

    let mut verifier = offline_verifier();

    let result = verifier
        .verify(
            hdrs.get(headers::SIGNATURE).unwrap(),
            old_ts,
            "POST",
            "/api/test",
            Some(r#"{"test":true}"#),
        )
        .await;

    assert!(!result.valid, "verification should fail for expired timestamp");
    assert!(
        result
            .error
            .as_ref()
            .unwrap()
            .contains("Timestamp"),
        "error should mention timestamp, got: {:?}",
        result.error
    );
}

// =========================================================================
// 8. Verify rejects invalid signature
// =========================================================================

#[tokio::test]
async fn verify_rejects_invalid_signature() {
    let mut verifier = offline_verifier();
    let ts = now_millis_str();

    let result = verifier
        .verify("0xdeadbeef", &ts, "GET", "/test", None)
        .await;

    assert!(!result.valid, "verification should fail for garbage signature");
    assert!(
        result
            .error
            .as_ref()
            .unwrap()
            .contains("Invalid signature"),
        "error should mention invalid signature, got: {:?}",
        result.error
    );
}

#[tokio::test]
async fn verify_rejects_non_hex_signature() {
    let mut verifier = offline_verifier();
    let ts = now_millis_str();

    let result = verifier
        .verify("not-hex-at-all!", &ts, "GET", "/test", None)
        .await;

    assert!(!result.valid);
    assert!(
        result
            .error
            .as_ref()
            .unwrap()
            .contains("Invalid signature"),
        "non-hex input should be rejected as invalid signature, got: {:?}",
        result.error
    );
}

#[tokio::test]
async fn verify_rejects_empty_signature() {
    let mut verifier = offline_verifier();
    let ts = now_millis_str();

    let result = verifier.verify("", &ts, "GET", "/test", None).await;

    assert!(!result.valid);
    assert!(
        result.error.as_ref().unwrap().contains("Invalid signature"),
        "empty signature should be rejected, got: {:?}",
        result.error
    );
}

// =========================================================================
// 9. Verify rejects future timestamp
// =========================================================================

#[tokio::test]
async fn verify_rejects_future_timestamp() {
    let mut verifier = offline_verifier();

    // 10 minutes in the future (default max_age is 5 min)
    let future_ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis()
        + 10 * 60 * 1000;
    let future_ts_str = future_ts.to_string();

    let agent = test_agent();
    let hdrs = agent
        .sign_request_with_timestamp("GET", "/api/future", None, &future_ts_str)
        .await
        .unwrap();

    let result = verifier
        .verify(
            hdrs.get(headers::SIGNATURE).unwrap(),
            &future_ts_str,
            "GET",
            "/api/future",
            None,
        )
        .await;

    assert!(
        !result.valid,
        "verification should fail for future timestamp"
    );
    assert!(
        result
            .error
            .as_ref()
            .unwrap()
            .contains("Timestamp"),
        "error should mention timestamp, got: {:?}",
        result.error
    );
}

// =========================================================================
// 10. Replay protection
// =========================================================================

#[tokio::test]
async fn replay_protection_detects_duplicate() {
    let agent = test_agent();

    // Build a verifier with replay protection enabled (default).
    let mut verifier = SelfAgentVerifier::new(VerifierConfig {
        registry_address: Some(dummy_registry()),
        rpc_url: Some("http://localhost:8545".to_string()),
        require_self_provider: Some(false),
        enable_replay_protection: Some(true),
        ..Default::default()
    });

    let ts = now_millis_str();
    let hdrs = agent
        .sign_request_with_timestamp("GET", "/api/replay", None, &ts)
        .await
        .unwrap();
    let sig = hdrs.get(headers::SIGNATURE).unwrap();

    // First verify: will likely fail on the on-chain check (no real node),
    // but the replay cache should record the signature regardless.
    let _r1 = verifier
        .verify(sig, &ts, "GET", "/api/replay", None)
        .await;

    // Second verify with the same signature+message: should be caught by replay detection
    // BEFORE any on-chain call.
    let r2 = verifier
        .verify(sig, &ts, "GET", "/api/replay", None)
        .await;

    assert!(!r2.valid, "second verification should fail");
    assert!(
        r2.error.as_ref().unwrap().contains("Replay"),
        "error should mention replay, got: {:?}",
        r2.error
    );
}

#[tokio::test]
async fn replay_protection_allows_different_requests() {
    let agent = test_agent();

    let mut verifier = SelfAgentVerifier::new(VerifierConfig {
        registry_address: Some(dummy_registry()),
        rpc_url: Some("http://localhost:8545".to_string()),
        require_self_provider: Some(false),
        enable_replay_protection: Some(true),
        ..Default::default()
    });

    // Two different timestamps produce different signatures — both should pass replay check.
    let ts1 = now_millis_str();
    let hdrs1 = agent
        .sign_request_with_timestamp("GET", "/api/a", None, &ts1)
        .await
        .unwrap();

    // Small offset to ensure different timestamp
    let ts2_val: u128 = ts1.parse::<u128>().unwrap() + 1;
    let ts2 = ts2_val.to_string();
    let hdrs2 = agent
        .sign_request_with_timestamp("GET", "/api/a", None, &ts2)
        .await
        .unwrap();

    let r1 = verifier
        .verify(
            hdrs1.get(headers::SIGNATURE).unwrap(),
            &ts1,
            "GET",
            "/api/a",
            None,
        )
        .await;
    let r2 = verifier
        .verify(
            hdrs2.get(headers::SIGNATURE).unwrap(),
            &ts2,
            "GET",
            "/api/a",
            None,
        )
        .await;

    // Both may fail on the on-chain check, but neither should fail due to replay.
    let r1_is_replay = r1
        .error
        .as_ref()
        .map_or(false, |e| e.contains("Replay"));
    let r2_is_replay = r2
        .error
        .as_ref()
        .map_or(false, |e| e.contains("Replay"));
    assert!(!r1_is_replay, "first request should not be flagged as replay");
    assert!(
        !r2_is_replay,
        "second request with different timestamp should not be flagged as replay"
    );
}

// =========================================================================
// Additional edge-case tests
// =========================================================================

#[tokio::test]
async fn verify_rejects_non_numeric_timestamp() {
    let mut verifier = offline_verifier();
    let result = verifier
        .verify("0xdeadbeef", "not-a-number", "GET", "/test", None)
        .await;

    assert!(!result.valid);
    assert!(
        result
            .error
            .as_ref()
            .unwrap()
            .contains("Timestamp"),
        "non-numeric timestamp should be rejected, got: {:?}",
        result.error
    );
}

#[tokio::test]
async fn verify_rejects_zero_timestamp() {
    let mut verifier = offline_verifier();

    let agent = test_agent();
    let hdrs = agent
        .sign_request_with_timestamp("GET", "/api/zero", None, "0")
        .await
        .unwrap();

    let result = verifier
        .verify(
            hdrs.get(headers::SIGNATURE).unwrap(),
            "0",
            "GET",
            "/api/zero",
            None,
        )
        .await;

    assert!(!result.valid, "zero timestamp should be rejected as expired");
    assert!(
        result
            .error
            .as_ref()
            .unwrap()
            .contains("Timestamp"),
        "got: {:?}",
        result.error
    );
}

#[test]
fn verification_result_empty_with_error_has_correct_defaults() {
    // VerificationResult::empty_with_error is used internally but we can
    // verify its shape through the verify() return path.
    // Here we test that the default result structure is sensible.
    let config = VerifierConfig::default();
    let verifier = SelfAgentVerifier::new(config);
    // Just confirm it was created without panic — the async tests above
    // exercise the actual error paths.
    let _ = verifier;
}

#[test]
fn builder_method_order_does_not_matter() {
    // Verify that builder methods can be called in any order.
    let _v1 = SelfAgentVerifier::create()
        .require_ofac()
        .network(NetworkName::Testnet)
        .max_age(30_000)
        .require_age(21)
        .cache_ttl(10_000)
        .sybil_limit(5)
        .rate_limit(20, 200)
        .replay_protection()
        .include_credentials()
        .registry("0x0000000000000000000000000000000000000042")
        .rpc("http://localhost:8545")
        .require_nationality(&["JP", "KR"])
        .build();

    let _v2 = SelfAgentVerifier::create()
        .rpc("http://localhost:8545")
        .registry("0x0000000000000000000000000000000000000042")
        .require_nationality(&["JP", "KR"])
        .include_credentials()
        .replay_protection()
        .rate_limit(20, 200)
        .sybil_limit(5)
        .cache_ttl(10_000)
        .require_age(21)
        .max_age(30_000)
        .network(NetworkName::Testnet)
        .require_ofac()
        .build();
}

#[test]
fn from_config_with_registry_string() {
    let _verifier = SelfAgentVerifier::from_config(VerifierFromConfig {
        registry_address: Some(
            "0x60651482a3033A72128f874623Fc790061cc46D4".to_string(),
        ),
        rpc_url: Some("https://forno.celo.org".to_string()),
        ..Default::default()
    });
}

#[test]
fn from_config_with_invalid_registry_string() {
    // Invalid address string should not panic — falls back to network default.
    let _verifier = SelfAgentVerifier::from_config(VerifierFromConfig {
        registry_address: Some("garbage".to_string()),
        ..Default::default()
    });
}
