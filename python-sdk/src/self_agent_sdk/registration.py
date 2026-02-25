# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""Registration helper utilities shared by CLI and future SDK APIs."""
from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict

from eth_account import Account
from eth_account.messages import encode_defunct
from web3 import Web3


class RegistrationDisclosures(TypedDict, total=False):
    """Optional disclosure flags passed during registration.

    Attributes:
        minimumAge: Minimum age to verify (0, 18, or 21).
        ofac: Whether to require OFAC screening.
    """

    minimumAge: int
    ofac: bool


@dataclass(frozen=True)
class SignedRegistrationChallenge:
    """Result of signing a registration challenge with the agent's private key.

    Attributes:
        message_hash: Keccak-256 hash of the registration challenge message.
        signature: Full hex-encoded signature (r + s + v).
        r: The r component of the ECDSA signature (hex).
        s: The s component of the ECDSA signature (hex).
        v: The recovery identifier (27 or 28).
        agent_address: Checksummed Ethereum address of the signing agent.
    """

    message_hash: str
    signature: str
    r: str
    s: str
    v: int
    agent_address: str


def get_registration_config_index(disclosures: RegistrationDisclosures | None = None) -> int:
    """Map disclosure options to one of the six on-chain verification config indices.

    The six configs are:
        0 = no age / no OFAC, 1 = age 18, 2 = age 21,
        3 = OFAC only, 4 = age 18 + OFAC, 5 = age 21 + OFAC.

    Args:
        disclosures: Optional disclosure flags (minimumAge, ofac).

    Returns:
        Config index (0-5) for the SelfAgentRegistry contract.
    """
    d = disclosures or {}
    minimum_age = int(d.get("minimumAge", 0) or 0)
    ofac = bool(d.get("ofac", False))

    if minimum_age == 18 and ofac:
        return 4
    if minimum_age == 21 and ofac:
        return 5
    if minimum_age == 18:
        return 1
    if minimum_age == 21:
        return 2
    if ofac:
        return 3
    return 0


def _config_digit(disclosures: RegistrationDisclosures | None = None) -> str:
    """Return the config index as a single-character string digit.

    Args:
        disclosures: Optional disclosure flags.

    Returns:
        Single character '0' through '5'.

    Raises:
        ValueError: If the computed index is outside the valid range.
    """
    idx = get_registration_config_index(disclosures)
    if idx < 0 or idx > 5:
        raise ValueError(f"Invalid config index: {idx}")
    return str(idx)


def _normalize_address(address: str) -> str:
    """Convert an Ethereum address to its EIP-55 checksummed form.

    Args:
        address: Hex-encoded Ethereum address.

    Returns:
        Checksummed address string.
    """
    return Web3.to_checksum_address(address)


def compute_registration_challenge_hash(
    human_identifier: str,
    chain_id: int,
    registry_address: str,
) -> str:
    """Compute the Keccak-256 hash of the registration challenge message.

    The challenge is constructed using Solidity-style tight packing of the
    prefix string, human identifier address, chain ID, and registry address.

    Args:
        human_identifier: Checksummed Ethereum address of the human owner.
        chain_id: EVM chain ID (e.g., 42220 for Celo mainnet).
        registry_address: Checksummed address of the SelfAgentRegistry contract.

    Returns:
        Hex-encoded hash string prefixed with '0x'.
    """
    digest = Web3.solidity_keccak(
        ["string", "address", "uint256", "address"],
        [
            "self-agent-id:register:",
            _normalize_address(human_identifier),
            int(chain_id),
            _normalize_address(registry_address),
        ],
    )
    return "0x" + digest.hex()


def sign_registration_challenge(
    private_key: str,
    human_identifier: str,
    chain_id: int,
    registry_address: str,
) -> SignedRegistrationChallenge:
    """Sign a registration challenge with the agent's private key.

    Computes the challenge hash and produces an EIP-191 personal-sign
    signature, returning all components needed for on-chain verification.

    Args:
        private_key: Hex-encoded private key of the agent (with '0x' prefix).
        human_identifier: Checksummed Ethereum address of the human owner.
        chain_id: EVM chain ID.
        registry_address: Checksummed address of the SelfAgentRegistry contract.

    Returns:
        A SignedRegistrationChallenge containing the hash, signature components,
        and the agent's checksummed address.
    """
    acct = Account.from_key(private_key)
    message_hash = compute_registration_challenge_hash(
        human_identifier=human_identifier,
        chain_id=chain_id,
        registry_address=registry_address,
    )
    signable = encode_defunct(hexstr=message_hash)
    signed = acct.sign_message(signable)

    r = f"0x{signed.r:064x}"
    s = f"0x{signed.s:064x}"
    v = int(signed.v)
    if v in (0, 1):
        v += 27

    return SignedRegistrationChallenge(
        message_hash=message_hash,
        signature="0x" + signed.signature.hex(),
        r=r,
        s=s,
        v=v,
        agent_address=acct.address,
    )


