# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import time

import pytest
from unittest.mock import MagicMock, patch
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from web3 import Web3

from self_agent_sdk import Ed25519Agent, SelfAgentVerifier
from self_agent_sdk._signing import compute_body_hash, compute_message
from self_agent_sdk.constants import HEADERS

# Deterministic 32-byte test key (same as the TS tests)
TEST_KEY_HEX = "aa" * 32

# Derive expected public key for assertions
_priv = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(TEST_KEY_HEX))
_pub_bytes = _priv.public_key().public_bytes_raw()
EXPECTED_PUBKEY_HEX = "0x" + _pub_bytes.hex()
EXPECTED_ADDRESS = Web3.to_checksum_address("0x" + Web3.keccak(_pub_bytes)[-20:].hex())


@pytest.fixture
def mock_web3():
    """Patch Web3 to avoid real RPC calls for Ed25519Agent."""
    with patch("self_agent_sdk.ed25519_agent.Web3") as MockWeb3:
        instance = MagicMock()
        MockWeb3.return_value = instance
        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.to_checksum_address = Web3.to_checksum_address
        MockWeb3.keccak = Web3.keccak
        instance.eth.contract.return_value = MagicMock()
        yield MockWeb3, instance


@pytest.fixture
def mock_verifier_web3():
    """Patch Web3 in the verifier module."""
    with patch("self_agent_sdk.verifier.Web3") as MockWeb3:
        instance = MagicMock()
        MockWeb3.return_value = instance
        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.to_checksum_address = Web3.to_checksum_address
        MockWeb3.keccak = Web3.keccak
        registry = MagicMock()
        instance.eth.contract.return_value = registry
        yield MockWeb3, instance, registry


# ---------------------------------------------------------------------------
# Ed25519Agent construction tests
# ---------------------------------------------------------------------------

def test_construct_from_hex_without_prefix(mock_web3):
    agent = Ed25519Agent(private_key=TEST_KEY_HEX, network="testnet")
    assert agent.agent_key.startswith("0x")
    assert len(agent.agent_key) == 66  # 0x + 64 hex chars = 32 bytes


def test_construct_from_hex_with_prefix(mock_web3):
    agent = Ed25519Agent(private_key="0x" + TEST_KEY_HEX, network="testnet")
    assert agent.agent_key.startswith("0x")
    assert len(agent.agent_key) == 66


def test_derive_correct_public_key(mock_web3):
    agent = Ed25519Agent(private_key=TEST_KEY_HEX, network="testnet")
    assert agent.agent_key == EXPECTED_PUBKEY_HEX


def test_derive_deterministic_address(mock_web3):
    agent = Ed25519Agent(private_key=TEST_KEY_HEX, network="testnet")
    assert agent.address == EXPECTED_ADDRESS


def test_reject_invalid_key_length(mock_web3):
    with pytest.raises(ValueError, match="32 bytes"):
        Ed25519Agent(private_key="0xdead", network="testnet")


def test_derive_address_static_method_matches_instance(mock_web3):
    agent = Ed25519Agent(private_key=TEST_KEY_HEX, network="testnet")
    static_addr = Ed25519Agent.derive_address(_pub_bytes)
    assert static_addr == agent.address


def test_derive_address_accepts_hex_string():
    from_bytes = Ed25519Agent.derive_address(_pub_bytes)
    from_hex = Ed25519Agent.derive_address(EXPECTED_PUBKEY_HEX)
    assert from_bytes == from_hex


# ---------------------------------------------------------------------------
# Signing tests
# ---------------------------------------------------------------------------

def test_sign_request_produces_required_headers(mock_web3):
    agent = Ed25519Agent(private_key=TEST_KEY_HEX, network="testnet")
    headers = agent.sign_request("GET", "https://example.com/api")

    assert HEADERS["KEY"] in headers
    assert HEADERS["KEYTYPE"] in headers
    assert HEADERS["SIGNATURE"] in headers
    assert HEADERS["TIMESTAMP"] in headers
    assert headers[HEADERS["KEYTYPE"]] == "ed25519"
    assert headers[HEADERS["KEY"]] == agent.agent_key


def test_sign_request_signature_is_valid(mock_web3):
    agent = Ed25519Agent(private_key=TEST_KEY_HEX, network="testnet")
    headers = agent.sign_request("GET", "https://example.com/api")

    # Reconstruct the message
    ts = headers[HEADERS["TIMESTAMP"]]
    body_hash = compute_body_hash(None)
    message = compute_message(ts, "GET", "https://example.com/api", body_hash)

    # Verify the Ed25519 signature
    sig_bytes = bytes.fromhex(headers[HEADERS["SIGNATURE"]].removeprefix("0x"))
    pub = Ed25519PublicKey.from_public_bytes(_pub_bytes)
    # Should not raise
    pub.verify(sig_bytes, message)


