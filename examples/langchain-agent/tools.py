# SPDX-License-Identifier: MIT

"""LangChain tools for verifying Self Agent IDs on-chain.

Reference implementation showing how to check the SelfAgentRegistry
contract from Python using web3.py.

Key pattern:
  address → agentKey (bytes32) → isVerifiedAgent() → getAgentId()
"""
import ipaddress
from urllib.parse import urlparse

import httpx
from langchain.tools import tool

# ---------------------------------------------------------------------------
# SSRF prevention — block internal, private, and non-HTTPS URLs
# ---------------------------------------------------------------------------

ALLOWED_SCHEMES = {"https"}
BLOCKED_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "metadata.google.internal"}


def _validate_url(url: str) -> str:
    """Reject non-HTTPS, internal, and private-range URLs.

    Raises ValueError if the URL is blocked.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        raise ValueError(f"Only HTTPS URLs allowed, got {parsed.scheme}")
    host = parsed.hostname or ""
    if host in BLOCKED_HOSTS or host.endswith(".internal"):
        raise ValueError(f"Blocked host: {host}")
    try:
        ip = ipaddress.ip_address(host)
        if ip.is_private or ip.is_link_local or ip.is_loopback:
            raise ValueError(f"Blocked private IP: {host}")
    except ValueError as exc:
        # If the error came from our own raise, re-raise it
        if "Blocked" in str(exc):
            raise
        # Otherwise it's a hostname (not an IP) — that's fine
    return url


@tool
def verify_peer_agent(peer_service_url: str) -> str:
    """Call a peer agent's API to check if they are human-backed.

    Args:
        peer_service_url: The HTTPS URL of the peer agent's verification endpoint.
    """
    try:
        _validate_url(peer_service_url)
    except ValueError as exc:
        return f"URL blocked: {exc}"

    try:
        response = httpx.post(
            peer_service_url,
            json={"action": "peer-verify"},
            timeout=10.0,
        )
        data = response.json()
        return f"Peer response: {data}"
    except Exception as exc:
        return f"Request failed: {exc}"


@tool
def check_agent_onchain(agent_address: str, network: str = "celo-sepolia") -> str:
    """Check if an agent address is verified on the SelfAgentRegistry.

    This performs a real on-chain lookup:
    1. Converts the address to an agentKey (bytes32)
    2. Calls isVerifiedAgent(agentKey) on the registry contract
    3. If verified, retrieves the agent ID via getAgentId(agentKey)

    Args:
        agent_address: The Ethereum address to check (0x...).
        network: Either "celo-mainnet" or "celo-sepolia".
    """
    from main import verify_agent_onchain
    result = verify_agent_onchain(agent_address.lower(), network)
    if result["verified"]:
        return (
            f"Agent {agent_address} is VERIFIED on {network}. "
            f"Agent ID: #{result['agent_id']}. "
            f"This agent is backed by a human who proved their identity via Self Protocol."
        )
    return f"Agent {agent_address} is NOT verified on {network}. Reason: {result['reason']}"
