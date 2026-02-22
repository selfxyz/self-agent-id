"""Service-side verifier for Self Agent ID requests."""
from __future__ import annotations

import time
from web3 import Web3

from .constants import (
    NETWORKS, DEFAULT_NETWORK, REGISTRY_ABI, DEFAULT_MAX_AGE_MS,
    DEFAULT_CACHE_TTL_MS, ZERO_ADDRESS, NetworkName,
)
from .types import VerificationResult, AgentCredentials
from ._signing import compute_body_hash, compute_message, recover_signer, address_to_agent_key


# ---------------------------------------------------------------------------
# Rate limiter — sliding window, keyed by agent address
# ---------------------------------------------------------------------------

class RateLimiter:
    """In-memory per-agent sliding-window rate limiter."""

    def __init__(self, per_minute: int = 0, per_hour: int = 0):
        self._per_minute = per_minute
        self._per_hour = per_hour
        self._buckets: dict[str, list[float]] = {}

    def check(self, agent_address: str) -> dict | None:
        """Return None if allowed, or {error, retry_after_ms} if rate limited."""
        now = time.time() * 1000
        key = agent_address.lower()
        timestamps = self._buckets.get(key)
        if timestamps is None:
            timestamps = []
            self._buckets[key] = timestamps

        # Prune timestamps older than 1 hour
        one_hour_ago = now - 60 * 60 * 1000
        self._buckets[key] = timestamps = [t for t in timestamps if t > one_hour_ago]

        # Check per-minute limit
        if self._per_minute > 0:
            one_minute_ago = now - 60 * 1000
            recent_minute = [t for t in timestamps if t > one_minute_ago]
            if len(recent_minute) >= self._per_minute:
                oldest = recent_minute[0]
                retry_after_ms = oldest + 60 * 1000 - now
                return {
                    "error": f"Rate limit exceeded ({self._per_minute}/min)",
                    "retry_after_ms": max(1, int(retry_after_ms)),
                }

        # Check per-hour limit
        if self._per_hour > 0:
            if len(timestamps) >= self._per_hour:
                oldest = timestamps[0]
                retry_after_ms = oldest + 60 * 60 * 1000 - now
                return {
                    "error": f"Rate limit exceeded ({self._per_hour}/hr)",
                    "retry_after_ms": max(1, int(retry_after_ms)),
                }

        # Record this request
        timestamps.append(now)
        return None


# ---------------------------------------------------------------------------
# VerifierBuilder — chainable builder API
# ---------------------------------------------------------------------------

