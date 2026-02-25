# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""Tests for the chainable VerifierBuilder API and from_config factory."""
from unittest.mock import MagicMock, patch

from self_agent_sdk import SelfAgentVerifier, VerifierBuilder, RateLimiter


@patch("self_agent_sdk.verifier.Web3")
def test_create_build(MockWeb3):
    """Builder .create() -> .build() produces a working verifier."""
    _stub_web3(MockWeb3)
    v = (SelfAgentVerifier.create()
         .network("testnet")
         .build())
    assert v is not None
    assert callable(v.verify)


@patch("self_agent_sdk.verifier.Web3")
def test_chain_credential_requirements(MockWeb3):
    """Credential requirements can be chained."""
    _stub_web3(MockWeb3)
    v = (SelfAgentVerifier.create()
         .network("testnet")
         .require_age(18)
         .require_ofac()
         .require_nationality("US", "GB")
         .build())
    assert v is not None
    assert v._minimum_age == 18
    assert v._require_ofac_passed is True
    assert v._allowed_nationalities == ["US", "GB"]
    # Credentials should be auto-enabled when requirements are set
    assert v._include_credentials is True


@patch("self_agent_sdk.verifier.Web3")
def test_chain_security_settings(MockWeb3):
    """Security settings can be chained."""
    _stub_web3(MockWeb3)
    v = (SelfAgentVerifier.create()
         .network("testnet")
         .require_self_provider()
         .sybil_limit(3)
         .replay_protection()
         .max_age(60_000)
         .cache_ttl(30_000)
         .build())
    assert v is not None
    assert v._require_self_provider is True
    assert v._max_agents_per_human == 3
    assert v._enable_replay_protection is True
    assert v._max_age_ms == 60_000
    assert v._cache_ttl_ms == 30_000


@patch("self_agent_sdk.verifier.Web3")
def test_chain_rate_limiting(MockWeb3):
    """Rate limiting can be chained."""
    _stub_web3(MockWeb3)
    v = (SelfAgentVerifier.create()
         .network("testnet")
         .rate_limit(per_minute=10)
         .build())
    assert v is not None
    assert v._rate_limiter is not None
    assert v._rate_limiter._per_minute == 10


@patch("self_agent_sdk.verifier.Web3")
def test_from_config(MockWeb3):
    """from_config creates a verifier from a flat dict."""
    _stub_web3(MockWeb3)
    v = SelfAgentVerifier.from_config({
        "network": "testnet",
        "require_age": 18,
        "require_ofac": True,
        "sybil_limit": 1,
    })
    assert v is not None
    assert callable(v.verify)
    assert v._minimum_age == 18
    assert v._require_ofac_passed is True
    assert v._max_agents_per_human == 1
    assert v._include_credentials is True


@patch("self_agent_sdk.verifier.Web3")
def test_from_config_with_nationality(MockWeb3):
    """from_config handles require_nationality list."""
    _stub_web3(MockWeb3)
    v = SelfAgentVerifier.from_config({
        "network": "testnet",
        "require_nationality": ["US", "GB", "DE"],
    })
    assert v._allowed_nationalities == ["US", "GB", "DE"]
    assert v._include_credentials is True


@patch("self_agent_sdk.verifier.Web3")
def test_from_config_with_rate_limit(MockWeb3):
    """from_config handles rate_limit dict."""
    _stub_web3(MockWeb3)
    v = SelfAgentVerifier.from_config({
        "network": "testnet",
        "rate_limit": {"per_minute": 5, "per_hour": 100},
    })
    assert v._rate_limiter is not None
    assert v._rate_limiter._per_minute == 5
    assert v._rate_limiter._per_hour == 100


@patch("self_agent_sdk.verifier.Web3")
def test_old_constructor_still_works(MockWeb3):
    """Backward compat: direct constructor without builder."""
    _stub_web3(MockWeb3)
    v = SelfAgentVerifier(network="testnet")
    assert v is not None


