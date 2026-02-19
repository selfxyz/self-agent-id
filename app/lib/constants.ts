export const REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_SELF_ENDPOINT!;
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://forno.celo-sepolia.celo-testnet.org";

export const CELO_SEPOLIA_CHAIN_ID = "0xaa044c"; // 11142220
export const CELO_SEPOLIA_CONFIG = {
  chainId: CELO_SEPOLIA_CHAIN_ID,
  chainName: "Celo Sepolia Testnet",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  rpcUrls: ["https://forno.celo-sepolia.celo-testnet.org"],
  blockExplorerUrls: ["https://celo-sepolia.blockscout.com"],
};

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
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
] as const;
