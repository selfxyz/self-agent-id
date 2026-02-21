"""Service-side verifier for Self Agent ID requests."""
import time
from web3 import Web3

from .constants import (
    NETWORKS, DEFAULT_NETWORK, REGISTRY_ABI, DEFAULT_MAX_AGE_MS,
    DEFAULT_CACHE_TTL_MS, ZERO_ADDRESS, NetworkName,
)
from .types import VerificationResult, AgentCredentials
from ._signing import compute_body_hash, compute_message, recover_signer, address_to_agent_key


class SelfAgentVerifier:
    """
    Service-side verifier for Self Agent ID.

    Security chain:
    1. Recover signer from ECDSA signature (cryptographic — can't be faked)
    2. Derive agent_key = zeroPad(recoveredAddress, 32)
    3. Check on-chain: isVerifiedAgent(agentKey)
    4. Check provider: getProofProvider(agentId) == selfProofProvider()
    5. Check timestamp freshness (replay protection)
    6. Sybil check: agentCount <= maxAgentsPerHuman

    Usage:
        verifier = SelfAgentVerifier()                         # mainnet
        verifier = SelfAgentVerifier(network="testnet")        # testnet
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

        # Cache: agentKey hex -> {is_verified, agent_id, agent_count, nullifier, provider, expires_at}
        self._cache: dict[str, dict] = {}
        self._self_provider_cache: dict | None = None
        self._replay_cache: dict[str, float] = {}

    def verify(
        self, signature: str, timestamp: str,
        method: str, url: str, body: str | None = None,
    ) -> VerificationResult:
        """Verify a signed agent request.

        Performs: timestamp freshness, ECDSA recovery, on-chain status,
        provider check, and sybil check.
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

        # 3. Recover signer (cryptographic — can't be faked)
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
                    error="Unable to verify proof provider — RPC error",
                )
            if chain["provider"].lower() != self_provider.lower():
                return VerificationResult(
                    valid=False, agent_address=signer, agent_key=agent_key,
                    agent_id=chain["agent_id"], agent_count=chain["agent_count"],
                    nullifier=chain["nullifier"],
                    error="Agent was not verified by Self — proof provider mismatch",
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

        return VerificationResult(
            valid=True, agent_address=signer, agent_key=agent_key,
            agent_id=chain["agent_id"], agent_count=chain["agent_count"],
            nullifier=chain["nullifier"], credentials=credentials,
        )

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
        # No try/except — let RPC errors propagate to fail closed
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
