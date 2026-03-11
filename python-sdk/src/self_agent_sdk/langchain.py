# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""LangChain tools for Self Agent ID.

Install: pip install selfxyz-agent-sdk[langchain]
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
from typing import Any, Optional, TYPE_CHECKING
from urllib.parse import urlparse

try:
    from langchain_core.tools import BaseTool
except ImportError:
    raise ImportError(
        "LangChain integration requires langchain-core. "
        "Install with: pip install selfxyz-agent-sdk[langchain]"
    )

from pydantic import BaseModel, Field
from web3 import Web3

from .constants import NETWORKS, DEFAULT_NETWORK, REGISTRY_ABI
from ._signing import address_to_agent_key

if TYPE_CHECKING:
    from .agent import SelfAgent
    from .ed25519_agent import Ed25519Agent
    from .verifier import SelfAgentVerifier

MAX_RESPONSE_CHARS = 4000

# ── SSRF prevention ──────────────────────────────────────────────────────
# The LLM controls the URL, so we must block access to internal networks,
# cloud metadata endpoints, and non-HTTPS URLs.

_BLOCKED_HOSTS = frozenset({
    "localhost", "127.0.0.1", "0.0.0.0",
    "metadata.google.internal",       # GCP
    "169.254.169.254",                 # AWS/GCP/Azure metadata
})


def _validate_url(url: str, *, allow_http: bool = False) -> None:
    """Reject non-HTTPS, internal, and private-range URLs."""
    parsed = urlparse(url)
    allowed = ("https", "http") if allow_http else ("https",)
    if parsed.scheme not in allowed:
        raise ValueError(f"Only HTTPS URLs are allowed (got {parsed.scheme!r})")
    host = parsed.hostname or ""
    if host in _BLOCKED_HOSTS or host.endswith(".internal"):
        raise ValueError(f"Blocked host: {host}")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_link_local or ip.is_loopback:
            raise ValueError(f"Blocked private/internal IP: {host}")
    except ValueError as exc:
        if "Blocked" in str(exc):
            raise
        # Not an IP literal (it's a hostname) — that's fine


# ── Pydantic input schemas for tool-calling LLMs ─────────────────────────

class AuthenticatedRequestInput(BaseModel):
    """Input schema for SelfAuthenticatedRequestTool."""
    url: str = Field(description="The HTTPS URL to send the request to")
    method: str = Field(default="GET", description="HTTP method (GET, POST, PUT, DELETE, PATCH)")
    body: Optional[dict | str] = Field(default=None, description="Optional request body (dict or string)")


class VerifyAgentInput(BaseModel):
    """Input schema for SelfVerifyAgentTool."""
    signature: str = Field(description="The agent's request signature")
    timestamp: str = Field(description="The request timestamp")
    method: str = Field(description="HTTP method used in the signed request")
    url: str = Field(description="URL used in the signed request")
    body: Optional[str] = Field(default=None, description="Request body (if any)")
    keytype: Optional[str] = Field(default=None, description="Key type, e.g. 'ed25519'")
    agent_key: Optional[str] = Field(default=None, description="Agent public key hex (for Ed25519 agents)")


class AgentInfoInput(BaseModel):
    """Input schema for SelfAgentInfoTool."""
    agent_address: str = Field(description="Ethereum address to look up (0x...)")
    network: str = Field(default="mainnet", description="Network: 'mainnet' or 'testnet'")


# ── Tools ─────────────────────────────────────────────────────────────────

class SelfAuthenticatedRequestTool(BaseTool):
    """Make authenticated HTTP requests signed with Self Agent ID."""

    name: str = "self_authenticated_request"
    description: str = (
        "Make an HTTP request authenticated with Self Agent ID. "
        "The request is cryptographically signed with the agent's key, "
        "linked to a verified human via zero-knowledge proof."
    )
    args_schema: type[BaseModel] = AuthenticatedRequestInput

    agent: Any = Field(exclude=True)
    allow_http: bool = Field(default=False, exclude=True)

    def __init__(self, agent: SelfAgent | Ed25519Agent, *, allow_http: bool = False, **kwargs: Any):
        super().__init__(agent=agent, allow_http=allow_http, **kwargs)

    def _run(self, url: str, method: str = "GET", body: dict | str | None = None) -> str:
        if not url:
            return json.dumps({"error": "URL is required"})

        method = method.upper()

        try:
            _validate_url(url, allow_http=self.allow_http)
            res = self.agent.fetch(
                url,
                method=method,
                body=json.dumps(body) if isinstance(body, dict) else body,
                headers={"Content-Type": "application/json"} if body else None,
            )
            return json.dumps({
                "status_code": res.status_code,
                "body": res.text[:MAX_RESPONSE_CHARS],
            })
        except Exception as exc:
            return json.dumps({"error": str(exc)})

    async def _arun(self, url: str, method: str = "GET", body: dict | str | None = None) -> str:
        return await asyncio.to_thread(self._run, url, method, body)


