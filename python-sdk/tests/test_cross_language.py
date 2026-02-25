# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import json
import pathlib

import pytest
from self_agent_sdk._signing import (
    compute_body_hash, compute_message, sign_message,
    recover_signer, address_to_agent_key,
)

FIXTURES = pathlib.Path(__file__).parent / "fixtures" / "test_vectors.json"


@pytest.fixture
def vectors():
    data = json.loads(FIXTURES.read_text())
    return data["private_key"], data["vectors"]


def test_body_hash_matches_ts(vectors):
    pk, vecs = vectors
    for v in vecs:
        py_hash = compute_body_hash(v["body"])
        assert py_hash == v["body_hash"], f"body_hash mismatch for {v['method']} {v['url']}"


def test_message_matches_ts(vectors):
    pk, vecs = vectors
    for v in vecs:
        py_msg = compute_message(v["timestamp"], v["method"], v["url"], v["body_hash"])
        assert "0x" + py_msg.hex() == v["message"], f"message mismatch for {v['method']} {v['url']}"


def test_signature_matches_ts(vectors):
    pk, vecs = vectors
    for v in vecs:
        py_msg = compute_message(v["timestamp"], v["method"], v["url"], v["body_hash"])
        py_sig = sign_message(py_msg, pk)
        assert py_sig == v["signature"], f"signature mismatch for {v['method']} {v['url']}"


def test_python_recovers_ts_signature(vectors):
    pk, vecs = vectors
    for v in vecs:
        py_msg = compute_message(v["timestamp"], v["method"], v["url"], v["body_hash"])
        recovered = recover_signer(py_msg, v["signature"])
        assert recovered.lower() == v["recovered_address"].lower()


def test_agent_key_matches_ts(vectors):
    pk, vecs = vectors
    for v in vecs:
        py_key = address_to_agent_key(v["recovered_address"])
        assert "0x" + py_key.hex() == v["agent_key"].lower()
