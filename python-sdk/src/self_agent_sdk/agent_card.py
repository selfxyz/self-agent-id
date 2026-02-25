# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""A2A Agent Card types and provider-based scoring helpers."""
from dataclasses import dataclass, field


@dataclass
class AgentSkill:
    """A capability or skill advertised by an A2A agent.

    Attributes:
        name: Short identifier for the skill (e.g. "translation").
        description: Optional human-readable description of the skill.
    """

    name: str
    description: str | None = None


@dataclass
class TrustModel:
    """Describes the trust characteristics of an agent's human proof.

    Attributes:
        proof_type: Type of proof ("passport", "kyc", "govt_id", "liveness").
        sybil_resistant: Whether the proof prevents duplicate identities.
        ofac_screened: Whether OFAC screening was performed.
        minimum_age_verified: Minimum age threshold verified (0 if none).
    """

    proof_type: str  # "passport", "kyc", "govt_id", "liveness"
    sybil_resistant: bool
    ofac_screened: bool
    minimum_age_verified: int


@dataclass
class CardCredentials:
    """Subset of disclosed identity credentials included in an agent card.

    All fields are optional; only disclosed attributes are set.

    Attributes:
        nationality: ISO 3166-1 alpha-3 nationality code.
        issuing_state: ISO 3166-1 alpha-3 code of the document issuer.
        older_than: Verified minimum age (18 or 21).
        ofac_clean: Whether the agent passed OFAC screening.
        has_name: Whether the agent disclosed their name.
        has_date_of_birth: Whether the agent disclosed their date of birth.
        has_gender: Whether the agent disclosed their gender.
        document_expiry: Document expiry date string.
    """

    nationality: str | None = None
    issuing_state: str | None = None
    older_than: int | None = None
    ofac_clean: bool | None = None
    has_name: bool | None = None
    has_date_of_birth: bool | None = None
    has_gender: bool | None = None
    document_expiry: str | None = None


@dataclass
class SelfProtocolExtension:
    """Self Protocol metadata extension for an A2A agent card.

    Contains on-chain registry references, proof provider details,
    trust model information, and optionally disclosed credentials.

    Attributes:
        agent_id: The agent's ERC-721 token ID in the registry.
        registry: Contract address of the SelfAgentRegistry.
        chain_id: EVM chain ID where the registry is deployed.
        proof_provider: Address of the IHumanProofProvider contract.
        provider_name: Human-readable name of the proof provider.
        verification_strength: Numeric strength score (0-100).
        trust_model: Trust characteristics derived from the proof.
        credentials: Optionally disclosed identity credentials.
    """

    agent_id: int
    registry: str
    chain_id: int
    proof_provider: str
    provider_name: str
    verification_strength: int
    trust_model: TrustModel
    credentials: CardCredentials | None = None


@dataclass
class A2AAgentCard:
    """Agent-to-Agent (A2A) agent card with Self Protocol extension.

    Represents a discoverable agent identity card following the A2A
    protocol specification, enriched with Self Protocol proof-of-human
    metadata.

    Attributes:
        a2a_version: A2A protocol version (e.g. "0.1").
        name: Display name of the agent.
        self_protocol: Self Protocol extension with on-chain identity data.
        description: Optional human-readable description.
        url: Optional URL where the agent can be reached.
        capabilities: Optional list of capability identifiers.
        skills: Optional list of advertised skills.
    """

    a2a_version: str  # "0.1"
    name: str
    self_protocol: SelfProtocolExtension
    description: str | None = None
    url: str | None = None
    capabilities: list[str] | None = None
    skills: list[AgentSkill] | None = None


# ─── Provider Scoring ─────────────────────────────────────────────────────────

PROVIDER_LABELS: dict[int, str] = {
    100: "passport",
    80: "kyc",
    60: "govt_id",
    40: "liveness",
}


def get_provider_label(strength: int) -> str:
    """Map a verification strength score to a human-readable proof type label.

    Args:
        strength: Numeric verification strength (0-100).

    Returns:
        One of "passport", "kyc", "govt_id", "liveness", or "unknown".
    """
    if strength >= 100:
        return "passport"
    if strength >= 80:
        return "kyc"
    if strength >= 60:
        return "govt_id"
    if strength >= 40:
        return "liveness"
    return "unknown"


def get_strength_color(strength: int) -> str:
    """Map a verification strength score to a display color.

    Args:
        strength: Numeric verification strength (0-100).

    Returns:
        One of "green", "blue", "amber", or "gray".
    """
    if strength >= 80:
        return "green"
    if strength >= 60:
        return "blue"
    if strength >= 40:
        return "amber"
    return "gray"


def build_agent_card_dict(card: A2AAgentCard) -> dict:
    """Convert an A2AAgentCard dataclass to a JSON-serializable dict.

    Produces camelCase keys matching the A2A JSON schema. Optional fields
    are omitted when ``None``.

    Args:
        card: The agent card to serialize.

    Returns:
        A dict suitable for ``json.dumps()`` or on-chain metadata storage.
    """
    result: dict = {
        "a2aVersion": card.a2a_version,
        "name": card.name,
        "selfProtocol": {
            "agentId": card.self_protocol.agent_id,
            "registry": card.self_protocol.registry,
            "chainId": card.self_protocol.chain_id,
            "proofProvider": card.self_protocol.proof_provider,
            "providerName": card.self_protocol.provider_name,
            "verificationStrength": card.self_protocol.verification_strength,
            "trustModel": {
                "proofType": card.self_protocol.trust_model.proof_type,
                "sybilResistant": card.self_protocol.trust_model.sybil_resistant,
                "ofacScreened": card.self_protocol.trust_model.ofac_screened,
                "minimumAgeVerified": card.self_protocol.trust_model.minimum_age_verified,
            },
        },
    }
    if card.description is not None:
        result["description"] = card.description
    if card.url is not None:
        result["url"] = card.url
    if card.capabilities is not None:
        result["capabilities"] = card.capabilities
    if card.skills is not None:
        result["skills"] = [
            {"name": s.name, **({"description": s.description} if s.description else {})}
            for s in card.skills
        ]
    if card.self_protocol.credentials is not None:
        creds = card.self_protocol.credentials
        creds_dict: dict = {}
        if creds.nationality is not None:
            creds_dict["nationality"] = creds.nationality
        if creds.issuing_state is not None:
            creds_dict["issuingState"] = creds.issuing_state
        if creds.older_than is not None:
            creds_dict["olderThan"] = creds.older_than
        if creds.ofac_clean is not None:
            creds_dict["ofacClean"] = creds.ofac_clean
        if creds.has_name is not None:
            creds_dict["hasName"] = creds.has_name
        if creds.has_date_of_birth is not None:
            creds_dict["hasDateOfBirth"] = creds.has_date_of_birth
        if creds.has_gender is not None:
            creds_dict["hasGender"] = creds.has_gender
        if creds.document_expiry is not None:
            creds_dict["documentExpiry"] = creds.document_expiry
        result["selfProtocol"]["credentials"] = creds_dict
    return result