def build_simple_register_user_data_ascii(
    disclosures: RegistrationDisclosures | None = None,
) -> str:
    """Build ASCII user-data for simple (verified-wallet) registration.

    Format: 'R' + config digit (e.g., 'R0', 'R4').

    Args:
        disclosures: Optional disclosure flags.

    Returns:
        Two-character ASCII string for the userDefinedData field.
    """
    return "R" + _config_digit(disclosures)


def build_simple_deregister_user_data_ascii(
    disclosures: RegistrationDisclosures | None = None,
) -> str:
    """Build ASCII user-data for simple (verified-wallet) deregistration.

    Format: 'D' + config digit (e.g., 'D0', 'D3').

    Args:
        disclosures: Optional disclosure flags.

    Returns:
        Two-character ASCII string for the userDefinedData field.
    """
    return "D" + _config_digit(disclosures)


def build_advanced_register_user_data_ascii(
    agent_address: str,
    signature_r: str,
    signature_s: str,
    signature_v: int,
    disclosures: RegistrationDisclosures | None = None,
) -> str:
    """Build ASCII user-data for advanced (agent-identity) registration.

    Format: 'K' + config digit + agent address (40 hex) + r (64 hex) +
    s (64 hex) + v (2 hex).

    Args:
        agent_address: Ethereum address of the agent being registered.
        signature_r: The r component of the ECDSA signature (hex).
        signature_s: The s component of the ECDSA signature (hex).
        signature_v: The recovery identifier (27 or 28).
        disclosures: Optional disclosure flags.

    Returns:
        ASCII-encoded user-data string.
    """
    cfg = _config_digit(disclosures)
    addr_hex = _normalize_address(agent_address)[2:].lower()
    r_hex = signature_r.replace("0x", "").lower()
    s_hex = signature_s.replace("0x", "").lower()
    v_hex = f"{int(signature_v):02x}"
    return "K" + cfg + addr_hex + r_hex + s_hex + v_hex


def build_advanced_deregister_user_data_ascii(
    agent_address: str,
    disclosures: RegistrationDisclosures | None = None,
) -> str:
    """Build ASCII user-data for advanced (agent-identity) deregistration.

    Format: 'X' + config digit + agent address (40 hex).

    Args:
        agent_address: Ethereum address of the agent being deregistered.
        disclosures: Optional disclosure flags.

    Returns:
        ASCII-encoded user-data string.
    """
    cfg = _config_digit(disclosures)
    addr_hex = _normalize_address(agent_address)[2:].lower()
    return "X" + cfg + addr_hex


def build_wallet_free_register_user_data_ascii(
    agent_address: str,
    signature_r: str,
    signature_s: str,
    signature_v: int,
    disclosures: RegistrationDisclosures | None = None,
    guardian_address: str | None = None,
) -> str:
    """Build ASCII user-data for wallet-free registration.

    Format: 'W' + config digit + agent address (40 hex) + guardian address
    (40 hex, zero-padded if absent) + r (64 hex) + s (64 hex) + v (2 hex).

    Args:
        agent_address: Ethereum address of the agent being registered.
        signature_r: The r component of the ECDSA signature (hex).
        signature_s: The s component of the ECDSA signature (hex).
        signature_v: The recovery identifier (27 or 28).
        disclosures: Optional disclosure flags.
        guardian_address: Optional guardian address. Defaults to zero address
            if not provided.

    Returns:
        ASCII-encoded user-data string.
    """
    cfg = _config_digit(disclosures)
    addr_hex = _normalize_address(agent_address)[2:].lower()
    guardian_hex = (
        _normalize_address(guardian_address)[2:].lower()
        if guardian_address
        else ("0" * 40)
    )
    r_hex = signature_r.replace("0x", "").lower()
    s_hex = signature_s.replace("0x", "").lower()
    v_hex = f"{int(signature_v):02x}"
    return "W" + cfg + addr_hex + guardian_hex + r_hex + s_hex + v_hex
