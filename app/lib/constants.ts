// ── Legacy exports (kept for API route server-side usage) ─────────────
// Client components should use useNetwork() from NetworkContext instead.

export const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_SELF_ENDPOINT!;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://forno.celo-sepolia.celo-testnet.org";

// Minimal ABI for reading SelfAgentRegistry state
export const REGISTRY_ABI = [
  "function isVerifiedAgent(bytes32 agentPubKey) view returns (bool)",
  "function getAgentId(bytes32 agentPubKey) view returns (uint256)",
  "function hasHumanProof(uint256 agentId) view returns (bool)",
  "function getHumanNullifier(uint256 agentId) view returns (uint256)",
  "function getAgentCountForHuman(uint256 nullifier) view returns (uint256)",
  "function sameHuman(uint256 agentIdA, uint256 agentIdB) view returns (bool)",
  "function agentRegisteredAt(uint256 agentId) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function scope() view returns (uint256)",
  "function agentIdToPubkey(uint256 agentId) view returns (bytes32)",
  "function agentHasHumanProof(uint256 agentId) view returns (bool)",
  "function agentProofProvider(uint256 agentId) view returns (address)",
  // V4 additions
  "function agentGuardian(uint256 agentId) view returns (address)",
  "function getAgentMetadata(uint256 agentId) view returns (string)",
  "function guardianRevoke(uint256 agentId)",
  "function selfDeregister(uint256 agentId)",
  "function updateAgentMetadata(uint256 agentId, string metadata)",
  // V5: ZK-attested credentials
  "function getAgentCredentials(uint256 agentId) view returns ((string issuingState, string[] name, string idNumber, string nationality, string dateOfBirth, string gender, string expiryDate, uint256 olderThan, bool[3] ofac))",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
] as const;

// Provider ABI — used to query provider metadata
export const PROVIDER_ABI = [
  "function providerName() view returns (string)",
  "function verificationStrength() view returns (uint8)",
] as const;

// AgentDemoVerifier V2 — EIP-712 meta-tx contract
export const AGENT_DEMO_VERIFIER_ABI = [
  "function metaVerifyAgent(bytes32 agentKey, uint256 nonce, uint256 deadline, bytes signature) returns (uint256 agentId)",
  "function checkAccess(bytes32 agentKey) view returns (uint256 agentId)",
  "function hasVerified(bytes32 agentKey) view returns (bool)",
  "function verificationCount(bytes32 agentKey) view returns (uint256)",
  "function nonces(bytes32 agentKey) view returns (uint256)",
  "function totalVerifications() view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function registry() view returns (address)",
  "error NotVerifiedAgent()",
  "error MetaTxExpired()",
  "error MetaTxInvalidNonce()",
  "error MetaTxInvalidSignature()",
  "event AgentChainVerified(bytes32 indexed agentKey, uint256 indexed agentId)",
  "event VerificationCompleted(bytes32 indexed agentKey, uint256 agentCount, uint256 totalCount)",
  "event GasSponsored(address indexed relayer, bytes32 indexed agentKey)",
] as const;

// AgentGate demo contract
export const AGENT_GATE_ABI = [
  "function checkAccess(bytes32 agentKey) view returns (uint256 agentId, uint256 olderThan, string nationality)",
  "function gatedAction(bytes32 agentKey)",
  "function registry() view returns (address)",
  "error NotVerifiedAgent()",
  "error AgeRequirementNotMet(uint256 actual, uint256 required)",
  "event AccessGranted(bytes32 indexed agentKey, uint256 agentId, uint256 olderThan)",
] as const;

// Account Abstraction
export const ENTRYPOINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
