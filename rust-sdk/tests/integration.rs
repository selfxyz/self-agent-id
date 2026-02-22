//! Integration tests that hit the live Celo Sepolia testnet.
//!
//! Run with: cargo test --test integration -- --ignored
//! (These are #[ignore] by default to avoid CI failures from network issues.)

use alloy::primitives::{Address, U256};
use std::str::FromStr;

use self_agent_sdk::agent::{address_to_agent_key, SelfAgentConfig};
use self_agent_sdk::constants::headers;
use self_agent_sdk::verifier::VerifierConfig;
use self_agent_sdk::{NetworkName, SelfAgent, SelfAgentVerifier};

/// Demo agent on Celo Sepolia V4 registry.
const DEMO_AGENT_ADDRESS: &str = "0x83fa4380903fecb801F4e123835664973001ff00";
const DEMO_AGENT_ID: u64 = 5;

/// A random private key for testing (NOT the demo agent — we don't have its key).
const TEST_PRIVATE_KEY: &str =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// ---------------------------------------------------------------------------
// 1. On-chain read tests — verify we can talk to the live Celo Sepolia registry
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore] // requires network
async fn read_demo_agent_is_verified_on_chain() {
    // The demo agent IS registered, so isVerifiedAgent should return true
    let demo_addr = Address::from_str(DEMO_AGENT_ADDRESS).unwrap();
    let demo_key = address_to_agent_key(demo_addr);

    // Manually call the registry to check
    let provider = alloy::providers::ProviderBuilder::new().connect_http(
        "https://forno.celo-sepolia.celo-testnet.org"
            .parse()
            .unwrap(),
    );
    let registry_addr =
        Address::from_str("0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b").unwrap();

    use self_agent_sdk::constants::IAgentRegistry;
    let registry = IAgentRegistry::new(registry_addr, &provider);

    let is_verified: bool = registry
        .isVerifiedAgent(demo_key)
        .call()
        .await
        .expect("RPC call failed");
    assert!(is_verified, "Demo agent should be verified on-chain");

    let agent_id: U256 = registry
        .getAgentId(demo_key)
        .call()
        .await
        .expect("RPC call failed");
    assert_eq!(
        agent_id,
        U256::from(DEMO_AGENT_ID),
        "Demo agent should have ID 5"
    );

    println!("Demo agent verified on-chain: id={}", agent_id);
}

#[tokio::test]
#[ignore] // requires network
async fn get_info_for_unregistered_agent() {
    // The test private key is NOT registered on Celo Sepolia
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: Some(NetworkName::Testnet),
        registry_address: None,
        rpc_url: None,
    })
    .unwrap();

    let info = agent.get_info().await.expect("get_info RPC failed");
    assert_eq!(info.agent_id, U256::ZERO, "Unregistered agent should have ID 0");
    assert!(!info.is_verified, "Unregistered agent should not be verified");
    assert!(!agent.is_registered().await.expect("is_registered RPC failed"));

    println!(
        "Unregistered agent: address={:#x}, agent_key={:#x}",
        info.address, info.agent_key
    );
}

// ---------------------------------------------------------------------------
// 2. Sign → Verify roundtrip (pure crypto, no on-chain dependency)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn sign_then_verify_roundtrip_recovers_correct_address() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    let method = "POST";
    let url = "/api/data";
    let body = r#"{"hello":"world"}"#;

    // Agent signs the request
    let hdrs = agent
        .sign_request(method, url, Some(body))
        .await
        .unwrap();

    let signature = hdrs.get(headers::SIGNATURE).unwrap();
    let timestamp = hdrs.get(headers::TIMESTAMP).unwrap();
    let reported_address = hdrs.get(headers::ADDRESS).unwrap();

    // Verify the reported address matches the agent's actual address
    assert_eq!(
        reported_address.to_lowercase(),
        format!("{:#x}", agent.address()).to_lowercase()
    );

    // Now use the verifier to check the signature (it will fail on-chain,
    // but we can test that signature recovery works by checking the error message)
    let mut verifier = SelfAgentVerifier::new(VerifierConfig {
        network: None,
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
        max_age_ms: Some(60_000),
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
    });

    let result = verifier
        .verify(signature, timestamp, method, url, Some(body))
        .await;

    // The verify call will fail because localhost:8545 isn't running,
    // but we can verify the signature recovery worked by checking that
    // it got past steps 1-4 (timestamp, message, recovery, key derivation)
    // and failed on step 5 (on-chain check).
    //
    // If the signature was wrong, it would fail at step 3 with "Invalid signature".
    // If the timestamp was wrong, it would fail at step 1.
    // An RPC error at step 5 means steps 1-4 all passed.
    assert!(
        result.error.as_deref().unwrap_or("").contains("RPC error"),
        "Expected RPC error (steps 1-4 passed), got: {:?}",
        result.error
    );
    assert_eq!(
        result.agent_address,
        agent.address(),
        "Recovered address should match agent address"
    );
    assert_eq!(
        result.agent_key,
        agent.agent_key(),
        "Derived agent key should match"
    );

    println!("Roundtrip: agent signed, verifier recovered address correctly");
    println!("  Agent address: {:#x}", agent.address());
    println!("  Recovered:     {:#x}", result.agent_address);
    println!("  Agent key:     {:#x}", result.agent_key);
}

