// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Public entry point of `@selfxyz/agent-sdk`: re-exports everything callers may import.
 *
 * Agents: `SelfAgent`, `Ed25519Agent`. Services: `SelfAgentVerifier`.
 * Registration: `requestRegistration` and friends. A2A: `A2AClient`, `A2AServer`.
 */

export { SelfAgent } from "./SelfAgent";
export type { SelfAgentConfig } from "./SelfAgent";
export type { AgentInfo } from "./agent-info";

export { Ed25519Agent } from "./Ed25519Agent";
export type { Ed25519AgentConfig } from "./Ed25519Agent";

export {
  SelfAgentVerifier,
  VerifierBuilder,
  verifyAgent,
} from "./SelfAgentVerifier";
export type {
  VerifierConfig,
  VerificationResult,
  VerifiedAgent,
  AgentCredentials,
  RateLimitConfig,
  VerifierFromConfig,
} from "./SelfAgentVerifier";

export { isProofExpiringSoon, EXPIRY_WARNING_THRESHOLD_SECS } from "./types";
export { computeSigningMessage } from "./signing";
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
  A2A_PROTOCOL_VERSION,
} from "./agentCard";
export type {
  A2AAgentCard,
  ERC8004AgentDocument,
  A2ACapabilities,
  A2AProvider,
  ERC8004Service,
  ERC8004Registration,
  GenerateRegistrationJSONOptions,
  SelfProtocolExtension,
  TrustModel,
  CardCredentials,
  AgentSkill,
  AgentInterface,
  APIKeySecurityScheme,
  HTTPAuthSecurityScheme,
  OAuth2SecurityScheme,
  OpenIdConnectSecurityScheme,
  SecurityScheme,
  SecuritySchemes,
  SecurityRequirement,
  JWSSignature,
  AgentExtension,
} from "./agentCard";

// A2A Task Protocol (JSON-RPC 2.0)
export { A2AErrorCodes, A2AClient, A2AError, A2AServer } from "./a2a";
export type {
  TextPart,
  FilePart,
  DataPart,
  Part,
  Message,
  TaskState,
  TaskStatus,
  Artifact,
  Task,
  TaskPushNotificationConfig,
  JSONRPCRequest,
  JSONRPCError,
  JSONRPCResponse,
  SendMessageParams,
  GetTaskParams,
  CancelTaskParams,
  SendMessageRequest,
  SendStreamingMessageRequest,
  GetTaskRequest,
  CancelTaskRequest,
  A2ARequest,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  A2AStreamEvent,
  A2AErrorCode,
  A2AClientOptions,
  A2AServerOptions,
  TaskHandler,
} from "./a2a";

export {
  HEADERS,
  REGISTRY_ABI,
  PROVIDER_ABI,
  NETWORKS,
  DEFAULT_NETWORK,
  DEFAULT_REGISTRY_ADDRESS,
  DEFAULT_RPC_URL,
  CHAIN_IDS,
} from "./constants";
export type { NetworkName } from "./constants";

export { typedRegistry, typedProvider } from "./contract-types";
export type {
  TypedRegistryContract,
  TypedProviderContract,
} from "./contract-types";

export {
  requestRegistration,
  requestDeregistration,
  requestProofRefresh,
  getAgentInfo,
  getAgentsForHuman,
  ExpiredSessionError,
  RegistrationError,
} from "./registration-flow";
export type {
  RegistrationRequest,
  RegistrationDisclosureRequest,
  RegistrationSession,
  RegistrationResult,
  DeregistrationRequest,
  DeregistrationSession,
  ProofRefreshRequest,
  RefreshSession,
  ApiAgentInfo,
  ApiAgentsForHuman,
} from "./registration-flow";
