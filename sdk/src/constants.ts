export const REGISTRY_ABI = [
  "function isVerifiedAgent(bytes32 agentPubKey) view returns (bool)",
  "function getAgentId(bytes32 agentPubKey) view returns (uint256)",
  "function hasHumanProof(uint256 agentId) view returns (bool)",
  "function getHumanNullifier(uint256 agentId) view returns (uint256)",
  "function getAgentCountForHuman(uint256 nullifier) view returns (uint256)",
  "function sameHuman(uint256 agentIdA, uint256 agentIdB) view returns (bool)",
  "function getProofProvider(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  // V5: ZK-attested credentials
  "function getAgentCredentials(uint256 agentId) view returns ((string issuingState, string[] name, string idNumber, string nationality, string dateOfBirth, string gender, string expiryDate, uint256 olderThan, bool[3] ofac))",
] as const;

/** Default deployed SelfAgentRegistry on Celo Sepolia */
export const DEFAULT_REGISTRY_ADDRESS = "0x24D46f30d41e91B3E0d1A8EB250FEa4B90270251";

/** Default RPC URL (Celo Sepolia) */
export const DEFAULT_RPC_URL = "https://forno.celo-sepolia.celo-testnet.org";

/** Default signature validity window (5 minutes) */
export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/** Default cache TTL for on-chain status (5 minutes) */
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Request headers used by the signing protocol */
export const HEADERS = {
  /** Agent's Ethereum address (informational — identity is recovered from signature) */
  ADDRESS: "x-self-agent-address",
  /** ECDSA signature over the request */
  SIGNATURE: "x-self-agent-signature",
  /** Unix timestamp (milliseconds) for replay protection */
  TIMESTAMP: "x-self-agent-timestamp",
} as const;