// ---------------------------------------------------------------------------
// 3. Sign → Verify full chain against live testnet (unregistered agent)
// ---------------------------------------------------------------------------

#[tokio::test]
#[ignore] // requires network
async fn sign_then_verify_full_chain_unregistered_agent() {
    // Create an agent pointing to real testnet
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: Some(NetworkName::Testnet),
        registry_address: None,
        rpc_url: None,
    })
    .unwrap();

    let method = "GET";
    let url = "/api/protected";
    let hdrs = agent.sign_request(method, url, None).await.unwrap();

    // Verifier against real testnet
    let mut verifier = SelfAgentVerifier::new(VerifierConfig {
        network: Some(NetworkName::Testnet),
        max_age_ms: Some(30_000),
        max_agents_per_human: Some(0), // disable sybil check
        require_self_provider: Some(false), // disable provider check
        ..VerifierConfig::default()
    });

    let result = verifier
        .verify(
            hdrs.get(headers::SIGNATURE).unwrap(),
            hdrs.get(headers::TIMESTAMP).unwrap(),
            method,
            url,
            None,
        )
        .await;

    // This agent is NOT registered, so verification should fail with "not verified"
    assert!(!result.valid);
    assert_eq!(
        result.error.as_deref(),
        Some("Agent not verified on-chain"),
        "Unregistered agent should fail on-chain check"
    );
    // But the recovered address should still be correct
    assert_eq!(result.agent_address, agent.address());
    assert_eq!(result.agent_key, agent.agent_key());

    println!("Full chain test passed (correctly rejected unregistered agent)");
    println!("  Recovered address: {:#x}", result.agent_address);
    println!("  Error: {:?}", result.error);
}

// ---------------------------------------------------------------------------
// 4. Timestamp expiry test
// ---------------------------------------------------------------------------

#[tokio::test]
async fn expired_timestamp_is_rejected() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    // Sign with a timestamp from 10 minutes ago
    let old_timestamp = (std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64
        - 10 * 60 * 1000)
        .to_string();

    let hdrs = agent
        .sign_request_with_timestamp("GET", "/api/test", None, &old_timestamp)
        .await
        .unwrap();

    let mut verifier = SelfAgentVerifier::new(VerifierConfig {
        max_age_ms: Some(5 * 60 * 1000), // 5 min window
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
        ..VerifierConfig::default()
    });

    let result = verifier
        .verify(
            hdrs.get(headers::SIGNATURE).unwrap(),
            hdrs.get(headers::TIMESTAMP).unwrap(),
            "GET",
            "/api/test",
            None,
        )
        .await;

    assert!(!result.valid);
    assert_eq!(
        result.error.as_deref(),
        Some("Timestamp expired or invalid")
    );

    println!("Expired timestamp correctly rejected");
}

// ---------------------------------------------------------------------------
// 5. Tampered body is rejected
// ---------------------------------------------------------------------------

