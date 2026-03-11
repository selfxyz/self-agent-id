# SPDX-License-Identifier: MIT

"""
Microsoft AutoGen Agent with Self Agent Identity

Demonstrates an AutoGen agent that uses Self Agent ID for
authenticated, human-verified API access.

NOTE: Documentation-quality example. Adapt to your AutoGen version.
"""

import os
import json
from typing import Annotated

from autogen import ConversableAgent, register_function

from self_agent_sdk import Ed25519Agent, SelfAgentVerifier


# ── Self Agent ID Setup ──────────────────────────────────────────────────────

SEED = os.environ.get("ED25519_SEED", "")
NETWORK = os.environ.get("SELF_NETWORK", "testnet")

if not SEED:
    raise ValueError("ED25519_SEED environment variable required")

self_agent = Ed25519Agent(private_key=SEED, network=NETWORK)
self_verifier = (
    SelfAgentVerifier.create()
    .network(NETWORK)
    .sybil_limit(0)
    .build()
)


# ── Tool Functions ────────────────────────────────────────────────────────────

def check_identity() -> str:
    """Check this agent's Self Agent ID registration and verification status."""
    registered = self_agent.is_registered()
    if not registered:
        return "Not registered. Register at https://app.ai.self.xyz/register"
    info = self_agent.get_info()
    return json.dumps({
        "registered": True,
        "agent_id": info.agent_id,
        "is_verified": info.is_verified,
        "address": info.address,
    })


def authenticated_request(
    url: Annotated[str, "Target URL"],
    method: Annotated[str, "HTTP method"] = "GET",
    body: Annotated[str | None, "Request body (JSON string)"] = None,
) -> str:
    """Make an HTTP request authenticated with Self Agent ID."""
    res = self_agent.fetch(
        url,
        method=method,
        body=body,
        headers={"Content-Type": "application/json"} if body else None,
    )
    return json.dumps({
        "status_code": res.status_code,
        "body": res.text[:2000],
    })


def verify_request(
    signature: Annotated[str, "x-self-agent-signature header"],
    timestamp: Annotated[str, "x-self-agent-timestamp header"],
    method: Annotated[str, "HTTP method"],
    url: Annotated[str, "Request URL"],
    body: Annotated[str | None, "Request body"] = None,
    keytype: Annotated[str | None, "Key type (ed25519 or omit for ECDSA)"] = None,
    agent_key: Annotated[str | None, "Agent public key"] = None,
) -> str:
    """Verify that an HTTP request came from a registered Self Agent ID agent."""
    result = self_verifier.verify(
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


# ── AutoGen Agent Setup ──────────────────────────────────────────────────────

def create_verified_agent() -> ConversableAgent:
    """Create an AutoGen agent with Self Agent ID tools."""

    agent = ConversableAgent(
        name="VerifiedAgent",
        system_message=(
            "You are an AI agent with a cryptographically verified identity. "
            "You are registered with Self Agent ID, which proves you are backed "
            "by a real human via zero-knowledge proof. Use your tools to make "
            "authenticated requests and verify other agents."
        ),
        llm_config={"config_list": [{"model": "gpt-4", "api_key": os.environ.get("OPENAI_API_KEY", "")}]},
    )

    executor = ConversableAgent(
        name="Executor",
        human_input_mode="NEVER",
        is_termination_msg=lambda msg: "TERMINATE" in (msg.get("content") or ""),
    )

    # Register tools
    register_function(
        check_identity,
        caller=agent,
        executor=executor,
        description="Check Self Agent ID registration status",
    )
    register_function(
        authenticated_request,
        caller=agent,
        executor=executor,
        description="Make an authenticated HTTP request",
    )
    register_function(
        verify_request,
        caller=agent,
        executor=executor,
        description="Verify another agent's identity",
    )

    return agent


if __name__ == "__main__":
    agent = create_verified_agent()
    print("Agent created with Self Agent ID tools")
    print(f"Agent address: {self_agent.address}")
    print(f"Registered: {self_agent.is_registered()}")
