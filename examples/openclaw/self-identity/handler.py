# SPDX-License-Identifier: MIT

"""
OpenClaw Skill: Self Agent Identity

Provides Ed25519-based identity for OpenClaw agents using Self Agent ID.
OpenClaw uses Ed25519 keypairs natively for device identity (Clawdentity),
making it a natural fit for Self Agent ID's Ed25519 registration.

This skill:
  1. Loads the device's existing Ed25519 keypair
  2. Registers with Self Agent ID (one-time, requires human QR scan)
  3. Signs outbound API requests for authenticated agent-to-agent communication
  4. Verifies inbound requests from other registered agents
"""

import os
import json
from typing import Any

from self_agent_sdk import Ed25519Agent, SelfAgentVerifier


class SelfIdentitySkill:
    """OpenClaw skill for Self Agent ID integration."""

    def __init__(self, config: dict[str, Any] | None = None):
        config = config or {}

        # OpenClaw stores device keys in ~/.openclaw/identity/
        key_path = config.get(
            "key_path",
            os.path.expanduser("~/.openclaw/identity/ed25519.key"),
        )

        if os.path.exists(key_path):
            with open(key_path) as f:
                self.seed = f.read().strip()
        else:
            self.seed = config.get("ed25519_seed", os.environ.get("ED25519_SEED", ""))

        if not self.seed:
            raise ValueError(
                "No Ed25519 key found. Set ED25519_SEED or provide key_path."
            )

        network = config.get("network", "testnet")
        self.agent = Ed25519Agent(private_key=self.seed, network=network)

        self.verifier = (
            SelfAgentVerifier.create()
            .network(network)
            .sybil_limit(config.get("sybil_limit", 1))
            .require_age(config.get("min_age", 0))
            .build()
        )

    @property
    def agent_address(self) -> str:
        return self.agent.address

    @property
    def agent_key(self) -> str:
        return self.agent.agent_key

    def is_registered(self) -> bool:
        """Check if this agent is registered in the Self Agent ID registry."""
        return self.agent.is_registered()

    def get_info(self) -> dict[str, Any]:
        """Get agent info from the registry."""
        info = self.agent.get_info()
        return {
            "agent_id": info.agent_id,
            "is_verified": info.is_verified,
            "address": info.address,
            "agent_key": str(info.agent_key),
        }

    def sign_request(self, method: str, url: str, body: str = "") -> dict[str, str]:
        """Sign an outbound HTTP request."""
        return self.agent.sign_request(method, url, body or None)

    def fetch(self, url: str, method: str = "GET", body: str | None = None) -> Any:
        """Make an authenticated HTTP request."""
        return self.agent.fetch(url, method=method, body=body)

    def verify_request(
        self,
        signature: str,
        timestamp: str,
        method: str,
        url: str,
        body: str | None = None,
        keytype: str | None = None,
        agent_key: str | None = None,
    ) -> dict[str, Any]:
        """Verify an inbound request from another agent."""
        result = self.verifier.verify(
            signature=signature,
            timestamp=timestamp,
            method=method,
            url=url,
            body=body,
            keytype=keytype,
            agent_key_hex=agent_key,
        )
        return {
            "valid": result.valid,
            "agent_address": result.agent_address,
            "agent_id": result.agent_id,
            "error": result.error,
        }


# ── OpenClaw skill entry point ────────────────────────────────────────────────

def handle(event: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
    """
    OpenClaw skill handler.

    Events:
      - init: Initialize the skill, check registration
      - sign: Sign a request for outbound communication
      - verify: Verify an inbound request
      - fetch: Make an authenticated request
      - info: Get agent info
    """
    skill = SelfIdentitySkill(context.get("config"))
    action = event.get("action", "info")

    if action == "init":
        registered = skill.is_registered()
        if not registered:
            return {
                "status": "unregistered",
                "message": "Register at https://app.ai.self.xyz/register",
                "agent_key": skill.agent_key,
            }
        return {"status": "ready", **skill.get_info()}

    elif action == "sign":
        headers = skill.sign_request(
            event.get("method", "GET"),
            event["url"],
            event.get("body", ""),
        )
        return {"headers": headers}

    elif action == "verify":
        return skill.verify_request(
            signature=event["signature"],
            timestamp=event["timestamp"],
            method=event.get("method", "GET"),
            url=event["url"],
            body=event.get("body"),
            keytype=event.get("keytype"),
            agent_key=event.get("agent_key"),
        )

    elif action == "fetch":
        res = skill.fetch(
            event["url"],
            method=event.get("method", "GET"),
            body=event.get("body"),
        )
        return {"status_code": res.status_code, "body": res.text}

    elif action == "demo":
        url = event.get("url", "https://app.ai.self.xyz/api/demo/agent-to-agent")
        network = event.get("network", "celo-sepolia")
        res = skill.fetch(
            f"{url}?network={network}",
            method="POST",
            body=json.dumps({"test": "openclaw-demo"}),
        )
        try:
            body = json.loads(res.text)
        except (json.JSONDecodeError, AttributeError):
            body = res.text
        return {"status_code": res.status_code, "body": body}

    elif action == "info":
        return skill.get_info()

    return {"error": f"Unknown action: {action}"}
