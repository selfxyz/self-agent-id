# SPDX-License-Identifier: MIT

"""
CrewAI Agent with Self Agent Identity

Demonstrates a CrewAI agent that uses Self Agent ID for
authenticated, human-verified API access.

NOTE: Documentation-quality example. Adapt to your CrewAI version.
"""

import os
import json
from typing import Any

from crewai import Agent, Task, Crew
from crewai.tools import BaseTool

from self_agent_sdk import Ed25519Agent


class SelfAuthenticatedTool(BaseTool):
    """CrewAI tool for making Self Agent ID authenticated requests."""

    name: str = "authenticated_request"
    description: str = (
        "Make an HTTP request authenticated with a human-verified agent identity. "
        "Input: JSON with 'url', optional 'method' and 'body'."
    )

    def __init__(self):
        super().__init__()
        seed = os.environ.get("ED25519_SEED", "")
        if not seed:
            raise ValueError("ED25519_SEED environment variable required")
        self._agent = Ed25519Agent(
            private_key=seed,
            network=os.environ.get("SELF_NETWORK", "testnet"),
        )

    def _run(self, tool_input: str) -> str:
        try:
            params = json.loads(tool_input)
        except json.JSONDecodeError:
            params = {"url": tool_input}

        url = params.get("url", "")
        method = params.get("method", "GET")
        body = params.get("body")

        res = self._agent.fetch(
            url,
            method=method,
            body=json.dumps(body) if isinstance(body, dict) else body,
            headers={"Content-Type": "application/json"} if body else None,
        )
        return f"Status: {res.status_code}\n{res.text[:2000]}"


class SelfIdentityTool(BaseTool):
    """CrewAI tool for checking agent identity status."""

    name: str = "check_identity"
    description: str = "Check this agent's Self Agent ID registration and verification status."

    def __init__(self):
        super().__init__()
        seed = os.environ.get("ED25519_SEED", "")
        self._agent = Ed25519Agent(
            private_key=seed,
            network=os.environ.get("SELF_NETWORK", "testnet"),
        )

    def _run(self, tool_input: str = "") -> str:
        registered = self._agent.is_registered()
        if not registered:
            return "Agent not registered. Register at https://app.ai.self.xyz/register"
        info = self._agent.get_info()
        return (
            f"Registered: True\n"
            f"Agent ID: #{info.agent_id}\n"
            f"Verified: {info.is_verified}\n"
            f"Address: {info.address}"
        )


# ── Example Crew ──────────────────────────────────────────────────────────────

def create_verified_agent_crew() -> Crew:
    """Create a CrewAI crew with a Self Agent ID verified agent."""

    auth_tool = SelfAuthenticatedTool()
    identity_tool = SelfIdentityTool()

    researcher = Agent(
        role="Verified Data Researcher",
        goal="Collect data from authenticated API endpoints",
        backstory=(
            "You are a research agent with a cryptographically verified identity. "
            "You can access protected APIs that require proof of human backing."
        ),
        tools=[auth_tool, identity_tool],
        verbose=True,
    )

    task = Task(
        description=(
            "Check your agent identity status, then make an authenticated "
            "request to the Self Agent ID demo service to verify your credentials."
        ),
        expected_output="Identity status and verification result",
        agent=researcher,
    )

    return Crew(agents=[researcher], tasks=[task], verbose=True)


if __name__ == "__main__":
    crew = create_verified_agent_crew()
    result = crew.kickoff()
    print("\n=== Result ===")
    print(result)
