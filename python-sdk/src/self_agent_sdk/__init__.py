# SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
# SPDX-License-Identifier: BUSL-1.1
# NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

from .agent import SelfAgent
from .ed25519_agent import Ed25519Agent
from .verifier import SelfAgentVerifier, VerifierBuilder, RateLimiter
from .constants import HEADERS, NETWORKS, DEFAULT_NETWORK, REGISTRY_ABI, PROVIDER_ABI
from .types import (
    AgentInfo, VerificationResult, AgentCredentials,
)
from .agent_card import (
    SelfProtocolExtension, TrustModel, CardCredentials, AgentSkill,
    AgentInterface, A2ACapabilities, A2AProvider,
    APIKeySecurityScheme, HTTPAuthSecurityScheme, OAuth2SecurityScheme,
    OpenIdConnectSecurityScheme,
    JWSSignature, AgentExtension,
    ERC8004Service, ERC8004Registration, ERC8004AgentDocument,
    GenerateRegistrationJSONOptions, A2AOptions,
    PROVIDER_LABELS, get_provider_label, get_strength_color, build_agent_card_dict,
    generate_registration_json,
)
from .registration import (
    SignedRegistrationChallenge,
    get_registration_config_index,
    compute_registration_challenge_hash,
    sign_registration_challenge,
    build_simple_register_user_data_ascii,
    build_simple_deregister_user_data_ascii,
    build_advanced_register_user_data_ascii,
    build_advanced_deregister_user_data_ascii,
    build_wallet_free_register_user_data_ascii,
)
from .registration_flow import (
    RegistrationSession,
    RegistrationResult,
    DeregistrationSession,
    ExpiredSessionError,
    DEFAULT_API_BASE,
)

__all__ = [
    "SelfAgent", "Ed25519Agent", "SelfAgentVerifier", "VerifierBuilder", "RateLimiter",
    "HEADERS", "NETWORKS", "DEFAULT_NETWORK", "REGISTRY_ABI", "PROVIDER_ABI",
    "AgentInfo", "VerificationResult", "AgentCredentials",
    "A2AAgentCard", "SelfProtocolExtension", "TrustModel", "CardCredentials", "AgentSkill",
    "AgentInterface", "A2ACapabilities", "A2AProvider",
    "APIKeySecurityScheme", "HTTPAuthSecurityScheme", "OAuth2SecurityScheme",
    "OpenIdConnectSecurityScheme",
    "JWSSignature", "AgentExtension",
    "ERC8004Service", "ERC8004Registration", "ERC8004AgentDocument",
    "GenerateRegistrationJSONOptions", "A2AOptions",
    "PROVIDER_LABELS", "get_provider_label", "get_strength_color", "build_agent_card_dict",
    "generate_registration_json",
    "SignedRegistrationChallenge",
    "get_registration_config_index",
    "compute_registration_challenge_hash",
    "sign_registration_challenge",
    "build_simple_register_user_data_ascii",
    "build_simple_deregister_user_data_ascii",
    "build_advanced_register_user_data_ascii",
    "build_advanced_deregister_user_data_ascii",
    "build_wallet_free_register_user_data_ascii",
    "RegistrationSession",
    "RegistrationResult",
    "DeregistrationSession",
    "ExpiredSessionError",
    "DEFAULT_API_BASE",
]