class VerifierBuilder:
    """Chainable builder for constructing a SelfAgentVerifier."""

    def __init__(self) -> None:
        self._network: NetworkName | None = None
        self._registry_address: str | None = None
        self._rpc_url: str | None = None
        self._max_age_ms: int | None = None
        self._cache_ttl_ms: int | None = None
        self._max_agents_per_human: int | None = None
        self._include_credentials: bool | None = None
        self._require_self_provider: bool | None = None
        self._enable_replay_protection: bool | None = None
        self._minimum_age: int | None = None
        self._require_ofac_passed: bool | None = None
        self._allowed_nationalities: list[str] | None = None
        self._rate_limit_config: dict | None = None

    def network(self, name: NetworkName) -> VerifierBuilder:
        """Set the network: "mainnet" or "testnet"."""
        self._network = name
        return self

    def registry(self, addr: str) -> VerifierBuilder:
        """Set a custom registry address."""
        self._registry_address = addr
        return self

    def rpc(self, url: str) -> VerifierBuilder:
        """Set a custom RPC URL."""
        self._rpc_url = url
        return self

    def require_age(self, n: int) -> VerifierBuilder:
        """Require the agent's human to be at least ``n`` years old."""
        self._minimum_age = n
        return self

    def require_ofac(self) -> VerifierBuilder:
        """Require OFAC screening passed."""
        self._require_ofac_passed = True
        return self

    def require_nationality(self, *codes: str) -> VerifierBuilder:
        """Require nationality in the given list."""
        self._allowed_nationalities = list(codes)
        return self

    def require_self_provider(self) -> VerifierBuilder:
        """Require Self Protocol as proof provider (default: on)."""
        self._require_self_provider = True
        return self

    def sybil_limit(self, n: int) -> VerifierBuilder:
        """Max agents per human (default: 1)."""
        self._max_agents_per_human = n
        return self

    def rate_limit(
        self, per_minute: int | None = None, per_hour: int | None = None,
    ) -> VerifierBuilder:
        """Enable in-memory per-agent rate limiting."""
        self._rate_limit_config = {
            "per_minute": per_minute or 0,
            "per_hour": per_hour or 0,
        }
        return self

    def replay_protection(self, enabled: bool = True) -> VerifierBuilder:
        """Enable replay protection (default: on)."""
        self._enable_replay_protection = enabled
        return self

    def include_credentials(self) -> VerifierBuilder:
        """Include ZK credentials in verification result."""
        self._include_credentials = True
        return self

    def max_age(self, ms: int) -> VerifierBuilder:
        """Max signed timestamp age in milliseconds."""
        self._max_age_ms = ms
        return self

    def cache_ttl(self, ms: int) -> VerifierBuilder:
        """On-chain cache TTL in milliseconds."""
        self._cache_ttl_ms = ms
        return self

    def build(self) -> SelfAgentVerifier:
        """Build the SelfAgentVerifier instance."""
        # Auto-enable credentials if any credential requirement is set
        needs_credentials = (
            self._minimum_age is not None
            or self._require_ofac_passed
            or (self._allowed_nationalities and len(self._allowed_nationalities) > 0)
        )

        kwargs: dict = {}
        if self._network is not None:
            kwargs["network"] = self._network
        if self._registry_address is not None:
            kwargs["registry_address"] = self._registry_address
        if self._rpc_url is not None:
            kwargs["rpc_url"] = self._rpc_url
        if self._max_age_ms is not None:
            kwargs["max_age_ms"] = self._max_age_ms
        if self._cache_ttl_ms is not None:
            kwargs["cache_ttl_ms"] = self._cache_ttl_ms
        if self._max_agents_per_human is not None:
            kwargs["max_agents_per_human"] = self._max_agents_per_human
        if needs_credentials or self._include_credentials:
            kwargs["include_credentials"] = True
        if self._require_self_provider is not None:
            kwargs["require_self_provider"] = self._require_self_provider
        if self._enable_replay_protection is not None:
            kwargs["enable_replay_protection"] = self._enable_replay_protection
        if self._minimum_age is not None:
            kwargs["minimum_age"] = self._minimum_age
        if self._require_ofac_passed is not None:
            kwargs["require_ofac_passed"] = self._require_ofac_passed
        if self._allowed_nationalities is not None:
            kwargs["allowed_nationalities"] = self._allowed_nationalities
        if self._rate_limit_config is not None:
            kwargs["rate_limit_config"] = self._rate_limit_config

        return SelfAgentVerifier(**kwargs)


# ---------------------------------------------------------------------------
# SelfAgentVerifier
# ---------------------------------------------------------------------------

