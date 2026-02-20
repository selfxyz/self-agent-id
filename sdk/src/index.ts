export { SelfAgent } from "./SelfAgent";
export type { SelfAgentConfig, AgentInfo } from "./SelfAgent";

export { SelfAgentVerifier } from "./SelfAgentVerifier";
export type { VerifierConfig, VerificationResult, AgentCredentials } from "./SelfAgentVerifier";

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
