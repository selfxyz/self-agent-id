# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""REST-based registration and deregistration flow for AI agents.

Usage:
    session = SelfAgent.request_registration(mode="agent-identity", network="mainnet")
    print(session.qr_url)              # show to human
    print(session.human_instructions)  # tell human what to do
    result = session.wait_for_completion()
    print(result.agent_id, result.agent_address)

    # Export the agent private key (only for modes that generated a keypair)
    private_key = session.export_key()
    agent = SelfAgent(private_key=private_key)
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from typing import Optional

import httpx

# Default API base URL (overridden by SELF_AGENT_API_BASE when set).
DEFAULT_API_BASE = os.environ.get("SELF_AGENT_API_BASE", "https://self-agent-id.vercel.app")

DEFAULT_TIMEOUT_MS = 30 * 60_000   # 30 minutes
DEFAULT_POLL_INTERVAL_MS = 5_000   # 5 seconds


class ExpiredSessionError(Exception):
    """Raised when a registration session expires before completion."""
    pass


@dataclass
class RegistrationResult:
    """Returned when a registration session completes successfully."""
    agent_id: int
    agent_address: str
    credentials: Optional[dict] = None
    tx_hash: Optional[str] = None


@dataclass
class RegistrationSession:
    """Tracks a pending registration initiated via the REST API.

    Call :meth:`wait_for_completion` to block until the human finishes
    the Self app flow, or poll manually using the session_token.
    """
    session_token: str
    stage: str
    qr_url: str
    deep_link: str
    agent_address: str
    expires_at: str
    time_remaining_ms: int
    human_instructions: list[str]
    _api_base: str = field(default=DEFAULT_API_BASE, repr=False)

    def wait_for_completion(
        self,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        poll_interval_ms: int = DEFAULT_POLL_INTERVAL_MS,
    ) -> RegistrationResult:
        """Poll the status endpoint until registration completes or times out.

        Raises:
            ExpiredSessionError: If the session token expires.
            RuntimeError: If the registration fails.
            TimeoutError: If the timeout is reached before completion.
        """
        deadline = time.monotonic() + timeout_ms / 1000
        token = self.session_token

        while time.monotonic() < deadline:
            resp = httpx.get(
                f"{self._api_base}/api/agent/register/status",
                params={"token": token},
            )
            data = resp.json()

            if "error" in data and "expired" in data["error"].lower():
                raise ExpiredSessionError(data["error"])

            stage = data.get("stage", "")
            token = data.get("sessionToken", token)

            if stage == "completed":
                return RegistrationResult(
                    agent_id=data.get("agentId", 0),
                    agent_address=data.get("agentAddress", ""),
                    credentials=data.get("credentials"),
                    tx_hash=data.get("txHash"),
                )
            if stage == "failed":
                raise RuntimeError(data.get("error", "Registration failed"))
            if stage == "expired":
                raise ExpiredSessionError(
                    "Session expired. Call request_registration() again to start a fresh session."
                )

            time.sleep(poll_interval_ms / 1000)

        raise TimeoutError("Registration timed out")

    def export_key(self) -> str:
        """Export the agent private key generated during registration.

        Only available for modes that created a new keypair (e.g. agent-identity,
        wallet-free). Raises RuntimeError if the server refuses.
        """
        resp = httpx.post(
            f"{self._api_base}/api/agent/register/export",
            json={"token": self.session_token},
        )
        data = resp.json()
        if "error" in data:
            raise RuntimeError(data["error"])
        return data["privateKey"]


@dataclass
class DeregistrationSession:
    """Tracks a pending deregistration initiated via the REST API."""
    session_token: str
    stage: str
    qr_url: str
    deep_link: str
    expires_at: str
    time_remaining_ms: int
    human_instructions: list[str]
    _api_base: str = field(default=DEFAULT_API_BASE, repr=False)

    def wait_for_completion(
        self,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        poll_interval_ms: int = DEFAULT_POLL_INTERVAL_MS,
    ) -> None:
        """Poll the status endpoint until deregistration completes or times out.

        Raises:
            RuntimeError: If the deregistration fails or expires.
            TimeoutError: If the timeout is reached before completion.
        """
        deadline = time.monotonic() + timeout_ms / 1000
        token = self.session_token

        while time.monotonic() < deadline:
            resp = httpx.get(
                f"{self._api_base}/api/agent/deregister/status",
                params={"token": token},
            )
            data = resp.json()

            stage = data.get("stage", "")
            token = data.get("sessionToken", token)

            if stage == "completed":
                return
            if stage == "failed":
                raise RuntimeError(data.get("error", "Deregistration failed"))
            if stage == "expired":
                raise RuntimeError(
                    "Deregistration session expired. Initiate a new deregistration."
                )

            time.sleep(poll_interval_ms / 1000)

        raise TimeoutError("Deregistration timed out")