@patch("self_agent_sdk.verifier.Web3")
def test_default_constructor(MockWeb3):
    """Default constructor with no args produces a mainnet verifier."""
    _stub_web3(MockWeb3)
    v = SelfAgentVerifier()
    assert v is not None


@patch("self_agent_sdk.verifier.Web3")
def test_builder_returns_builder_type(MockWeb3):
    """Each builder method returns the builder for chaining."""
    _stub_web3(MockWeb3)
    builder = SelfAgentVerifier.create()
    assert isinstance(builder, VerifierBuilder)
    result = builder.network("testnet")
    assert isinstance(result, VerifierBuilder)
    result = result.require_age(21)
    assert isinstance(result, VerifierBuilder)


@patch("self_agent_sdk.verifier.Web3")
def test_auto_enable_credentials_on_age(MockWeb3):
    """Setting require_age auto-enables include_credentials."""
    _stub_web3(MockWeb3)
    v = SelfAgentVerifier.create().network("testnet").require_age(18).build()
    assert v._include_credentials is True


@patch("self_agent_sdk.verifier.Web3")
def test_auto_enable_credentials_on_ofac(MockWeb3):
    """Setting require_ofac auto-enables include_credentials."""
    _stub_web3(MockWeb3)
    v = SelfAgentVerifier.create().network("testnet").require_ofac().build()
    assert v._include_credentials is True


@patch("self_agent_sdk.verifier.Web3")
def test_auto_enable_credentials_on_nationality(MockWeb3):
    """Setting require_nationality auto-enables include_credentials."""
    _stub_web3(MockWeb3)
    v = SelfAgentVerifier.create().network("testnet").require_nationality("US").build()
    assert v._include_credentials is True


@patch("self_agent_sdk.verifier.Web3")
def test_include_credentials_explicit(MockWeb3):
    """include_credentials can be set explicitly without credential requirements."""
    _stub_web3(MockWeb3)
    v = SelfAgentVerifier.create().network("testnet").include_credentials().build()
    assert v._include_credentials is True


@patch("self_agent_sdk.verifier.Web3")
def test_replay_protection_disabled(MockWeb3):
    """Replay protection can be explicitly disabled."""
    _stub_web3(MockWeb3)
    v = (SelfAgentVerifier.create()
         .network("testnet")
         .replay_protection(False)
         .build())
    assert v._enable_replay_protection is False


# ---------------------------------------------------------------------------
# RateLimiter unit tests
# ---------------------------------------------------------------------------

def test_rate_limiter_allows_under_limit():
    """Requests under the limit are allowed."""
    rl = RateLimiter(per_minute=3)
    assert rl.check("0xabc") is None
    assert rl.check("0xabc") is None
    assert rl.check("0xabc") is None


def test_rate_limiter_blocks_over_limit():
    """Fourth request in a minute is blocked."""
    rl = RateLimiter(per_minute=3)
    rl.check("0xabc")
    rl.check("0xabc")
    rl.check("0xabc")
    result = rl.check("0xabc")
    assert result is not None
    assert "Rate limit exceeded" in result["error"]
    assert result["retry_after_ms"] > 0


def test_rate_limiter_per_agent_isolation():
    """Rate limits are tracked per agent address."""
    rl = RateLimiter(per_minute=1)
    assert rl.check("0xaaa") is None
    assert rl.check("0xbbb") is None
    # 0xaaa should be blocked, but 0xbbb should still be fine for next check
    result = rl.check("0xaaa")
    assert result is not None


def test_rate_limiter_case_insensitive():
    """Agent addresses are lowercased for key lookup."""
    rl = RateLimiter(per_minute=1)
    assert rl.check("0xABC") is None
    result = rl.check("0xabc")
    assert result is not None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _stub_web3(MockWeb3):
    """Patch Web3 to avoid real RPC calls."""
    instance = MagicMock()
    MockWeb3.return_value = instance
    MockWeb3.HTTPProvider.return_value = MagicMock()
    MockWeb3.to_checksum_address = lambda x: x
    registry = MagicMock()
    instance.eth.contract.return_value = registry
