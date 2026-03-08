# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

"""ERC-8004 + A2A v0.3.0 Agent Card types and provider-based scoring helpers."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _slugify(s: str) -> str:
    """Slugify a string into a URL/ID-safe lowercase-hyphenated form."""
    return re.sub(r"^-|-$", "", re.sub(r"[^a-z0-9]+", "-", s.lower()))


# ─── A2A Agent Card sub-types ────────────────────────────────────────────────

@dataclass
class AgentSkill:
    """A capability or skill advertised by an A2A agent (v0.3.0).

    Attributes:
        id: Unique identifier for this skill (required per A2A v0.3.0).
        name: Short display name for the skill.
        description: Optional human-readable description.
        tags: Freeform tags for categorization.
        examples: Example prompts or inputs that exercise this skill.
        input_modes: MIME types this skill accepts. Overrides card-level defaults.
        output_modes: MIME types this skill can produce. Overrides card-level defaults.
    """

    id: str
    name: str
    description: str | None = None
    tags: list[str] | None = None
    examples: list[str] | None = None
    input_modes: list[str] | None = None
    output_modes: list[str] | None = None


@dataclass
class AgentInterface:
    """A2A v0.3.0 agent interface declaration describing a protocol endpoint.

    Attributes:
        url: The URL of this interface endpoint.
        protocol_binding: The protocol binding ("JSONRPC", "GRPC", "HTTP+JSON").
        protocol_version: The A2A protocol version, e.g. "0.3.0".
    """

    url: str
    protocol_binding: str  # "JSONRPC" | "GRPC" | "HTTP+JSON"
    protocol_version: str


@dataclass
class A2ACapabilities:
    """Feature flags describing what the A2A agent endpoint supports.

    Attributes:
        streaming: Whether the agent supports SSE streaming.
        push_notifications: Whether the agent supports push notifications.
        state_transition_history: Whether the agent exposes task state history.
        extended_agent_card: Whether the agent supports an extended card endpoint.
    """

    streaming: bool = False
    push_notifications: bool = False
    state_transition_history: bool | None = None
    extended_agent_card: bool | None = None


@dataclass
class A2AProvider:
    """Organization or individual that operates the A2A agent.

    Attributes:
        name: Display name of the provider.
        url: Optional URL for the provider.
        email: Optional contact email.
    """

    name: str
    url: str | None = None
    email: str | None = None


# ─── Security Scheme types (A2A v0.3.0 / OpenAPI-style) ─────────────────────

@dataclass
class APIKeySecurityScheme:
    """API Key authentication scheme.

    Attributes:
        name: The name of the API key header/query/cookie parameter.
        in_: Where the API key is sent ("header", "query", "cookie").
        description: Optional human-readable description.
    """

    type: str = field(default="apiKey", init=False)
    name: str = ""
    in_: str = "header"  # "header" | "query" | "cookie"
    description: str | None = None


@dataclass
class HTTPAuthSecurityScheme:
    """HTTP authentication scheme (e.g. Bearer).

    Attributes:
        scheme: The HTTP auth scheme, e.g. "bearer".
        bearer_format: Optional format of the bearer token.
        description: Optional human-readable description.
    """

    type: str = field(default="http", init=False)
    scheme: str = "bearer"
    bearer_format: str | None = None
    description: str | None = None


@dataclass
class OAuth2SecurityScheme:
    """OAuth2 authentication scheme.

    Attributes:
        flows: OAuth2 flow definitions.
        description: Optional human-readable description.
    """

    type: str = field(default="oauth2", init=False)
    flows: dict[str, Any] = field(default_factory=dict)
    description: str | None = None


@dataclass
class OpenIdConnectSecurityScheme:
    """OpenID Connect authentication scheme.

    Attributes:
        open_id_connect_url: The OpenID Connect discovery URL.
        description: Optional human-readable description.
    """

    type: str = field(default="openIdConnect", init=False)
    open_id_connect_url: str = ""
    description: str | None = None


# Union type alias
SecurityScheme = (
    APIKeySecurityScheme
    | HTTPAuthSecurityScheme
    | OAuth2SecurityScheme
    | OpenIdConnectSecurityScheme
)

# Named map of security schemes (OpenAPI-style)
SecuritySchemes = dict[str, SecurityScheme]

# A security requirement: maps scheme name to list of scopes
SecurityRequirement = dict[str, list[str]]


# ─── Signatures & Extensions ─────────────────────────────────────────────────

@dataclass
class JWSSignature:
    """RFC 7515 JWS signature attached to the agent card.

    Attributes:
        protected: The protected header (Base64url-encoded).
        signature: The JWS signature value (Base64url-encoded).
        header: Optional unprotected header parameters.
    """

    protected: str = ""
    signature: str = ""
    header: dict[str, Any] | None = None


@dataclass
class AgentExtension:
    """An agent card extension declaration.

    Attributes:
        uri: URI identifying the extension specification.
        data: Extension-specific additional data.
    """

    uri: str = ""
    data: dict[str, Any] = field(default_factory=dict)


# ─── Trust & Credentials ─────────────────────────────────────────────────────

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


# ─── ERC-8004 service entry ──────────────────────────────────────────────────

@dataclass
class ERC8004Service:
    """A service endpoint entry in the ERC-8004 agent document.

    Attributes:
        name: Service name (e.g. "web", "A2A", "MCP", "OASF", "ENS", "DID", "email").
        endpoint: Service URL.
        version: Optional service version.
    """

    name: str  # "web" | "A2A" | "MCP" | "OASF" | "ENS" | "DID" | "email" | str
    endpoint: str
    version: str | None = None


# ─── Cross-chain registration reference (CAIP-10) ───────────────────────────

@dataclass
class ERC8004Registration:
    """Cross-chain registration reference using CAIP-10 addressing.

    Attributes:
        agent_id: The agent's token ID.
        agent_registry: CAIP-10 address (eip155:<chainId>:<address>).
    """

    agent_id: int
    agent_registry: str  # CAIP-10: eip155:<chainId>:<address>


# ─── The combined ERC-8004 + A2A document ────────────────────────────────────

@dataclass
class ERC8004AgentDocument:
    """Combined ERC-8004 registration document with optional A2A Agent Card fields
    and Self Protocol on-chain proof metadata.

    Attributes:
        type: ERC-8004 document type URI.
        name: Agent display name.
        description: Agent description.
        image: Agent image/icon URL.
        services: List of service endpoints.
        active: Whether the agent is currently active.
        registrations: Cross-chain registration references.
        supported_trust: Supported trust mechanisms.
        version: Agent software version.
        url: A2A primary endpoint URL.
        provider: A2A agent provider info.
        capabilities: A2A capabilities.
        security_schemes: Named map of security schemes (A2A v0.3.0).
        security: Security requirements referencing scheme names.
        default_input_modes: Default input MIME types.
        default_output_modes: Default output MIME types.
        supported_interfaces: A2A v0.3.0 interface declarations.
        icon_url: URL to agent icon/avatar.
        documentation_url: URL to agent documentation.
        signatures: RFC 7515 JWS signatures.
        extensions: Agent card extension declarations.
        self_protocol: Self Protocol on-chain proof metadata.
        skills: A2A agent skills.
    """

    # ERC-8004 required
    type: str = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1"
    name: str = ""
    description: str = ""
    image: str = ""
    services: list[ERC8004Service] = field(default_factory=list)

    # ERC-8004 optional
    active: bool | None = None
    registrations: list[ERC8004Registration] | None = None
    supported_trust: list[str] | None = None  # "reputation" | "crypto-economic" | "tee-attestation"

    # A2A optional
    version: str | None = None
    url: str | None = None
    provider: A2AProvider | None = None
    capabilities: A2ACapabilities | None = None
    security_schemes: SecuritySchemes | None = None
    security: list[SecurityRequirement] | None = None
    default_input_modes: list[str] | None = None
    default_output_modes: list[str] | None = None
    supported_interfaces: list[AgentInterface] | None = None
    icon_url: str | None = None
    documentation_url: str | None = None
    signatures: list[JWSSignature] | None = None
    extensions: list[AgentExtension] | None = None

    # Self Protocol extension
    self_protocol: SelfProtocolExtension | None = None

    # A2A skills
    skills: list[AgentSkill] | None = None



# ─── Provider Scoring ────────────────────────────────────────────────────────

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


# ─── Serialization helpers ───────────────────────────────────────────────────

def _optional(d: dict, key: str, value: Any) -> None:
    """Add key to dict only if value is not None."""
    if value is not None:
        d[key] = value


def _serialize_skill(skill: AgentSkill) -> dict:
    """Convert an AgentSkill to a camelCase dict."""
    d: dict = {"id": skill.id, "name": skill.name}
    _optional(d, "description", skill.description)
    _optional(d, "tags", skill.tags)
    _optional(d, "examples", skill.examples)
    _optional(d, "inputModes", skill.input_modes)
    _optional(d, "outputModes", skill.output_modes)
    return d


def _serialize_interface(iface: AgentInterface) -> dict:
    """Convert an AgentInterface to a camelCase dict."""
    return {
        "url": iface.url,
        "protocolBinding": iface.protocol_binding,
        "protocolVersion": iface.protocol_version,
    }


def _serialize_security_scheme(scheme: SecurityScheme) -> dict:
    """Convert a SecurityScheme to a camelCase dict."""
    if isinstance(scheme, APIKeySecurityScheme):
        d: dict = {"type": "apiKey", "name": scheme.name, "in": scheme.in_}
        _optional(d, "description", scheme.description)
        return d
    elif isinstance(scheme, HTTPAuthSecurityScheme):
        d = {"type": "http", "scheme": scheme.scheme}
        _optional(d, "bearerFormat", scheme.bearer_format)
        _optional(d, "description", scheme.description)
        return d
    elif isinstance(scheme, OAuth2SecurityScheme):
        d = {"type": "oauth2", "flows": scheme.flows}
        _optional(d, "description", scheme.description)
        return d
    elif isinstance(scheme, OpenIdConnectSecurityScheme):
        d = {"type": "openIdConnect", "openIdConnectUrl": scheme.open_id_connect_url}
        _optional(d, "description", scheme.description)
        return d
    else:
        raise TypeError(f"Unknown security scheme type: {type(scheme)}")


def _serialize_service(svc: ERC8004Service) -> dict:
    """Convert an ERC8004Service to a camelCase dict."""
    d: dict = {"name": svc.name, "endpoint": svc.endpoint}
    _optional(d, "version", svc.version)
    return d


def _serialize_registration(reg: ERC8004Registration) -> dict:
    """Convert an ERC8004Registration to a camelCase dict."""
    return {"agentId": reg.agent_id, "agentRegistry": reg.agent_registry}


def _serialize_self_protocol(sp: SelfProtocolExtension) -> dict:
    """Convert a SelfProtocolExtension to a camelCase dict."""
    result: dict = {
        "agentId": sp.agent_id,
        "registry": sp.registry,
        "chainId": sp.chain_id,
        "proofProvider": sp.proof_provider,
        "providerName": sp.provider_name,
        "verificationStrength": sp.verification_strength,
        "trustModel": {
            "proofType": sp.trust_model.proof_type,
            "sybilResistant": sp.trust_model.sybil_resistant,
            "ofacScreened": sp.trust_model.ofac_screened,
            "minimumAgeVerified": sp.trust_model.minimum_age_verified,
        },
    }
    if sp.credentials is not None:
        creds = sp.credentials
        creds_dict: dict = {}
        _optional(creds_dict, "nationality", creds.nationality)
        _optional(creds_dict, "issuingState", creds.issuing_state)
        _optional(creds_dict, "olderThan", creds.older_than)
        _optional(creds_dict, "ofacClean", creds.ofac_clean)
        _optional(creds_dict, "hasName", creds.has_name)
        _optional(creds_dict, "hasDateOfBirth", creds.has_date_of_birth)
        _optional(creds_dict, "hasGender", creds.has_gender)
        _optional(creds_dict, "documentExpiry", creds.document_expiry)
        result["credentials"] = creds_dict
    return result


def build_agent_card_dict(card: ERC8004AgentDocument) -> dict:
    """Convert an agent card to a JSON-serializable dict.

    Produces camelCase keys matching the A2A/ERC-8004 JSON schema. Optional
    fields are omitted when ``None``.

    Args:
        card: The agent card to serialize.

    Returns:
        A dict suitable for ``json.dumps()`` or on-chain metadata storage.
    """
    doc = card
    result = {
        "type": doc.type,
        "name": doc.name,
        "description": doc.description,
        "image": doc.image,
        "services": [_serialize_service(s) for s in doc.services],
    }

    _optional(result, "active", doc.active)
    if doc.registrations is not None:
        result["registrations"] = [_serialize_registration(r) for r in doc.registrations]
    _optional(result, "supportedTrust", doc.supported_trust)
    _optional(result, "version", doc.version)
    _optional(result, "url", doc.url)
    if doc.provider is not None:
        p: dict = {"name": doc.provider.name}
        _optional(p, "url", doc.provider.url)
        _optional(p, "email", doc.provider.email)
        result["provider"] = p
    if doc.capabilities is not None:
        cap: dict = {
            "streaming": doc.capabilities.streaming,
            "pushNotifications": doc.capabilities.push_notifications,
        }
        _optional(cap, "stateTransitionHistory", doc.capabilities.state_transition_history)
        _optional(cap, "extendedAgentCard", doc.capabilities.extended_agent_card)
        result["capabilities"] = cap
    if doc.security_schemes is not None:
        result["securitySchemes"] = {
            k: _serialize_security_scheme(v) for k, v in doc.security_schemes.items()
        }
    _optional(result, "security", doc.security)
    _optional(result, "defaultInputModes", doc.default_input_modes)
    _optional(result, "defaultOutputModes", doc.default_output_modes)
    if doc.supported_interfaces is not None:
        result["supportedInterfaces"] = [_serialize_interface(i) for i in doc.supported_interfaces]
    _optional(result, "iconUrl", doc.icon_url)
    _optional(result, "documentationUrl", doc.documentation_url)
    if doc.signatures is not None:
        sigs = []
        for sig in doc.signatures:
            sd: dict = {"protected": sig.protected, "signature": sig.signature}
            _optional(sd, "header", sig.header)
            sigs.append(sd)
        result["signatures"] = sigs
    if doc.extensions is not None:
        result["extensions"] = [{"uri": e.uri, **e.data} for e in doc.extensions]
    if doc.self_protocol is not None:
        result["selfProtocol"] = _serialize_self_protocol(doc.self_protocol)
    if doc.skills is not None:
        result["skills"] = [_serialize_skill(s) for s in doc.skills]
    return result


# ─── Synchronous Registration JSON Builder ───────────────────────────────────

@dataclass
class GenerateRegistrationJSONOptions:
    """Options for building an ERC-8004 registration JSON document.

    Include the optional ``a2a`` field to make the document double as a
    valid A2A Agent Card.

    Attributes:
        name: Agent display name.
        description: Agent description.
        image: Agent image URL.
        services: Service endpoint entries.
        active: Whether the agent is active.
        registrations: Cross-chain registration references.
        supported_trust: Supported trust mechanisms.
        a2a: Optional A2A configuration to make the document A2A-compatible.
    """

    name: str = ""
    description: str = ""
    image: str = ""
    services: list[ERC8004Service] = field(default_factory=list)
    active: bool | None = None
    registrations: list[ERC8004Registration] | None = None
    supported_trust: list[str] | None = None
    a2a: A2AOptions | None = None


@dataclass
class A2AOptions:
    """A2A-specific options for generating an ERC-8004 + A2A hybrid document.

    Attributes:
        version: Agent software version.
        url: A2A primary endpoint. Must match services[name="A2A"].endpoint.
        provider: A2A provider info.
        capabilities: A2A capability flags.
        security_schemes: Named map of security schemes (A2A v0.3.0).
        security: Security requirements.
        default_input_modes: Default input MIME types.
        default_output_modes: Default output MIME types.
        skills: Agent skills.
        supported_interfaces: Interface declarations. Auto-generated from url if omitted.
        icon_url: Agent icon URL. Defaults to top-level image if omitted.
        documentation_url: Agent documentation URL.
        signatures: JWS signatures.
        extensions: Extension declarations.
    """

    version: str = ""
    url: str = ""
    provider: A2AProvider | None = None
    capabilities: A2ACapabilities | None = None
    security_schemes: SecuritySchemes | None = None
    security: list[SecurityRequirement] | None = None
    default_input_modes: list[str] | None = None
    default_output_modes: list[str] | None = None
    skills: list[AgentSkill] | None = None
    supported_interfaces: list[AgentInterface] | None = None
    icon_url: str | None = None
    documentation_url: str | None = None
    signatures: list[JWSSignature] | None = None
    extensions: list[AgentExtension] | None = None


def generate_registration_json(
    options: GenerateRegistrationJSONOptions,
) -> ERC8004AgentDocument:
    """Build an ERC-8004 registration document synchronously from plain options.

    Unlike on-chain card builders, this does not read from contracts.
    When ``options.a2a`` is provided, the returned document is also a valid
    A2A Agent Card. Skills without an explicit ``id`` will have one
    auto-generated from the skill name.

    Args:
        options: Document fields and optional A2A configuration.

    Returns:
        A populated ERC8004AgentDocument.
    """
    a2a = options.a2a

    # Auto-generate skill IDs if missing
    skills: list[AgentSkill] | None = None
    if a2a and a2a.skills:
        skills = []
        for s in a2a.skills:
            skill = AgentSkill(
                id=s.id or _slugify(s.name),
                name=s.name,
                description=s.description,
                tags=s.tags,
                examples=s.examples,
                input_modes=s.input_modes,
                output_modes=s.output_modes,
            )
            skills.append(skill)

    # Auto-generate supportedInterfaces from url if not explicitly provided
    supported_interfaces: list[AgentInterface] | None = None
    if a2a:
        if a2a.supported_interfaces:
            supported_interfaces = a2a.supported_interfaces
        else:
            supported_interfaces = [
                AgentInterface(
                    url=a2a.url,
                    protocol_binding="JSONRPC",
                    protocol_version="0.3.0",
                )
            ]

    # Ensure services array contains an A2A entry when a2a is provided
    services = list(options.services)
    if a2a and not any(s.name == "A2A" for s in services):
        services.append(ERC8004Service(name="A2A", endpoint=a2a.url, version=a2a.version))

    doc = ERC8004AgentDocument(
        type="https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        name=options.name,
        description=options.description,
        image=options.image,
        services=services,
        active=options.active,
        registrations=options.registrations,
        supported_trust=options.supported_trust,
    )

    if a2a:
        doc.version = a2a.version
        doc.url = a2a.url
        doc.provider = a2a.provider
        doc.capabilities = a2a.capabilities or A2ACapabilities(
            streaming=False,
            push_notifications=False,
            state_transition_history=False,
            extended_agent_card=False,
        )
        doc.security_schemes = a2a.security_schemes
        doc.security = a2a.security
        doc.default_input_modes = a2a.default_input_modes
        doc.default_output_modes = a2a.default_output_modes
        doc.supported_interfaces = supported_interfaces
        doc.icon_url = a2a.icon_url or options.image
        doc.documentation_url = a2a.documentation_url
        doc.signatures = a2a.signatures
        doc.extensions = a2a.extensions
        doc.skills = skills

    return doc
