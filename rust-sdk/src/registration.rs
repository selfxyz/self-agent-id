// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

//! Registration helpers for building `userDefinedData` strings and signing
//! registration challenges.
//!
//! These functions produce the ASCII-encoded `userDefinedData` payloads that the
//! Self Protocol Hub V2 expects when registering or deregistering an agent.
//! They are used by the CLI binary and can also be called directly from
//! library consumers.

use alloy::primitives::{keccak256, Address, U256};
use alloy::signers::local::PrivateKeySigner;
use alloy::signers::Signer;
use alloy::sol_types::SolValue;
use serde::{Deserialize, Serialize};

/// Disclosure flags that map to one of 6 verification configurations on-chain.
///
/// | `minimum_age` | `ofac`  | Config index |
/// |---------------|---------|--------------|
/// | 0             | false   | 0            |
/// | 18            | false   | 1            |
/// | 21            | false   | 2            |
/// | 0             | true    | 3            |
/// | 18            | true    | 4            |
/// | 21            | true    | 5            |
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RegistrationDisclosures {
    pub minimum_age: u8,
    pub ofac: bool,
}

/// The r, s, v components of an ECDSA signature.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignatureParts {
    /// 0x-prefixed hex, 64 hex chars after prefix
    pub r: String,
    /// 0x-prefixed hex, 64 hex chars after prefix
    pub s: String,
    /// Recovery id — 27 or 28
    pub v: u64,
}

/// Result of signing a registration challenge.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignedRegistrationChallenge {
    /// 0x-prefixed keccak256 hash of the packed challenge
    pub message_hash: String,
    /// Signature components
    pub parts: SignatureParts,
    /// 0x-prefixed checksummed agent address derived from the signing key
    pub agent_address: String,
}

/// Map disclosure flags to a config index (0–5).
pub fn get_registration_config_index(disclosures: &RegistrationDisclosures) -> u8 {
    match (disclosures.minimum_age, disclosures.ofac) {
        (18, true) => 4,
        (21, true) => 5,
        (18, false) => 1,
        (21, false) => 2,
        (0, true) => 3,
        _ => 0,
    }
}

/// Compute the keccak256 hash of the registration challenge.
///
/// The challenge is `abi.encodePacked("self-agent-id:register:", humanIdentifier, chainId, registryAddress, nonce)`.
///
/// The `nonce` parameter is the agent's current registration nonce from `agentNonces(agent)`.
/// Use 0 for first-time registrations.
pub fn compute_registration_challenge_hash(
    human_identifier: Address,
    chain_id: u64,
    registry_address: Address,
    nonce: u64,
) -> [u8; 32] {
    let packed = (
        "self-agent-id:register:".to_string(),
        human_identifier,
        U256::from(chain_id),
        registry_address,
        U256::from(nonce),
    )
        .abi_encode_packed();
    keccak256(packed).into()
}

/// Sign the registration challenge with the agent's private key (EIP-191 personal sign).
///
/// Returns a [`SignedRegistrationChallenge`] containing the message hash,
/// signature components, and derived agent address.
///
/// The `nonce` parameter is the agent's current registration nonce from `agentNonces(agent)`.
/// Use 0 for first-time registrations.
pub async fn sign_registration_challenge(
    private_key: &str,
    human_identifier: Address,
    chain_id: u64,
    registry_address: Address,
    nonce: u64,
) -> Result<SignedRegistrationChallenge, crate::Error> {
    let signer: PrivateKeySigner = private_key
        .parse::<PrivateKeySigner>()
        .map_err(|_| crate::Error::InvalidPrivateKey)?;
    let hash = compute_registration_challenge_hash(human_identifier, chain_id, registry_address, nonce);
    let sig = signer
        .sign_message(&hash)
        .await
        .map_err(|e| crate::Error::SigningError(e.to_string()))?;
    let bytes = sig.as_bytes();
    if bytes.len() != 65 {
        return Err(crate::Error::InvalidSignature);
    }
    let mut v = bytes[64] as u64;
    if v == 0 || v == 1 {
        v += 27;
    }

    Ok(SignedRegistrationChallenge {
        message_hash: format!("0x{}", hex::encode(hash)),
        parts: SignatureParts {
            r: format!("0x{}", hex::encode(&bytes[0..32])),
            s: format!("0x{}", hex::encode(&bytes[32..64])),
            v,
        },
        agent_address: format!("{:#x}", signer.address()),
    })
}

/// Build `userDefinedData` for **simple (self-custody) registration**.
///
/// Format: `"R{config_index}"` — e.g. `"R0"`, `"R4"`.
pub fn build_simple_register_user_data_ascii(disclosures: &RegistrationDisclosures) -> String {
    format!("R{}", get_registration_config_index(disclosures))
}

/// Build `userDefinedData` for **simple (self-custody) deregistration**.
///
/// Format: `"D{config_index}"` — e.g. `"D0"`, `"D4"`.
pub fn build_simple_deregister_user_data_ascii(disclosures: &RegistrationDisclosures) -> String {
    format!("D{}", get_registration_config_index(disclosures))
}

/// Build `userDefinedData` for **advanced (linked) registration**.
///
/// Format: `"K{cfg}{addr40}{r64}{s64}{v2}"` where all hex is lowercase, no `0x` prefix.
pub fn build_advanced_register_user_data_ascii(
    agent_address: &str,
    sig: &SignatureParts,
    disclosures: &RegistrationDisclosures,
) -> String {
    let cfg = get_registration_config_index(disclosures);
    let addr_hex = agent_address.trim_start_matches("0x").to_lowercase();
    let r_hex = sig.r.trim_start_matches("0x").to_lowercase();
    let s_hex = sig.s.trim_start_matches("0x").to_lowercase();
    let v_hex = format!("{:02x}", sig.v);
    format!("K{cfg}{addr_hex}{r_hex}{s_hex}{v_hex}")
}

/// Build `userDefinedData` for **advanced (linked) deregistration**.
///
/// Format: `"X{cfg}{addr40}"`.
pub fn build_advanced_deregister_user_data_ascii(
    agent_address: &str,
    disclosures: &RegistrationDisclosures,
) -> String {
    let cfg = get_registration_config_index(disclosures);
    let addr_hex = agent_address.trim_start_matches("0x").to_lowercase();
    format!("X{cfg}{addr_hex}")
}

/// Build `userDefinedData` for **wallet-free registration** (agent-as-guardian).
///
/// Format: `"W{cfg}{addr40}{guardian40}{r64}{s64}{v2}"`.
pub fn build_wallet_free_register_user_data_ascii(
    agent_address: &str,
    guardian_address: &str,
    sig: &SignatureParts,
    disclosures: &RegistrationDisclosures,
) -> String {
    let cfg = get_registration_config_index(disclosures);
    let addr_hex = agent_address.trim_start_matches("0x").to_lowercase();
    let guardian_hex = guardian_address.trim_start_matches("0x").to_lowercase();
    let r_hex = sig.r.trim_start_matches("0x").to_lowercase();
    let s_hex = sig.s.trim_start_matches("0x").to_lowercase();
    let v_hex = format!("{:02x}", sig.v);
    format!("W{cfg}{addr_hex}{guardian_hex}{r_hex}{s_hex}{v_hex}")
}
