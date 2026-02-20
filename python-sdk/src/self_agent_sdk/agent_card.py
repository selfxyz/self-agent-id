"""A2A Agent Card types and provider-based scoring helpers."""
from dataclasses import dataclass, field


@dataclass
class AgentSkill:
    name: str
    description: str | None = None


@dataclass
class TrustModel:
    proof_type: str  # "passport", "kyc", "govt_id", "liveness"
    sybil_resistant: bool
    ofac_screened: bool
    minimum_age_verified: int


@dataclass
class CardCredentials:
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
    if strength >= 80:
        return "green"
    if strength >= 60:
        return "blue"
    if strength >= 40:
        return "amber"
    return "gray"


def build_agent_card_dict(card: A2AAgentCard) -> dict:
    """Convert an A2AAgentCard to a JSON-serializable dict."""
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
