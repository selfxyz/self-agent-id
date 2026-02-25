# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""Integration tests against Celo Sepolia.

Run with: pytest tests/test_live.py --slow -v

Tests that need DEMO_AGENT_KEY are skipped unless the env var is set.
Tests marked @no_key_needed run against public on-chain data without any private key.
"""
import os
import time

import pytest
from eth_account import Account

from self_agent_sdk import SelfAgent, SelfAgentVerifier
from self_agent_sdk._signing import (
    compute_body_hash, compute_message, sign_message, recover_signer, address_to_agent_key,
)
from self_agent_sdk.constants import NETWORKS, REGISTRY_ABI

# Use env var for registered agent, or skip
DEMO_KEY = os.environ.get("DEMO_AGENT_KEY")

# Known public addresses (no private key needed to verify these)
DEMO_AGENT_ADDRESS = "0x83fa4380903fecb801F4e123835664973001ff00"
DEMO_AGENT_ID = 5
SELF_PROVIDER_V4 = "0x8e248DEB0F18B0A4b1c608F2d80dBCeB1B868F81"


# ============================================================
# Tests that DO NOT need a private key (public on-chain data)
# ============================================================

@pytest.mark.slow
def test_rpc_connection():
    """Verify we can connect to Celo Sepolia."""
    from web3 import Web3
    w3 = Web3(Web3.HTTPProvider(NETWORKS["testnet"]["rpc_url"]))
    assert w3.is_connected()
    assert w3.eth.chain_id == 11142220


@pytest.mark.slow
def test_known_demo_agent_is_verified_on_chain():
    """Verify the known demo agent is registered — using raw web3, no SDK."""
    from web3 import Web3
    w3 = Web3(Web3.HTTPProvider(NETWORKS["testnet"]["rpc_url"]))
    registry = w3.eth.contract(
        address=Web3.to_checksum_address(NETWORKS["testnet"]["registry_address"]),
        abi=REGISTRY_ABI,
    )
    agent_key = address_to_agent_key(DEMO_AGENT_ADDRESS)
    assert registry.functions.isVerifiedAgent(agent_key).call() is True
    assert registry.functions.getAgentId(agent_key).call() == DEMO_AGENT_ID


@pytest.mark.slow
def test_self_proof_provider_matches():
    """Verify the demo agent's proof provider matches selfProofProvider()."""
    from web3 import Web3
    w3 = Web3(Web3.HTTPProvider(NETWORKS["testnet"]["rpc_url"]))
    registry = w3.eth.contract(
        address=Web3.to_checksum_address(NETWORKS["testnet"]["registry_address"]),
        abi=REGISTRY_ABI,
    )
    self_provider = registry.functions.selfProofProvider().call()
    agent_provider = registry.functions.getProofProvider(DEMO_AGENT_ID).call()
    assert self_provider.lower() == agent_provider.lower()
    assert self_provider.lower() == SELF_PROVIDER_V4.lower()


@pytest.mark.slow
def test_random_agent_not_verified():
    """A random address should not be verified on-chain."""
    random_key = Account.create().key.hex()
    agent = SelfAgent(private_key=random_key, network="testnet")
    assert agent.is_registered() is False


@pytest.mark.slow
def test_random_agent_get_info():
    """get_info for an unregistered agent should return zeros."""
    random_key = Account.create().key.hex()
    agent = SelfAgent(private_key=random_key, network="testnet")
    info = agent.get_info()
    assert info.agent_id == 0
    assert info.is_verified is False
    assert info.nullifier == 0


@pytest.mark.slow
def test_verifier_rejects_unregistered_agent():
    """Full verifier flow: sign with random key -> verify -> should fail on-chain."""
    random_key = "0x" + Account.create().key.hex()
    verifier = SelfAgentVerifier(network="testnet")

    ts = str(int(time.time() * 1000))
    bh = compute_body_hash('{"test":true}')
    msg = compute_message(ts, "POST", "/api/test", bh)
    sig = sign_message(msg, random_key)

    result = verifier.verify(sig, ts, "POST", "/api/test", '{"test":true}')
    assert result.valid is False
    assert "not verified" in result.error.lower()


# ============================================================
# Tests that NEED DEMO_AGENT_KEY env var
# ============================================================

@pytest.mark.slow
@pytest.mark.skipif(not DEMO_KEY, reason="DEMO_AGENT_KEY not set")
def test_known_agent_is_verified_via_sdk():
    """SelfAgent.is_registered() returns True for the demo agent."""
    agent = SelfAgent(private_key=DEMO_KEY, network="testnet")
    assert agent.address.lower() == DEMO_AGENT_ADDRESS.lower()
    assert agent.is_registered() is True


@pytest.mark.slow
@pytest.mark.skipif(not DEMO_KEY, reason="DEMO_AGENT_KEY not set")
def test_known_agent_get_info():
    """Full agent info: ID, nullifier, count all populated."""
    agent = SelfAgent(private_key=DEMO_KEY, network="testnet")
    info = agent.get_info()
    assert info.agent_id == DEMO_AGENT_ID
    assert info.is_verified is True
    assert info.nullifier > 0
    assert info.agent_count >= 1