class SelfVerifyAgentTool(BaseTool):
    """Verify another agent's identity via Self Agent ID."""

    name: str = "self_verify_agent"
    description: str = (
        "Verify that an HTTP request was sent by a registered Self Agent ID agent."
    )
    args_schema: type[BaseModel] = VerifyAgentInput

    verifier: Any = Field(exclude=True)

    def __init__(self, verifier: SelfAgentVerifier, **kwargs: Any):
        super().__init__(verifier=verifier, **kwargs)

    def _run(
        self,
        signature: str,
        timestamp: str,
        method: str,
        url: str,
        body: str | None = None,
        keytype: str | None = None,
        agent_key: str | None = None,
    ) -> str:
        try:
            result = self.verifier.verify(
                signature=signature,
                timestamp=timestamp,
                method=method,
                url=url,
                body=body,
                keytype=keytype,
                agent_key_hex=agent_key,
            )
            return json.dumps({
                "valid": result.valid,
                "agent_address": result.agent_address,
                "agent_id": result.agent_id,
                "error": result.error,
            })
        except Exception as exc:
            return json.dumps({"error": str(exc)})

    async def _arun(
        self,
        signature: str,
        timestamp: str,
        method: str,
        url: str,
        body: str | None = None,
        keytype: str | None = None,
        agent_key: str | None = None,
    ) -> str:
        return await asyncio.to_thread(
            self._run, signature, timestamp, method, url, body, keytype, agent_key,
        )


class SelfAgentInfoTool(BaseTool):
    """Look up an agent's on-chain identity status."""

    name: str = "self_agent_info"
    description: str = (
        "Look up an agent's on-chain identity status in the Self Agent Registry. "
        "Returns whether the agent is verified (human-backed) and their agent ID."
    )
    args_schema: type[BaseModel] = AgentInfoInput

    _registries: dict = {}  # Cached per network

    def _get_registry(self, network: str):
        """Get or create a cached web3 contract instance for the given network."""
        if network not in self._registries:
            net_config = NETWORKS[network]
            w3 = Web3(Web3.HTTPProvider(net_config["rpc_url"]))
            self._registries[network] = w3.eth.contract(
                address=Web3.to_checksum_address(net_config["registry_address"]),
                abi=REGISTRY_ABI,
            )
        return self._registries[network]

    def _run(self, agent_address: str, network: str = "mainnet") -> str:
        if not agent_address:
            return json.dumps({"error": "agent_address is required"})

        net_config = NETWORKS.get(network)
        if not net_config:
            return json.dumps({"error": f"Unknown network: {network}. Use 'mainnet' or 'testnet'."})

        try:
            registry = self._get_registry(network)
            agent_key = address_to_agent_key(agent_address)
            is_verified = registry.functions.isVerifiedAgent(agent_key).call()

            result = {
                "address": agent_address,
                "network": network,
                "is_verified": is_verified,
            }
            if is_verified:
                result["agent_id"] = registry.functions.getAgentId(agent_key).call()
            return json.dumps(result)
        except Exception as exc:
            return json.dumps({"error": f"On-chain lookup failed: {exc}"})

    async def _arun(self, agent_address: str, network: str = "mainnet") -> str:
        return await asyncio.to_thread(self._run, agent_address, network)


class SelfAgentToolkit:
    """Bundle Self Agent ID tools for LangChain agents.

    Usage::

        toolkit = SelfAgentToolkit(agent=my_agent, verifier=my_verifier)
        tools = toolkit.get_tools()
    """

    def __init__(
        self,
        agent: SelfAgent | Ed25519Agent | None = None,
        verifier: SelfAgentVerifier | None = None,
        *,
        allow_http: bool = False,
    ):
        self.agent = agent
        self.verifier = verifier
        self.allow_http = allow_http

    def get_tools(self) -> list[BaseTool]:
        tools: list[BaseTool] = []
        if self.agent is not None:
            tools.append(SelfAuthenticatedRequestTool(
                agent=self.agent, allow_http=self.allow_http,
            ))
        if self.verifier is not None:
            tools.append(SelfVerifyAgentTool(verifier=self.verifier))
        tools.append(SelfAgentInfoTool())
        return tools


__all__ = [
    "SelfAuthenticatedRequestTool",
    "SelfVerifyAgentTool",
    "SelfAgentInfoTool",
    "SelfAgentToolkit",
]