#[tokio::test]
async fn tampered_body_fails_verification() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    let hdrs = agent
        .sign_request("POST", "/api/data", Some(r#"{"amount":100}"#))
        .await
        .unwrap();

    let mut verifier = SelfAgentVerifier::new(VerifierConfig {
        max_age_ms: Some(60_000),
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
        ..VerifierConfig::default()
    });

    // Verify with DIFFERENT body (attacker changed amount)
    let result = verifier
        .verify(
            hdrs.get(headers::SIGNATURE).unwrap(),
            hdrs.get(headers::TIMESTAMP).unwrap(),
            "POST",
            "/api/data",
            Some(r#"{"amount":999}"#), // tampered!
        )
        .await;

    // The recovered address won't match the agent because the message is different.
    // This means it will recover a DIFFERENT address and the on-chain check will fail.
    // The key thing is: result.agent_address != agent.address()
    assert_ne!(
        result.agent_address,
        agent.address(),
        "Tampered body should recover a different address"
    );

    println!("Tampered body correctly produces wrong recovery (integrity check works)");
    println!("  Expected: {:#x}", agent.address());
    println!("  Recovered: {:#x}", result.agent_address);
}

// ---------------------------------------------------------------------------
// 6. Replay detection
// ---------------------------------------------------------------------------

#[tokio::test]
async fn replayed_signature_is_rejected() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    let hdrs = agent
        .sign_request("GET", "/api/replay", None)
        .await
        .unwrap();

    let sig = hdrs.get(headers::SIGNATURE).unwrap().to_string();
    let ts = hdrs.get(headers::TIMESTAMP).unwrap().to_string();

    let mut verifier = SelfAgentVerifier::new(VerifierConfig {
        max_age_ms: Some(60_000),
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
        ..VerifierConfig::default()
    });

    let first = verifier.verify(&sig, &ts, "GET", "/api/replay", None).await;
    assert!(
        first.error.as_deref().unwrap_or("").contains("RPC error"),
        "first verification should reach RPC path"
    );

    let second = verifier.verify(&sig, &ts, "GET", "/api/replay", None).await;
    assert_eq!(second.error.as_deref(), Some("Replay detected"));
}

#[tokio::test]
async fn invalid_message_does_not_poison_replay_cache() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    let hdrs = agent
        .sign_request("POST", "/api/replay", Some(r#"{"amount":100}"#))
        .await
        .unwrap();

    let sig = hdrs.get(headers::SIGNATURE).unwrap().to_string();
    let ts = hdrs.get(headers::TIMESTAMP).unwrap().to_string();

    let mut verifier = SelfAgentVerifier::new(VerifierConfig {
        max_age_ms: Some(60_000),
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
        ..VerifierConfig::default()
    });

    // Wrong body => different signing message, should not consume replay key for legit message.
    let tampered = verifier
        .verify(
            &sig,
            &ts,
            "POST",
            "/api/replay",
            Some(r#"{"amount":999}"#),
        )
        .await;
    assert!(
        !tampered.error.as_deref().unwrap_or("").contains("Replay detected"),
        "tampered message must not trigger replay key for legit message"
    );

    // Correct body should still proceed (and reach RPC path in this test setup).
    let legit = verifier
        .verify(
            &sig,
            &ts,
            "POST",
            "/api/replay",
            Some(r#"{"amount":100}"#),
        )
        .await;
    assert!(
        legit.error.as_deref().unwrap_or("").contains("RPC error"),
        "expected RPC error after successful signature/replay checks, got {:?}",
        legit.error
    );
}

// ---------------------------------------------------------------------------
// 6. Cross-language compatibility: Rust sign → values match TS verify expectations
// ---------------------------------------------------------------------------

#[tokio::test]
async fn cross_language_sign_verify_with_golden_vectors() {
    // This test proves that a Rust agent's signature can be verified by the TS verifier.
    // We use the golden vector inputs and verify the output matches exactly.
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    // Use fixed timestamp matching TS golden vectors
    let timestamp = "1700000000000";
    let method = "POST";
    let url = "/api/data";
    let body = r#"{"key":"value"}"#;

    let hdrs = agent
        .sign_request_with_timestamp(method, url, Some(body), timestamp)
        .await
        .unwrap();

    // These are the EXACT values the TS verifier expects
    let expected_sig = "0xa831a5c3907cbeead61581895496189150b3c541dd5bb656e5028be3caa8459160eb27c5d0425ddaf0d878b872f4ae55f1d8d4d48628d11138df5e99b9692fd01b";

    assert_eq!(
        hdrs.get(headers::SIGNATURE).unwrap(),
        expected_sig,
        "Rust signature must match TS golden vector exactly"
    );
    assert_eq!(hdrs.get(headers::TIMESTAMP).unwrap(), timestamp);

    // Now verify Rust verifier can also verify this signature
    // (proves Rust→Rust and by extension TS→Rust since the message construction is identical)
    let mut verifier = SelfAgentVerifier::new(VerifierConfig {
        max_age_ms: Some(u64::MAX), // don't expire for this test
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
        ..VerifierConfig::default()
    });

    let result = verifier
        .verify(expected_sig, timestamp, method, url, Some(body))
        .await;

    // Recovery should give us the correct address (steps 1-4 pass, fails on RPC)
    assert_eq!(
        result.agent_address,
        agent.address(),
        "Verifier must recover the correct agent address from the golden signature"
    );
    assert_eq!(result.agent_key, agent.agent_key());

    println!("Cross-language compatibility confirmed:");
    println!("  Rust signature matches TS golden vector");
    println!("  Rust verifier recovers correct address from golden signature");
}