@pytest.mark.slow
@pytest.mark.skipif(not DEMO_KEY, reason="DEMO_AGENT_KEY not set")
def test_full_sign_and_verify_round_trip():
    """Sign a request with SelfAgent, verify with SelfAgentVerifier.

    This is THE critical end-to-end test: sign in Python, verify in Python,
    hitting the real Celo Sepolia chain for on-chain checks.
    """
    agent = SelfAgent(private_key=DEMO_KEY, network="testnet")
    # Disable sybil check — the demo human has multiple agents on testnet
    verifier = SelfAgentVerifier(network="testnet", max_agents_per_human=0)

    # Sign a POST request
    body = '{"query":"integration test"}'
    headers = agent.sign_request("POST", "/api/test", body=body)

    # Verify the signed request
    result = verifier.verify(
        signature=headers["x-self-agent-signature"],
        timestamp=headers["x-self-agent-timestamp"],
        method="POST", url="/api/test", body=body,
    )
    assert result.valid is True
    assert result.agent_address.lower() == DEMO_AGENT_ADDRESS.lower()
    assert result.agent_id == DEMO_AGENT_ID
    assert result.agent_count == 0  # 0 when sybil check disabled (no nullifier lookup)
    assert result.error is None


@pytest.mark.slow
@pytest.mark.skipif(not DEMO_KEY, reason="DEMO_AGENT_KEY not set")
def test_sign_and_verify_get_request():
    """Sign and verify a GET request (body=None)."""
    agent = SelfAgent(private_key=DEMO_KEY, network="testnet")
    verifier = SelfAgentVerifier(network="testnet", max_agents_per_human=0)

    headers = agent.sign_request("GET", "/api/status")
    result = verifier.verify(
        signature=headers["x-self-agent-signature"],
        timestamp=headers["x-self-agent-timestamp"],
        method="GET", url="/api/status",
    )
    assert result.valid is True


@pytest.mark.slow
@pytest.mark.skipif(not DEMO_KEY, reason="DEMO_AGENT_KEY not set")
def test_provider_check_passes():
    """Verify that requireSelfProvider=True passes for the demo agent."""
    agent = SelfAgent(private_key=DEMO_KEY, network="testnet")
    verifier = SelfAgentVerifier(
        network="testnet", require_self_provider=True, max_agents_per_human=0,
    )

    headers = agent.sign_request("POST", "/api/test", body="test")
    result = verifier.verify(
        signature=headers["x-self-agent-signature"],
        timestamp=headers["x-self-agent-timestamp"],
        method="POST", url="/api/test", body="test",
    )
    assert result.valid is True


@pytest.mark.slow
@pytest.mark.skipif(not DEMO_KEY, reason="DEMO_AGENT_KEY not set")
def test_sybil_enforcement_live():
    """Verify the sybil cap works against real chain data.

    The demo human has 5 agents on testnet, so:
    - max_agents_per_human=10 -> should pass
    - max_agents_per_human=1 -> should fail with 'has 5 agents'
    """
    agent = SelfAgent(private_key=DEMO_KEY, network="testnet")

    # With high limit: should pass
    verifier_lenient = SelfAgentVerifier(network="testnet", max_agents_per_human=10)
    headers = agent.sign_request("GET", "/api/sybil-test")
    result = verifier_lenient.verify(
        signature=headers["x-self-agent-signature"],
        timestamp=headers["x-self-agent-timestamp"],
        method="GET", url="/api/sybil-test",
    )
    assert result.valid is True
    assert result.agent_count >= 1
    assert result.nullifier > 0

    # With strict limit: should fail
    verifier_strict = SelfAgentVerifier(network="testnet", max_agents_per_human=1)
    headers2 = agent.sign_request("GET", "/api/sybil-test")
    result2 = verifier_strict.verify(
        signature=headers2["x-self-agent-signature"],
        timestamp=headers2["x-self-agent-timestamp"],
        method="GET", url="/api/sybil-test",
    )
    assert result2.valid is False
    assert "agents" in result2.error.lower()
    assert result2.agent_count > 1


@pytest.mark.slow
@pytest.mark.skipif(not DEMO_KEY, reason="DEMO_AGENT_KEY not set")
def test_credentials_fetch():
    """Verify credentials can be fetched for the demo agent."""
    agent = SelfAgent(private_key=DEMO_KEY, network="testnet")
    verifier = SelfAgentVerifier(
        network="testnet",
        include_credentials=True,
        max_agents_per_human=0,  # Disable sybil check for this test
    )

    headers = agent.sign_request("GET", "/api/creds")
    result = verifier.verify(
        signature=headers["x-self-agent-signature"],
        timestamp=headers["x-self-agent-timestamp"],
        method="GET", url="/api/creds",
    )
    assert result.valid is True
    # Credentials may or may not be populated depending on the demo agent's config
    # But the call itself should not error
    if result.credentials:
        assert isinstance(result.credentials.older_than, int)
        assert isinstance(result.credentials.ofac, list)
