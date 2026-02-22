export { SelfAgent } from "./SelfAgent";
export type { SelfAgentConfig, AgentInfo } from "./SelfAgent";

export { SelfAgentVerifier, VerifierBuilder } from "./SelfAgentVerifier";
export type {
  VerifierConfig,
  VerificationResult,
  AgentCredentials,
  RateLimitConfig,
  VerifierFromConfig,
} from "./SelfAgentVerifier";

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
  getProviderLabel,
  getStrengthColor,
  PROVIDER_LABELS,
} from "./agentCard";
export type {
  A2AAgentCard,
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
