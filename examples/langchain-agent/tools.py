"""LangChain tools backed by Self Agent ID."""
import os

from langchain.tools import tool
from self_agent_sdk import SelfAgent

agent = SelfAgent(private_key=os.environ["AGENT_PRIVATE_KEY"])


@tool
def verify_peer_agent(peer_service_url: str) -> str:
    """Call a peer agent's API to verify they are human-backed.

    Args:
        peer_service_url: The URL of the peer agent's verification endpoint.
    """
    response = agent.fetch(
        peer_service_url,
        method="POST",
        body='{"action": "peer-verify"}',
        headers={"Content-Type": "application/json"},
    )
    data = response.json()
    return f"Peer verified: {data.get('verified')}, Same human: {data.get('sameHuman')}"


@tool
def check_agent_status() -> str:
    """Check if this agent is registered and verified on-chain."""
    info = agent.get_info()
    return (
        f"Agent {agent.address}: verified={info.is_verified}, "
        f"id={info.agent_id}, nullifier={info.nullifier}"
    )
