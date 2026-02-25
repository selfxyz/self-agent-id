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
    minimumAge: int
    ofac: bool


@dataclass(frozen=True)
class SignedRegistrationChallenge:
    message_hash: str
    signature: str
    r: str
    s: str
    v: int
    agent_address: str


def get_registration_config_index(disclosures: RegistrationDisclosures | None = None) -> int:
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
    idx = get_registration_config_index(disclosures)
    if idx < 0 or idx > 5:
        raise ValueError(f"Invalid config index: {idx}")
    return str(idx)


def _normalize_address(address: str) -> str:
    return Web3.to_checksum_address(address)


def compute_registration_challenge_hash(
    human_identifier: str,
    chain_id: int,
    registry_address: str,
) -> str:
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
    return "R" + _config_digit(disclosures)


def build_simple_deregister_user_data_ascii(
    disclosures: RegistrationDisclosures | None = None,
) -> str:
    return "D" + _config_digit(disclosures)


def build_advanced_register_user_data_ascii(
    agent_address: str,
    signature_r: str,
    signature_s: str,
    signature_v: int,
    disclosures: RegistrationDisclosures | None = None,
) -> str:
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
