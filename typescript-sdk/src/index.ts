// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

export { SelfAgent } from "./SelfAgent";
export type { SelfAgentConfig, AgentInfo } from "./SelfAgent";

export {
  SelfAgentVerifier,
  VerifierBuilder,
  verifyAgent,
} from "./SelfAgentVerifier";
export type {
  VerifierConfig,
  VerificationResult,
  AgentCredentials,
  RateLimitConfig,
  VerifierFromConfig,
} from "./SelfAgentVerifier";

export { isProofExpiringSoon, EXPIRY_WARNING_THRESHOLD_SECS } from "./types";
export type { VerifyResult } from "./types";

export {
  getRegistrationConfigIndex,
  computeRegistrationChallengeHash,
  signRegistrationChallenge,
  buildSimpleRegisterUserDataAscii,
  buildSimpleDeregisterUserDataAscii,
  buildAdvancedRegisterUserDataAscii,
  buildAdvancedDeregisterUserDataAscii,
  buildWalletFreeRegisterUserDataAscii,
  buildSimpleRegisterUserDataBinary,
  buildSimpleDeregisterUserDataBinary,
  buildAdvancedRegisterUserDataBinary,
  buildAdvancedDeregisterUserDataBinary,
  buildWalletFreeRegisterUserDataBinary,
} from "./registration";
export type {
  RegistrationMode,
  RegistrationDisclosures,
  RegistrationChallengeInput,
  RegistrationSignatureParts,
  SignedRegistrationChallenge,
} from "./registration";

export {
  buildAgentCard,
  generateRegistrationJSON,
  getProviderLabel,
  getStrengthColor,
  PROVIDER_LABELS,
} from "./agentCard";
export type {
  A2AAgentCard,
  ERC8004AgentDocument,
  A2ACapabilities,
  A2AProvider,
  A2ASecurityScheme,
  ERC8004Service,
  ERC8004Registration,
  GenerateRegistrationJSONOptions,
  SelfProtocolExtension,
  TrustModel,
  CardCredentials,
  AgentSkill,
} from "./agentCard";

export {
  HEADERS,
  REGISTRY_ABI,
  PROVIDER_ABI,
  NETWORKS,
  DEFAULT_NETWORK,
  DEFAULT_REGISTRY_ADDRESS,
  DEFAULT_RPC_URL,
} from "./constants";
export type { NetworkName } from "./constants";

export {
  requestRegistration,
  requestDeregistration,
  getAgentInfo,
  getAgentsForHuman,
  ExpiredSessionError,
  RegistrationError,
} from "./registration-flow";
export type {
  RegistrationRequest,
  RegistrationSession,
  RegistrationResult,
  DeregistrationRequest,
  DeregistrationSession,
  ApiAgentInfo,
  ApiAgentsForHuman,
} from "./registration-flow";
