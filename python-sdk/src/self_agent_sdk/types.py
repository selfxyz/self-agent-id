# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""Data types for agent identity, credentials, and verification results."""

from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional


@dataclass
class AgentInfo:
    """On-chain agent identity information retrieved from the registry.

    Attributes:
        address: The agent's Ethereum address.
        agent_key: 32-byte key derived from the agent address.
        agent_id: The agent's ERC-721 token ID in the registry.
        is_verified: Whether the agent has a valid human proof.
        nullifier: The human's nullifier (unique per human, shared across agents).
        agent_count: Number of agents registered by the same human.
        proof_expires_at: Unix timestamp (seconds) when the proof expires (0 if unset).
        is_proof_fresh: Whether the on-chain proof is still fresh (not expired).
        days_until_expiry: Days until proof expires (-1 if no expiry set).
        is_expiring_soon: Whether the proof expires within 30 days.
        sibling_agent_ids: Token IDs of other agents registered by the same human.
    """

    address: str
    agent_key: bytes            # 32 bytes
    agent_id: int
    is_verified: bool
    nullifier: int
    agent_count: int
    proof_expires_at: int = 0
    is_proof_fresh: bool = False
    days_until_expiry: int = -1
    is_expiring_soon: bool = False
    sibling_agent_ids: list[int] = field(default_factory=list)


@dataclass
class AgentCredentials:
    """Disclosed passport/identity credentials for a registered agent.

    All fields default to empty/zero values when not disclosed during
    registration. The ``ofac`` list contains three booleans corresponding
    to the three OFAC screening tiers.

    Attributes:
        issuing_state: ISO 3166-1 alpha-3 country code of the issuing state.
        name: List of name components (e.g. [first, last]).
        id_number: Document ID number (if disclosed).
        nationality: ISO 3166-1 alpha-3 nationality code.
        date_of_birth: Date of birth as a string (YYMMDD format).
        gender: Gender field from the identity document.
        expiry_date: Document expiry date as a string (YYMMDD format).
        older_than: Minimum age verified (0, 18, or 21).
        ofac: Three-element OFAC screening result flags.
    """

    issuing_state: str = ""
    name: list[str] = field(default_factory=list)
    id_number: str = ""
    nationality: str = ""
    date_of_birth: str = ""
    gender: str = ""
    expiry_date: str = ""
    older_than: int = 0
    ofac: list[bool] = field(default_factory=lambda: [False, False, False])


@dataclass
class VerificationResult:
    """Result of verifying an agent's signed request.

    Returned by the middleware after validating the signature, checking
    on-chain registration, and optionally fetching credentials.

    Attributes:
        valid: Whether the verification succeeded.
        agent_address: Ethereum address recovered from the request signature.
        agent_key: 32-byte key derived from agent_address.
        agent_id: The agent's ERC-721 token ID (0 if not registered).
        agent_count: Number of agents registered by the same human.
        nullifier: The human's nullifier for rate-limiting by identity.
        credentials: Disclosed credentials, if available.
        error: Human-readable error message on failure.
        retry_after_ms: Backoff hint in milliseconds when rate-limited.
        proof_expires_at: When the agent's human proof expires (None if no expiry set).
        days_until_expiry: Days until proof expires (None if no expiry set, negative if expired).
        is_expiring_soon: Whether the proof expires within 30 days.
    """

    valid: bool
    agent_address: str          # Recovered from signature
    agent_key: bytes            # 32 bytes, derived from agent_address
    agent_id: int
    agent_count: int
    nullifier: int = 0          # Human's nullifier (for rate limiting by human identity)
    credentials: AgentCredentials | None = None
    error: str | None = None
    retry_after_ms: int | None = None  # Only set when rate limited
    proof_expires_at: Optional[datetime] = None
    days_until_expiry: Optional[int] = None
    is_expiring_soon: bool = False