class SelfAgentVerifier:
    """
    Service-side verifier for Self Agent ID.

    Security chain:
    1. Recover signer from ECDSA signature (cryptographic -- can't be faked)
    2. Derive agent_key = zeroPad(recoveredAddress, 32)
    3. Check on-chain: isVerifiedAgent(agentKey)
    4. Check provider: getProofProvider(agentId) == selfProofProvider()
    5. Check timestamp freshness (replay protection)
    6. Sybil check: agentCount <= maxAgentsPerHuman
    7. Credential checks: age, OFAC, nationality (optional)
    8. Rate limiting: per-agent sliding window (optional)

    Usage:
        # Direct constructor (backward compatible)
        verifier = SelfAgentVerifier()                         # mainnet
        verifier = SelfAgentVerifier(network="testnet")        # testnet

        # Chainable builder
        verifier = (SelfAgentVerifier.create()
            .network("testnet")
            .require_age(18)
            .require_ofac()
            .rate_limit(per_minute=10)
            .build())

        # From config dict
        verifier = SelfAgentVerifier.from_config({
            "network": "testnet",
            "require_age": 18,
            "require_ofac": True,
        })

        result = verifier.verify(signature, timestamp, "POST", "/api/data", body)
    """

    def __init__(
        self,
        network: NetworkName | None = None,
        registry_address: str | None = None,
        rpc_url: str | None = None,
        max_age_ms: int = DEFAULT_MAX_AGE_MS,
        cache_ttl_ms: int = DEFAULT_CACHE_TTL_MS,
        max_agents_per_human: int = 1,
        include_credentials: bool = False,
        require_self_provider: bool = True,
        enable_replay_protection: bool = True,
        replay_cache_max_entries: int = 10_000,
        minimum_age: int | None = None,
        require_ofac_passed: bool = False,
        allowed_nationalities: list[str] | None = None,
        rate_limit_config: dict | None = None,
    ):
        net = NETWORKS[network or DEFAULT_NETWORK]
        self._w3 = Web3(Web3.HTTPProvider(rpc_url or net["rpc_url"]))
        self._registry = self._w3.eth.contract(
            address=Web3.to_checksum_address(registry_address or net["registry_address"]),
            abi=REGISTRY_ABI,
        )
        self._max_age_ms = max_age_ms
        self._cache_ttl_ms = cache_ttl_ms
        self._max_agents_per_human = max_agents_per_human
        self._include_credentials = include_credentials
        self._require_self_provider = require_self_provider
        self._enable_replay_protection = enable_replay_protection
        self._replay_cache_max_entries = replay_cache_max_entries
        self._minimum_age = minimum_age
        self._require_ofac_passed = require_ofac_passed
        self._allowed_nationalities = allowed_nationalities
        self._rate_limiter = (
            RateLimiter(
                per_minute=rate_limit_config.get("per_minute", 0),
                per_hour=rate_limit_config.get("per_hour", 0),
            )
            if rate_limit_config
            else None
        )

        # Cache: agentKey hex -> {is_verified, agent_id, agent_count, nullifier, provider, expires_at}
        self._cache: dict[str, dict] = {}
        self._self_provider_cache: dict | None = None
        self._replay_cache: dict[str, float] = {}

    # -- Factory methods ----------------------------------------------------

    @classmethod
    def create(cls) -> VerifierBuilder:
        """Create a chainable builder for configuring a verifier."""
        return VerifierBuilder()

    @classmethod
    def from_config(cls, config: dict) -> SelfAgentVerifier:
        """Create a verifier from a flat config dict.

        Accepted keys (all optional):
            network, registry_address, rpc_url, require_age, require_ofac,
            require_nationality, require_self_provider, sybil_limit,
            rate_limit, replay_protection, max_age_ms, cache_ttl_ms.
        """
        needs_credentials = (
            config.get("require_age") is not None
            or config.get("require_ofac")
            or bool(config.get("require_nationality"))
        )

        kwargs: dict = {}
        if "network" in config:
            kwargs["network"] = config["network"]
        if "registry_address" in config:
            kwargs["registry_address"] = config["registry_address"]
        if "rpc_url" in config:
            kwargs["rpc_url"] = config["rpc_url"]
        if "max_age_ms" in config:
            kwargs["max_age_ms"] = config["max_age_ms"]
        if "cache_ttl_ms" in config:
            kwargs["cache_ttl_ms"] = config["cache_ttl_ms"]
        if "sybil_limit" in config:
            kwargs["max_agents_per_human"] = config["sybil_limit"]
        if needs_credentials:
            kwargs["include_credentials"] = True
        if "require_self_provider" in config:
            kwargs["require_self_provider"] = config["require_self_provider"]
        if "replay_protection" in config:
            kwargs["enable_replay_protection"] = config["replay_protection"]
        if "require_age" in config:
            kwargs["minimum_age"] = config["require_age"]
        if config.get("require_ofac"):
            kwargs["require_ofac_passed"] = True
        if "require_nationality" in config:
            kwargs["allowed_nationalities"] = config["require_nationality"]
        if "rate_limit" in config:
            kwargs["rate_limit_config"] = config["rate_limit"]

        return cls(**kwargs)

    # -- Verification -------------------------------------------------------

    def verify(
        self, signature: str, timestamp: str,
        method: str, url: str, body: str | None = None,
    ) -> VerificationResult:
        """Verify a signed agent request.

        Performs: timestamp freshness, ECDSA recovery, on-chain status,
        provider check, sybil check, credential checks, and rate limiting.
        """
        empty = VerificationResult(
            valid=False, agent_address=ZERO_ADDRESS,
            agent_key=b"\x00" * 32, agent_id=0, agent_count=0,
        )

        # 1. Timestamp freshness
        try:
            ts = int(timestamp)
        except (ValueError, TypeError):
            return VerificationResult(
                valid=False, agent_address=empty.agent_address,
                agent_key=empty.agent_key, agent_id=0, agent_count=0,
                error="Invalid timestamp",
            )

        now_ms = int(time.time() * 1000)
        if abs(now_ms - ts) > self._max_age_ms:
            return VerificationResult(
                valid=False, agent_address=empty.agent_address,
                agent_key=empty.agent_key, agent_id=0, agent_count=0,
                error="Timestamp expired",
            )

        # 2. Reconstruct signed message
        body_hash = compute_body_hash(body)
        message = compute_message(timestamp, method, url, body_hash)

        # 3. Recover signer (cryptographic -- can't be faked)
        try:
            signer = recover_signer(message, signature)
        except Exception:
            return VerificationResult(
                valid=False, agent_address=empty.agent_address,
                agent_key=empty.agent_key, agent_id=0, agent_count=0,
                error="Invalid signature",
            )

        # 4. Replay cache check (after signature validity to avoid cache poisoning)
        if self._enable_replay_protection:
            replay_error = self._check_and_record_replay(signature, message.hex(), ts, now_ms)
            if replay_error is not None:
                return VerificationResult(
                    valid=False, agent_address=signer,
                    agent_key=address_to_agent_key(signer), agent_id=0, agent_count=0,
                    error=replay_error,
                )

        # 5. Derive agent key
        agent_key = address_to_agent_key(signer)

        # 6. On-chain check (with cache)
        chain = self._check_on_chain(agent_key)

        if not chain["is_verified"]:
            return VerificationResult(
                valid=False, agent_address=signer, agent_key=agent_key,
                agent_id=chain["agent_id"], agent_count=chain["agent_count"],
                nullifier=chain["nullifier"],
                error="Agent not verified on-chain",
            )

        # 7. Provider check
        if self._require_self_provider and chain["agent_id"] > 0:
            try:
                self_provider = self._get_self_provider()
            except Exception:
                return VerificationResult(
                    valid=False, agent_address=signer, agent_key=agent_key,
                    agent_id=chain["agent_id"], agent_count=chain["agent_count"],
                    nullifier=chain["nullifier"],
                    error="Unable to verify proof provider -- RPC error",
                )
            if chain["provider"].lower() != self_provider.lower():
                return VerificationResult(
                    valid=False, agent_address=signer, agent_key=agent_key,
                    agent_id=chain["agent_id"], agent_count=chain["agent_count"],
                    nullifier=chain["nullifier"],
                    error="Agent was not verified by Self -- proof provider mismatch",
                )

        # 8. Sybil check
        if self._max_agents_per_human > 0 and chain["agent_count"] > self._max_agents_per_human:
            return VerificationResult(
                valid=False, agent_address=signer, agent_key=agent_key,
                agent_id=chain["agent_id"], agent_count=chain["agent_count"],
                nullifier=chain["nullifier"],
                error=f"Human has {chain['agent_count']} agents (max {self._max_agents_per_human})",
            )

        # 9. Credentials (optional)
        credentials = None
        if self._include_credentials and chain["agent_id"] > 0:
            credentials = self._fetch_credentials(chain["agent_id"])

        # 10. Credential checks (post-verify -- only if credentials were fetched)
        if credentials:
            if self._minimum_age is not None and credentials.older_than < self._minimum_age:
                return VerificationResult(
                    valid=False, agent_address=signer, agent_key=agent_key,
                    agent_id=chain["agent_id"], agent_count=chain["agent_count"],
                    nullifier=chain["nullifier"], credentials=credentials,
                    error=(
                        f"Agent's human does not meet minimum age "
                        f"(required: {self._minimum_age}, got: {credentials.older_than})"
                    ),
                )

            if self._require_ofac_passed and not (credentials.ofac and credentials.ofac[0]):
                return VerificationResult(
                    valid=False, agent_address=signer, agent_key=agent_key,
                    agent_id=chain["agent_id"], agent_count=chain["agent_count"],
                    nullifier=chain["nullifier"], credentials=credentials,
                    error="Agent's human did not pass OFAC screening",
                )

            if self._allowed_nationalities and len(self._allowed_nationalities) > 0:
                if credentials.nationality not in self._allowed_nationalities:
                    return VerificationResult(
                        valid=False, agent_address=signer, agent_key=agent_key,
                        agent_id=chain["agent_id"], agent_count=chain["agent_count"],
                        nullifier=chain["nullifier"], credentials=credentials,
                        error=f'Nationality "{credentials.nationality}" not in allowed list',
                    )

        # 11. Rate limiting (per-agent, in-memory sliding window)
        if self._rate_limiter:
            limited = self._rate_limiter.check(signer)
            if limited:
                return VerificationResult(
                    valid=False, agent_address=signer, agent_key=agent_key,
                    agent_id=chain["agent_id"], agent_count=chain["agent_count"],
                    nullifier=chain["nullifier"], credentials=credentials,
                    error=limited["error"],
                    retry_after_ms=limited["retry_after_ms"],
                )

        return VerificationResult(
            valid=True, agent_address=signer, agent_key=agent_key,
            agent_id=chain["agent_id"], agent_count=chain["agent_count"],
            nullifier=chain["nullifier"], credentials=credentials,
        )

    # -- Internal -----------------------------------------------------------

    def _check_on_chain(self, agent_key: bytes) -> dict:
        """Check on-chain status with TTL cache."""
        cache_key = agent_key.hex()
        cached = self._cache.get(cache_key)
        if cached and cached["expires_at"] > time.time() * 1000:
            return cached

        is_verified = self._registry.functions.isVerifiedAgent(agent_key).call()
        agent_id = self._registry.functions.getAgentId(agent_key).call()

        agent_count = 0
        nullifier = 0
        provider = ""

        if agent_id > 0:
            if self._max_agents_per_human > 0:
                nullifier = self._registry.functions.getHumanNullifier(agent_id).call()
                agent_count = self._registry.functions.getAgentCountForHuman(nullifier).call()
            if self._require_self_provider:
                provider = self._registry.functions.getProofProvider(agent_id).call()

        entry = {
            "is_verified": is_verified,
            "agent_id": agent_id,
            "agent_count": agent_count,
            "nullifier": nullifier,
            "provider": provider,
            "expires_at": time.time() * 1000 + self._cache_ttl_ms,
        }
        self._cache[cache_key] = entry
        return entry

    def _get_self_provider(self) -> str:
        """Get Self Protocol's provider address (cached separately, 12x TTL)."""
        if self._self_provider_cache and self._self_provider_cache["expires_at"] > time.time() * 1000:
            return self._self_provider_cache["address"]
        # No try/except -- let RPC errors propagate to fail closed
        address = self._registry.functions.selfProofProvider().call()
        self._self_provider_cache = {
            "address": address,
            "expires_at": time.time() * 1000 + self._cache_ttl_ms * 12,
        }
        return address

    def _fetch_credentials(self, agent_id: int) -> AgentCredentials | None:
        """Fetch ZK-attested credentials for an agent."""
        try:
            raw = self._registry.functions.getAgentCredentials(agent_id).call()
            return AgentCredentials(
                issuing_state=raw[0], name=list(raw[1]), id_number=raw[2],
                nationality=raw[3], date_of_birth=raw[4], gender=raw[5],
                expiry_date=raw[6], older_than=raw[7], ofac=list(raw[8]),
            )
        except Exception:
            return None

    def clear_cache(self) -> None:
        """Clear both agent status and provider address caches."""
        self._cache.clear()
        self._self_provider_cache = None
        self._replay_cache.clear()

    def _check_and_record_replay(
        self, signature: str, message_hex: str, ts: int, now_ms: int
    ) -> str | None:
        self._prune_replay_cache(now_ms)

        key = f"{signature.lower()}:{message_hex.lower()}"
        expires_at = self._replay_cache.get(key)
        if expires_at and expires_at > now_ms:
            return "Replay detected"

        self._replay_cache[key] = ts + self._max_age_ms
        return None

    def _prune_replay_cache(self, now_ms: int) -> None:
        expired = [k for k, exp in self._replay_cache.items() if exp <= now_ms]
        for k in expired:
            self._replay_cache.pop(k, None)

        overflow = len(self._replay_cache) - self._replay_cache_max_entries
        if overflow <= 0:
            return

        # Drop earliest-expiring entries first.
        for key, _exp in sorted(
            self._replay_cache.items(), key=lambda item: item[1]
        )[:overflow]:
            self._replay_cache.pop(key, None)
