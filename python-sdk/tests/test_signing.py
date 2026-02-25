# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import pytest
from self_agent_sdk._signing import (
    compute_body_hash, compute_message, sign_message,
    recover_signer, address_to_agent_key, canonicalize_signing_url,
)

TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"


class TestBodyHash:
    def test_none_body_equals_empty_string(self):
        assert compute_body_hash(None) == compute_body_hash("")

    def test_none_body_is_not_empty_bytes(self):
        h = compute_body_hash(None)
        assert h.startswith("0x")
        assert len(h) == 66  # "0x" + 64 hex chars

    def test_json_body(self):
        h = compute_body_hash('{"query":"test"}')
        assert h.startswith("0x")
        assert h != compute_body_hash("")

    def test_unicode_body(self):
        h = compute_body_hash("héllo wörld \U0001f30d")
        assert h.startswith("0x")


class TestMessage:
    def test_method_uppercased(self):
        bh = compute_body_hash(None)
        m1 = compute_message("123", "post", "https://x.com", bh)
        m2 = compute_message("123", "POST", "https://x.com", bh)
        assert m1 == m2

    def test_different_timestamps(self):
        bh = compute_body_hash(None)
        m1 = compute_message("100", "GET", "https://x.com", bh)
        m2 = compute_message("200", "GET", "https://x.com", bh)
        assert m1 != m2

    def test_full_url_canonicalized_to_path_and_query(self):
        bh = compute_body_hash(None)
        m1 = compute_message("123", "GET", "https://x.com/api/data?x=1", bh)
        m2 = compute_message("123", "GET", "/api/data?x=1", bh)
        assert m1 == m2


class TestCanonicalUrl:
    def test_absolute_url(self):
        assert canonicalize_signing_url("https://api.example.com/v1?a=1") == "/v1?a=1"

    def test_path_only(self):
        assert canonicalize_signing_url("/v1/data") == "/v1/data"

    def test_query_only(self):
        assert canonicalize_signing_url("?a=1") == "/?a=1"


class TestSignAndRecover:
    def test_round_trip(self):
        msg = compute_message("123", "GET", "https://x.com", compute_body_hash(None))
        sig = sign_message(msg, TEST_KEY)
        recovered = recover_signer(msg, sig)
        assert recovered.lower() == "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"


class TestAgentKey:
    def test_correct_padding(self):
        key = address_to_agent_key("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
        assert len(key) == 32
        assert key[:12] == b"\x00" * 12
        assert key[12:] == bytes.fromhex("f39Fd6e51aad88F6F4ce6aB8827279cffFb92266")
