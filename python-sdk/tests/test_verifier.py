# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import time

import pytest
from unittest.mock import MagicMock, patch
from self_agent_sdk import SelfAgentVerifier
from self_agent_sdk._signing import compute_body_hash, compute_message, sign_message

TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
PROVIDER_ADDR = "0x1234567890abcdef1234567890abcdef12345678"


@pytest.fixture
def mock_web3():
    """Patch Web3 to avoid real RPC calls."""
    with patch("self_agent_sdk.verifier.Web3") as MockWeb3:
        instance = MagicMock()
        MockWeb3.return_value = instance
        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.to_checksum_address = lambda x: x
        MockWeb3.keccak = __import__("web3").Web3.keccak
        registry = MagicMock()
        instance.eth.contract.return_value = registry
        yield MockWeb3, instance, registry


def _make_signature(method: str, url: str, body: str | None = None):
    """Create a real signature for testing."""
    ts = str(int(time.time() * 1000))
    bh = compute_body_hash(body)
    msg = compute_message(ts, method, url, bh)
    sig = sign_message(msg, TEST_KEY)
    return sig, ts


def _setup_verified(registry):
    """Set up mock for a verified agent."""
    registry.functions.isVerifiedAgent.return_value.call.return_value = True
    registry.functions.getAgentId.return_value.call.return_value = 5
    registry.functions.getHumanNullifier.return_value.call.return_value = 42
    registry.functions.getAgentCountForHuman.return_value.call.return_value = 1
    registry.functions.getProofProvider.return_value.call.return_value = PROVIDER_ADDR
    registry.functions.selfProofProvider.return_value.call.return_value = PROVIDER_ADDR


def test_verify_valid_signature(mock_web3):
    _, _, registry = mock_web3
    _setup_verified(registry)

    verifier = SelfAgentVerifier(network="testnet")
    sig, ts = _make_signature("POST", "/api/data", '{"test":true}')

    result = verifier.verify(sig, ts, "POST", "/api/data", '{"test":true}')
    assert result.valid is True
    assert result.agent_address.lower() == TEST_ADDR.lower()
    assert result.nullifier == 42
    assert result.agent_id == 5
    assert result.agent_count == 1


def test_reject_expired_timestamp(mock_web3):
    verifier = SelfAgentVerifier(network="testnet")
    old_ts = str(int(time.time() * 1000) - 10 * 60 * 1000)  # 10 min ago
    bh = compute_body_hash(None)
    msg = compute_message(old_ts, "GET", "/api", bh)
    sig = sign_message(msg, TEST_KEY)

    result = verifier.verify(sig, old_ts, "GET", "/api")
    assert result.valid is False
    assert "expired" in result.error.lower()


def test_reject_invalid_timestamp(mock_web3):
    verifier = SelfAgentVerifier(network="testnet")
    result = verifier.verify("0x" + "00" * 65, "not-a-number", "GET", "/api")
    assert result.valid is False
    assert "invalid timestamp" in result.error.lower()


def test_reject_invalid_signature(mock_web3):
    verifier = SelfAgentVerifier(network="testnet")
    ts = str(int(time.time() * 1000))
    result = verifier.verify("0xinvalid", ts, "GET", "/api")
    assert result.valid is False
    assert "invalid signature" in result.error.lower()


def test_reject_unverified_agent(mock_web3):
    _, _, registry = mock_web3
    registry.functions.isVerifiedAgent.return_value.call.return_value = False
    registry.functions.getAgentId.return_value.call.return_value = 0

    verifier = SelfAgentVerifier(network="testnet")
    sig, ts = _make_signature("GET", "/api")

    result = verifier.verify(sig, ts, "GET", "/api")
    assert result.valid is False
    assert "not verified" in result.error.lower()


def test_reject_provider_mismatch(mock_web3):
    _, _, registry = mock_web3
    _setup_verified(registry)
    # Different provider addresses
    registry.functions.getProofProvider.return_value.call.return_value = "0xAAAA"
    registry.functions.selfProofProvider.return_value.call.return_value = "0xBBBB"

    verifier = SelfAgentVerifier(network="testnet")
    sig, ts = _make_signature("POST", "/api/data", "body")

    result = verifier.verify(sig, ts, "POST", "/api/data", "body")
    assert result.valid is False
    assert "provider mismatch" in result.error.lower()


def test_provider_rpc_error_fails_closed(mock_web3):
    _, _, registry = mock_web3
    registry.functions.isVerifiedAgent.return_value.call.return_value = True
    registry.functions.getAgentId.return_value.call.return_value = 5
    registry.functions.getHumanNullifier.return_value.call.return_value = 42
    registry.functions.getAgentCountForHuman.return_value.call.return_value = 1
    registry.functions.getProofProvider.return_value.call.return_value = PROVIDER_ADDR
    registry.functions.selfProofProvider.return_value.call.side_effect = Exception("RPC down")

    verifier = SelfAgentVerifier(network="testnet")
    sig, ts = _make_signature("GET", "/api")

    result = verifier.verify(sig, ts, "GET", "/api")
    assert result.valid is False
    assert "rpc" in result.error.lower()


def test_reject_sybil_cap(mock_web3):
    _, _, registry = mock_web3
    _setup_verified(registry)
    registry.functions.getAgentCountForHuman.return_value.call.return_value = 5

    verifier = SelfAgentVerifier(network="testnet", max_agents_per_human=3)
    sig, ts = _make_signature("GET", "/api")

    result = verifier.verify(sig, ts, "GET", "/api")
    assert result.valid is False
    assert "5 agents" in result.error


def test_cache_ttl(mock_web3):
    _, _, registry = mock_web3
    _setup_verified(registry)

    verifier = SelfAgentVerifier(network="testnet", cache_ttl_ms=60_000)
    sig1, ts1 = _make_signature("GET", "/api")
    result1 = verifier.verify(sig1, ts1, "GET", "/api")
    assert result1.valid is True

    # Second call should use cache (registry not called again)
    call_count_before = registry.functions.isVerifiedAgent.return_value.call.call_count
    sig2, ts2 = _make_signature("GET", "/api")
    result2 = verifier.verify(sig2, ts2, "GET", "/api")
    assert result2.valid is True
    # isVerifiedAgent should not be called again (cache hit)
    assert registry.functions.isVerifiedAgent.return_value.call.call_count == call_count_before


def test_reject_replayed_signature(mock_web3):
    _, _, registry = mock_web3
    _setup_verified(registry)

    verifier = SelfAgentVerifier(network="testnet", enable_replay_protection=True)
    sig, ts = _make_signature("GET", "/api/replay")

    first = verifier.verify(sig, ts, "GET", "/api/replay")
    assert first.valid is True

    second = verifier.verify(sig, ts, "GET", "/api/replay")
    assert second.valid is False
    assert "replay" in second.error.lower()


def test_invalid_message_does_not_poison_replay_cache(mock_web3):
    _, _, registry = mock_web3
    _setup_verified(registry)

    verifier = SelfAgentVerifier(network="testnet", enable_replay_protection=True)
    sig, ts = _make_signature("POST", "/api/replay", '{"amount":100}')

    tampered = verifier.verify(sig, ts, "POST", "/api/replay", '{"amount":999}')
    assert "replay" not in (tampered.error or "").lower()

    # A verification for a different message must not consume this message's replay key.
    legit = verifier.verify(sig, ts, "POST", "/api/replay", '{"amount":100}')
    assert legit.valid is True
