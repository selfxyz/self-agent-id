# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""Agent-side SDK using Ed25519 key pairs — sign requests and check on-chain status."""
import time

import httpx
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from web3 import Web3

from .constants import NETWORKS, DEFAULT_NETWORK, REGISTRY_ABI, HEADERS, NetworkName
from .types import AgentInfo
from ._signing import compute_body_hash, compute_message


class Ed25519Agent:
    """
    Agent-side SDK for Self Agent ID using Ed25519 key pairs.

    The agent's on-chain identity is its raw 32-byte Ed25519 public key:
        agentKey = "0x" + hex(publicKey)

    For off-chain authentication, the agent signs each request with Ed25519.
    Services verify the signature using the public key and check on-chain status.

    Usage:
        agent = Ed25519Agent(private_key="aa" * 32)                    # mainnet
        agent = Ed25519Agent(private_key="aa" * 32, network="testnet") # testnet

        headers = agent.sign_request("POST", "https://api.example.com/data", body='{"q":"test"}')
        response = agent.fetch("https://api.example.com/data", method="POST", body='{"q":"test"}')
    """

    def __init__(
        self,
        private_key: str,
        network: NetworkName | None = None,
        registry_address: str | None = None,
        rpc_url: str | None = None,
    ):
        priv_hex = private_key.removeprefix("0x")
        if len(priv_hex) != 64:
            raise ValueError("Ed25519 private key must be 32 bytes (64 hex characters)")

        key_bytes = bytes.fromhex(priv_hex)
        self._private_key = Ed25519PrivateKey.from_private_bytes(key_bytes)
        self._public_key = self._private_key.public_key()

        pub_bytes = self._public_key.public_bytes_raw()
        self._agent_key = "0x" + pub_bytes.hex()
        self._address = Ed25519Agent.derive_address(pub_bytes)

        self._network_name: NetworkName = network or DEFAULT_NETWORK
        net = NETWORKS[self._network_name]
        self._rpc_url = rpc_url or net["rpc_url"]
        self._registry_address = registry_address or net["registry_address"]

        self._w3 = Web3(Web3.HTTPProvider(self._rpc_url))
        self._registry = self._w3.eth.contract(
            address=Web3.to_checksum_address(self._registry_address),
            abi=REGISTRY_ABI,
        )

    @property
    def address(self) -> str:
        """A deterministic Ethereum-style address derived from keccak256(pubkey)."""
        return self._address

    @property
    def agent_key(self) -> str:
        """The agent's on-chain key (bytes32) -- raw Ed25519 public key as 0x hex."""
        return self._agent_key

    @staticmethod
    def derive_address(pubkey: bytes | str) -> str:
        """Derive a deterministic Ethereum-style address from an Ed25519 public key.

        Matches the on-chain Ed25519Verifier.deriveAddress():
            address(uint160(uint256(keccak256(pubkey))))
        """
        if isinstance(pubkey, str):
            pubkey = bytes.fromhex(pubkey.removeprefix("0x"))
        h = Web3.keccak(pubkey)
        return Web3.to_checksum_address("0x" + h[-20:].hex())

    def sign_request(self, method: str, url: str, body: str | None = None) -> dict[str, str]:
        """Generate authentication headers for a request.

        Signature covers: keccak256(timestamp + method + canonicalPathAndQuery + bodyHash)
        Signed with Ed25519 instead of ECDSA.
        """
        timestamp = str(int(time.time() * 1000))
        body_hash = compute_body_hash(body)
        message = compute_message(timestamp, method, url, body_hash)
        # message is raw 32 bytes (keccak256 hash) -- sign directly with Ed25519
        signature = self._private_key.sign(message)
        return {
            HEADERS["KEY"]: self._agent_key,
            HEADERS["KEYTYPE"]: "ed25519",
            HEADERS["SIGNATURE"]: "0x" + signature.hex(),
            HEADERS["TIMESTAMP"]: timestamp,
        }

    def is_registered(self) -> bool:
        """Check if this agent is registered and verified on-chain."""
        agent_key_bytes = bytes.fromhex(self._agent_key[2:])
        return self._registry.functions.isVerifiedAgent(agent_key_bytes).call()

    def get_info(self) -> AgentInfo:
        """Get full agent info from the registry."""
        agent_key_bytes = bytes.fromhex(self._agent_key[2:])
        agent_id = self._registry.functions.getAgentId(agent_key_bytes).call()
        if agent_id == 0:
            return AgentInfo(
                address=self._address,
                agent_key=agent_key_bytes,
                agent_id=0, is_verified=False, nullifier=0, agent_count=0,
            )
        is_verified = self._registry.functions.hasHumanProof(agent_id).call()
        nullifier = self._registry.functions.getHumanNullifier(agent_id).call()
        agent_count = self._registry.functions.getAgentCountForHuman(nullifier).call()
        return AgentInfo(
            address=self._address,
            agent_key=agent_key_bytes,
            agent_id=agent_id,
            is_verified=is_verified,
            nullifier=nullifier,
            agent_count=agent_count,
        )

    def fetch(
        self, url: str, method: str = "GET",
        body: str | None = None, headers: dict[str, str] | None = None,
    ) -> httpx.Response:
        """Make an auto-signed HTTP request."""
        auth_headers = self.sign_request(method, url, body)
        all_headers = {**(headers or {}), **auth_headers}
        return httpx.request(method, url, headers=all_headers, content=body)
