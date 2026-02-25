// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

//! Golden vector tests — values generated from the TS SDK to ensure
//! byte-identical cross-language compatibility.

use alloy::primitives::{keccak256, Address, B256};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::Signer;
use std::str::FromStr;

use self_agent_sdk::agent::{address_to_agent_key, SelfAgentConfig};
use self_agent_sdk::constants::headers;
use self_agent_sdk::SelfAgent;

const TEST_PRIVATE_KEY: &str =
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EXPECTED_ADDRESS: &str = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const EXPECTED_AGENT_KEY: &str =
    "0x000000000000000000000000f39fd6e51aad88f6f4ce6ab8827279cfffb92266";

// Golden vectors (generated from TS SDK with fixed inputs)
const TIMESTAMP: &str = "1700000000000";
const METHOD_POST: &str = "POST";
const METHOD_GET: &str = "GET";
const URL: &str = "/api/data";
const BODY: &str = r#"{"key":"value"}"#;

// WITH BODY (POST)
const EXPECTED_BODY_HASH: &str =
    "0xae4ac89b0ef637686c9372c26c0e09f3270282df8b4e6b987cc4b956fbd123d4";
const EXPECTED_MESSAGE_POST: &str =
    "0xb62fd2c22be6014875d86577506bcd19a737fabe771c7f6141510c5f5f8162c1";
const EXPECTED_SIG_POST: &str =
    "0xa831a5c3907cbeead61581895496189150b3c541dd5bb656e5028be3caa8459160eb27c5d0425ddaf0d878b872f4ae55f1d8d4d48628d11138df5e99b9692fd01b";

// EMPTY BODY (GET)
const EXPECTED_EMPTY_BODY_HASH: &str =
    "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470";
const EXPECTED_MESSAGE_GET: &str =
    "0x0f7ededcd210abba71a95b47f17fcfde159b2586c81f59a70b41622ba47bdceb";
const EXPECTED_SIG_GET: &str =
    "0x0ebb4a5233e3dd4b0cac966cf0f1d72829119dd6edc9a9a91657211a2eec848d522458e2347824c81610bde8a66c0e0fdb5c2a9642670df007321ea99d8695641b";

#[test]
fn derives_agent_key_from_address() {
    let signer: PrivateKeySigner = TEST_PRIVATE_KEY.parse().unwrap();
    let expected_addr = Address::from_str(EXPECTED_ADDRESS).unwrap();
    assert_eq!(signer.address(), expected_addr);

    let agent_key = address_to_agent_key(signer.address());
    let expected_key = B256::from_str(EXPECTED_AGENT_KEY).unwrap();
    assert_eq!(agent_key, expected_key);
}

#[test]
fn body_hash_matches_ts() {
    let hash = keccak256(BODY.as_bytes());
    assert_eq!(format!("{:#x}", hash), EXPECTED_BODY_HASH);
}

#[test]
fn empty_body_hash_matches_ts() {
    let hash = keccak256("".as_bytes());
    assert_eq!(format!("{:#x}", hash), EXPECTED_EMPTY_BODY_HASH);
}

#[test]
fn message_hash_with_body_matches_ts() {
    let body_hash = keccak256(BODY.as_bytes());
    let body_hash_hex = format!("{:#x}", body_hash);
    let concat = format!("{}{}{}{}", TIMESTAMP, METHOD_POST, URL, body_hash_hex);
    let message = keccak256(concat.as_bytes());
    assert_eq!(format!("{:#x}", message), EXPECTED_MESSAGE_POST);
}

#[test]
fn message_hash_empty_body_matches_ts() {
    let body_hash = keccak256("".as_bytes());
    let body_hash_hex = format!("{:#x}", body_hash);
    let concat = format!("{}{}{}{}", TIMESTAMP, METHOD_GET, URL, body_hash_hex);
    let message = keccak256(concat.as_bytes());
    assert_eq!(format!("{:#x}", message), EXPECTED_MESSAGE_GET);
}

