export const REGISTRY_ABI = [
  "function isVerifiedAgent(bytes32 agentPubKey) view returns (bool)",
  "function getAgentId(bytes32 agentPubKey) view returns (uint256)",
  "function hasHumanProof(uint256 agentId) view returns (bool)",
  "function getHumanNullifier(uint256 agentId) view returns (uint256)",
  "function getAgentCountForHuman(uint256 nullifier) view returns (uint256)",
  "function sameHuman(uint256 agentIdA, uint256 agentIdB) view returns (bool)",
  "function getProofProvider(uint256 agentId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
] as const;

/** Default signature validity window (5 minutes) */
export const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/** Default cache TTL for on-chain status (5 minutes) */
export const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

/** Request headers used by the signing protocol */
export const HEADERS = {
  PUBKEY: "x-self-agent-pubkey",
  SIGNATURE: "x-self-agent-signature",
  TIMESTAMP: "x-self-agent-timestamp",
} as const;