def test_sign_request_post_with_body(mock_web3):
    agent = Ed25519Agent(private_key=TEST_KEY_HEX, network="testnet")
    body = '{"hello":"world"}'
    headers = agent.sign_request("POST", "https://example.com/api", body)

    ts = headers[HEADERS["TIMESTAMP"]]
    body_hash = compute_body_hash(body)
    message = compute_message(ts, "POST", "https://example.com/api", body_hash)

    sig_bytes = bytes.fromhex(headers[HEADERS["SIGNATURE"]].removeprefix("0x"))
    pub = Ed25519PublicKey.from_public_bytes(_pub_bytes)
    pub.verify(sig_bytes, message)


# ---------------------------------------------------------------------------
# On-chain query tests (mocked)
# ---------------------------------------------------------------------------

def test_is_registered_calls_contract(mock_web3):
    agent = Ed25519Agent(private_key=TEST_KEY_HEX, network="testnet")
    agent._registry.functions.isVerifiedAgent.return_value.call.return_value = True
    assert agent.is_registered() is True


def test_get_info_unregistered(mock_web3):
    agent = Ed25519Agent(private_key=TEST_KEY_HEX, network="testnet")
    agent._registry.functions.getAgentId.return_value.call.return_value = 0
    info = agent.get_info()
    assert info.agent_id == 0
    assert info.is_verified is False


# ---------------------------------------------------------------------------
# Verifier Ed25519 path tests
# ---------------------------------------------------------------------------

PROVIDER_ADDR = "0x1234567890abcdef1234567890abcdef12345678"


def _setup_verified(registry):
    """Set up mock for a verified agent."""
    registry.functions.isVerifiedAgent.return_value.call.return_value = True
    registry.functions.isProofFresh.return_value.call.return_value = True
    registry.functions.proofExpiresAt.return_value.call.return_value = int(time.time()) + 86400 * 365
    registry.functions.getAgentId.return_value.call.return_value = 5
    registry.functions.getHumanNullifier.return_value.call.return_value = 42
    registry.functions.getAgentCountForHuman.return_value.call.return_value = 1
    registry.functions.getProofProvider.return_value.call.return_value = PROVIDER_ADDR
    registry.functions.selfProofProvider.return_value.call.return_value = PROVIDER_ADDR


def _make_ed25519_signature(method: str, url: str, body: str | None = None):
    """Create real Ed25519 signed headers for testing."""
    priv = Ed25519PrivateKey.from_private_bytes(bytes.fromhex(TEST_KEY_HEX))
    pub_bytes = priv.public_key().public_bytes_raw()
    agent_key = "0x" + pub_bytes.hex()

    ts = str(int(time.time() * 1000))
    body_hash = compute_body_hash(body)
    message = compute_message(ts, method, url, body_hash)
    sig = priv.sign(message)
    return "0x" + sig.hex(), ts, agent_key


def test_verifier_ed25519_valid_signature(mock_verifier_web3):
    _, _, registry = mock_verifier_web3
    _setup_verified(registry)

    verifier = SelfAgentVerifier(network="testnet", enable_replay_protection=False)
    sig, ts, agent_key = _make_ed25519_signature("GET", "/api/test")

    result = verifier.verify(
        sig, ts, "GET", "/api/test",
        keytype="ed25519", agent_key_hex=agent_key,
    )
    assert result.valid is True
    assert result.agent_address.lower() == EXPECTED_ADDRESS.lower()
    assert result.agent_id == 5


def test_verifier_ed25519_missing_agent_key(mock_verifier_web3):
    verifier = SelfAgentVerifier(network="testnet", enable_replay_protection=False)
    ts = str(int(time.time() * 1000))

    result = verifier.verify(
        "0x" + "00" * 64, ts, "GET", "/test",
        keytype="ed25519",
        # agent_key_hex intentionally omitted
    )
    assert result.valid is False
    assert "Missing agent key" in result.error


def test_verifier_ed25519_invalid_signature(mock_verifier_web3):
    verifier = SelfAgentVerifier(network="testnet", enable_replay_protection=False)
    ts = str(int(time.time() * 1000))
    agent_key = "0x" + _pub_bytes.hex()

    result = verifier.verify(
        "0x" + "ab" * 64, ts, "GET", "/test",
        keytype="ed25519", agent_key_hex=agent_key,
    )
    assert result.valid is False
    assert "Invalid Ed25519 signature" in result.error


def test_verifier_ed25519_replay_protection(mock_verifier_web3):
    _, _, registry = mock_verifier_web3
    _setup_verified(registry)

    verifier = SelfAgentVerifier(network="testnet", enable_replay_protection=True)
    sig, ts, agent_key = _make_ed25519_signature("GET", "/api/replay")

    first = verifier.verify(
        sig, ts, "GET", "/api/replay",
        keytype="ed25519", agent_key_hex=agent_key,
    )
    assert first.valid is True

    second = verifier.verify(
        sig, ts, "GET", "/api/replay",
        keytype="ed25519", agent_key_hex=agent_key,
    )
    assert second.valid is False
    assert "replay" in second.error.lower()