#[tokio::test]
async fn signature_with_body_matches_ts() {
    let signer: PrivateKeySigner = TEST_PRIVATE_KEY.parse().unwrap();

    let body_hash = keccak256(BODY.as_bytes());
    let body_hash_hex = format!("{:#x}", body_hash);
    let concat = format!("{}{}{}{}", TIMESTAMP, METHOD_POST, URL, body_hash_hex);
    let message = keccak256(concat.as_bytes());

    let signature = signer.sign_message(message.as_ref()).await.unwrap();
    let sig_hex = format!("0x{}", hex::encode(signature.as_bytes()));
    assert_eq!(sig_hex, EXPECTED_SIG_POST);
}

#[tokio::test]
async fn signature_empty_body_matches_ts() {
    let signer: PrivateKeySigner = TEST_PRIVATE_KEY.parse().unwrap();

    let body_hash = keccak256("".as_bytes());
    let body_hash_hex = format!("{:#x}", body_hash);
    let concat = format!("{}{}{}{}", TIMESTAMP, METHOD_GET, URL, body_hash_hex);
    let message = keccak256(concat.as_bytes());

    let signature = signer.sign_message(message.as_ref()).await.unwrap();
    let sig_hex = format!("0x{}", hex::encode(signature.as_bytes()));
    assert_eq!(sig_hex, EXPECTED_SIG_GET);
}

#[tokio::test]
async fn sign_request_with_timestamp_matches_golden_vectors() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(Address::from_str("0x0000000000000000000000000000000000000001").unwrap()),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    // Test POST with body
    let hdrs = agent
        .sign_request_with_timestamp(METHOD_POST, URL, Some(BODY), TIMESTAMP)
        .await
        .unwrap();

    assert_eq!(
        hdrs.get(headers::ADDRESS).unwrap().to_lowercase(),
        EXPECTED_ADDRESS.to_lowercase()
    );
    assert_eq!(hdrs.get(headers::SIGNATURE).unwrap(), EXPECTED_SIG_POST);
    assert_eq!(hdrs.get(headers::TIMESTAMP).unwrap(), TIMESTAMP);

    // Test GET with empty body
    let hdrs = agent
        .sign_request_with_timestamp(METHOD_GET, URL, None, TIMESTAMP)
        .await
        .unwrap();

    assert_eq!(hdrs.get(headers::SIGNATURE).unwrap(), EXPECTED_SIG_GET);
}

#[tokio::test]
async fn different_bodies_produce_different_signatures() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(Address::from_str("0x0000000000000000000000000000000000000001").unwrap()),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    let hdrs1 = agent
        .sign_request_with_timestamp("POST", "/api", Some("body1"), TIMESTAMP)
        .await
        .unwrap();
    let hdrs2 = agent
        .sign_request_with_timestamp("POST", "/api", Some("body2"), TIMESTAMP)
        .await
        .unwrap();

    assert_ne!(
        hdrs1.get(headers::SIGNATURE).unwrap(),
        hdrs2.get(headers::SIGNATURE).unwrap()
    );
}

#[tokio::test]
async fn sign_request_returns_all_required_headers() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(Address::from_str("0x0000000000000000000000000000000000000001").unwrap()),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    let hdrs = agent.sign_request("GET", "/api/test", None).await.unwrap();

    assert!(hdrs.contains_key(headers::ADDRESS));
    assert!(hdrs.contains_key(headers::SIGNATURE));
    assert!(hdrs.contains_key(headers::TIMESTAMP));
}

#[tokio::test]
async fn full_url_and_path_signatures_match() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: TEST_PRIVATE_KEY.to_string(),
        network: None,
        registry_address: Some(
            Address::from_str("0x0000000000000000000000000000000000000001").unwrap(),
        ),
        rpc_url: Some("http://localhost:8545".to_string()),
    })
    .unwrap();

    let body = r#"{"q":"ok"}"#;
    let full = agent
        .sign_request_with_timestamp(
            "POST",
            "https://demo.example.com/api/data?x=1",
            Some(body),
            TIMESTAMP,
        )
        .await
        .unwrap();
    let path = agent
        .sign_request_with_timestamp("POST", "/api/data?x=1", Some(body), TIMESTAMP)
        .await
        .unwrap();

    assert_eq!(full.get(headers::SIGNATURE), path.get(headers::SIGNATURE));
}
