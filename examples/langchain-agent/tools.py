# SPDX-License-Identifier: MIT

"""LangChain tools for the agent demo.

verify_peer_agent: Custom SSRF-protected HTTP tool (example-specific).
check_agent_onchain: Delegates to self_agent_sdk.langchain.SelfAgentInfoTool.
"""
import ipaddress
from urllib.parse import urlparse

import httpx
from langchain.tools import tool
from self_agent_sdk.langchain import SelfAgentInfoTool

ALLOWED_SCHEMES = {"https"}
BLOCKED_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "metadata.google.internal"}


def _validate_url(url: str) -> str:
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
        if "Blocked" in str(exc):
            raise
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


# On-chain agent lookup — uses the SDK's LangChain tool directly
check_agent_onchain = SelfAgentInfoTool()
