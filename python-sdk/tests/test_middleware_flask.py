# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import time
import json

import pytest
from unittest.mock import MagicMock, patch
from flask import Flask, g, jsonify

from self_agent_sdk._signing import compute_body_hash, compute_message, sign_message
from self_agent_sdk.middleware.flask import require_agent

TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
PROVIDER_ADDR = "0xProviderAddr"


def _sign(method: str, url: str, body: str | None = None):
    ts = str(int(time.time() * 1000))
    bh = compute_body_hash(body)
    msg = compute_message(ts, method, url, bh)
    sig = sign_message(msg, TEST_KEY)
    return {
        "x-self-agent-address": TEST_ADDR,
        "x-self-agent-signature": sig,
        "x-self-agent-timestamp": ts,
    }


@pytest.fixture
def mock_verifier():
    with patch("self_agent_sdk.verifier.Web3") as MockWeb3:
        instance = MagicMock()
        MockWeb3.return_value = instance
        MockWeb3.HTTPProvider.return_value = MagicMock()
        MockWeb3.to_checksum_address = lambda x: x
        MockWeb3.keccak = __import__("web3").Web3.keccak
        registry = MagicMock()
        instance.eth.contract.return_value = registry

        registry.functions.isVerifiedAgent.return_value.call.return_value = True
        registry.functions.getAgentId.return_value.call.return_value = 5
        registry.functions.getHumanNullifier.return_value.call.return_value = 42
        registry.functions.getAgentCountForHuman.return_value.call.return_value = 1
        registry.functions.getProofProvider.return_value.call.return_value = PROVIDER_ADDR
        registry.functions.selfProofProvider.return_value.call.return_value = PROVIDER_ADDR
        registry.functions.isProofFresh.return_value.call.return_value = True
        registry.functions.proofExpiresAt.return_value.call.return_value = int(time.time()) + 86400 * 365

        from self_agent_sdk import SelfAgentVerifier
        verifier = SelfAgentVerifier(network="testnet")
        yield verifier


def test_flask_accepts_valid_agent(mock_verifier):
    app = Flask(__name__)

    @app.route("/api/data", methods=["POST"])
    @require_agent(mock_verifier)
    def handle():
        return jsonify({"agent": g.agent.agent_address})

    with app.test_client() as client:
        headers = _sign("POST", "/api/data", '{"test":true}')
        headers["Content-Type"] = "application/json"
        response = client.post("/api/data", data='{"test":true}', headers=headers)
        assert response.status_code == 200
        data = response.get_json()
        assert data["agent"].lower() == TEST_ADDR.lower()


def test_flask_rejects_missing_headers(mock_verifier):
    app = Flask(__name__)

    @app.route("/api/data", methods=["POST"])
    @require_agent(mock_verifier)
    def handle():
        return jsonify({"ok": True})

    with app.test_client() as client:
        response = client.post("/api/data", data='{"test":true}')
        assert response.status_code == 401
        data = response.get_json()
        assert "missing" in data["error"].lower()
