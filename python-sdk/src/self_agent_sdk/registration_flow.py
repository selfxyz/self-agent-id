# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""REST-based registration, deregistration, and proof refresh flow for AI agents.

Usage:
    session = SelfAgent.request_registration(mode="linked", network="mainnet")
    print(session.qr_url)              # show to human
    print(session.human_instructions)  # tell human what to do
    result = session.wait_for_completion()
    print(result.agent_id, result.agent_address)

    # Export the agent private key (only for modes that generated a keypair)
    private_key = session.export_key()
    agent = SelfAgent(private_key=private_key)

    # Refresh an expiring proof
    refresh = request_proof_refresh(agent_id=result.agent_id, network="mainnet")
    print(refresh.deep_link)  # have human scan in Self app
    refresh_result = refresh.wait_for_completion()
    print(refresh_result.proof_expires_at)
"""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import httpx

from .constants import NetworkName

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

        Only available for modes that created a new keypair (e.g. linked,
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


@dataclass
class RefreshResult:
    """Returned when a proof refresh session completes successfully."""
    proof_expires_at: datetime


@dataclass
class RefreshSession:
    """Tracks a pending proof refresh initiated via the REST API.

    Call :meth:`wait_for_completion` to block until the human finishes
    the Self app flow, or poll manually using the session_token.
    """
    session_token: str
    stage: str
    deep_link: str
    expires_at: str
    time_remaining_ms: int
    human_instructions: list[str]
    _api_base: str = field(default=DEFAULT_API_BASE, repr=False)

    def wait_for_completion(
        self,
        timeout_ms: int = DEFAULT_TIMEOUT_MS,
        poll_interval_ms: int = DEFAULT_POLL_INTERVAL_MS,
    ) -> RefreshResult:
        """Poll the status endpoint until proof refresh completes or times out.

        Raises:
            ExpiredSessionError: If the session token expires.
            RuntimeError: If the refresh fails.
            TimeoutError: If the timeout is reached before completion.
        """
        deadline = time.monotonic() + timeout_ms / 1000
        token = self.session_token

        while time.monotonic() < deadline:
            resp = httpx.get(
                f"{self._api_base}/api/agent/refresh/status",
                params={"token": token},
            )
            data = resp.json()

            if "error" in data and "expired" in data["error"].lower():
                raise ExpiredSessionError(
                    "Proof refresh session expired. Call request_proof_refresh() again to start a new session."
                )

            stage = data.get("stage", "")
            token = data.get("sessionToken", token)

            if stage == "completed":
                expires_at_raw = data.get("proofExpiresAt")
                if expires_at_raw:
                    proof_expires_at = datetime.fromisoformat(
                        expires_at_raw.replace("Z", "+00:00")
                    )
                else:
                    # Fallback: 1 year from now
                    proof_expires_at = datetime.fromtimestamp(
                        time.time() + 365 * 24 * 60 * 60, tz=timezone.utc,
                    )
                return RefreshResult(proof_expires_at=proof_expires_at)
            if stage == "failed":
                raise RuntimeError(data.get("error", "Proof refresh failed on-chain."))
            if stage == "expired":
                raise ExpiredSessionError(
                    "Proof refresh session expired. Call request_proof_refresh() again to start a new session."
                )

            time.sleep(poll_interval_ms / 1000)

        raise TimeoutError("Proof refresh timed out")


def request_proof_refresh(
    agent_id: int,
    *,
    network: NetworkName = "mainnet",
    disclosures: Optional[dict] = None,
    api_base: str = DEFAULT_API_BASE,
) -> RefreshSession:
    """Initiate a proof refresh for an existing agent through the Self Agent ID REST API.

    Returns a session object with a deep link for the human to scan in the Self app,
    and a polling method to wait for the new proof to be recorded on-chain.

    Args:
        agent_id: The agent's on-chain token ID to refresh the proof for.
        network: ``"mainnet"`` or ``"testnet"``.
        disclosures: Optional disclosure requirements (should match original registration).
        api_base: Base URL for the Self Agent ID API.
    """
    payload: dict = {
        "agentId": agent_id,
        "network": network,
    }
    if disclosures:
        payload["disclosures"] = disclosures

    resp = httpx.post(
        f"{api_base}/api/agent/refresh",
        json=payload,
    )
    data = resp.json()
    if "error" in data:
        raise RuntimeError(data["error"])

    return RefreshSession(
        session_token=data["sessionToken"],
        stage=data["stage"],
        deep_link=data.get("deepLink", ""),
        expires_at=data.get("expiresAt", ""),
        time_remaining_ms=data.get("timeRemainingMs", 0),
        human_instructions=data.get("humanInstructions", []),
        _api_base=api_base,
    )
