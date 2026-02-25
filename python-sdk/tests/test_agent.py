# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import pytest
from unittest.mock import MagicMock, patch
from self_agent_sdk import SelfAgent
from self_agent_sdk._signing import recover_signer, compute_body_hash, compute_message

TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"


@pytest.fixture
def mock_web3():
    """Patch Web3 to avoid real RPC calls."""
    with patch("self_agent_sdk.agent.Web3") as MockWeb3:
        instance = MagicMock()
        MockWeb3.return_value = instance
        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.to_checksum_address = lambda x: x
        MockWeb3.keccak = __import__("web3").Web3.keccak
        instance.eth.contract.return_value = MagicMock()
        yield MockWeb3, instance


def test_sign_request_produces_valid_headers(mock_web3):
    agent = SelfAgent(private_key=TEST_KEY, network="testnet")
    headers = agent.sign_request("POST", "https://api.example.com/data", body='{"q":"test"}')
    assert "x-self-agent-address" in headers
    assert "x-self-agent-signature" in headers
    assert "x-self-agent-timestamp" in headers
    # Verify signature is recoverable
    ts = headers["x-self-agent-timestamp"]
    bh = compute_body_hash('{"q":"test"}')
    msg = compute_message(ts, "POST", "https://api.example.com/data", bh)
    recovered = recover_signer(msg, headers["x-self-agent-signature"])
    assert recovered.lower() == agent.address.lower()


def test_is_registered_calls_contract(mock_web3):
    agent = SelfAgent(private_key=TEST_KEY, network="testnet")
    agent._registry.functions.isVerifiedAgent.return_value.call.return_value = True
    assert agent.is_registered() is True


def test_get_info_unregistered(mock_web3):
    agent = SelfAgent(private_key=TEST_KEY, network="testnet")
    agent._registry.functions.getAgentId.return_value.call.return_value = 0
    info = agent.get_info()
    assert info.agent_id == 0
    assert info.is_verified is False


def test_network_defaults_to_mainnet(mock_web3):
    agent = SelfAgent(private_key=TEST_KEY)
    MockWeb3, instance = mock_web3
    call_args = instance.eth.contract.call_args
    assert "0x60651482a3033A72128f874623Fc790061cc46D4" in str(call_args)


def test_network_testnet_override(mock_web3):
    agent = SelfAgent(private_key=TEST_KEY, network="testnet")
    MockWeb3, instance = mock_web3
    call_args = instance.eth.contract.call_args
    assert "0x29d941856134b1D053AfFF57fa560324510C79fa" in str(call_args)


def test_custom_registry_overrides_network(mock_web3):
    custom = "0x1234567890123456789012345678901234567890"
    agent = SelfAgent(private_key=TEST_KEY, network="testnet", registry_address=custom)
    MockWeb3, instance = mock_web3
    call_args = instance.eth.contract.call_args
    assert custom in str(call_args)


def test_agent_key_is_32_bytes(mock_web3):
    agent = SelfAgent(private_key=TEST_KEY, network="testnet")
    assert len(agent.agent_key) == 32
    assert agent.agent_key[:12] == b"\x00" * 12


@patch("self_agent_sdk.agent.httpx.get")
def test_get_agent_info_raises_on_api_error(mock_get, mock_web3):
    resp = MagicMock()
    resp.is_success = False
    resp.status_code = 400
    resp.json.return_value = {"error": "Invalid agent ID"}
    mock_get.return_value = resp

    with pytest.raises(RuntimeError, match="Invalid agent ID"):
        SelfAgent.get_agent_info(0, network="testnet", api_base="http://localhost:3100")


@patch("self_agent_sdk.agent.httpx.get")
def test_get_agents_for_human_raises_on_api_error(mock_get, mock_web3):
    resp = MagicMock()
    resp.is_success = False
    resp.status_code = 400
    resp.json.return_value = {"error": "Invalid Ethereum address"}
    mock_get.return_value = resp

    with pytest.raises(RuntimeError, match="Invalid Ethereum address"):
        SelfAgent.get_agents_for_human("not-an-address", network="testnet", api_base="http://localhost:3100")
