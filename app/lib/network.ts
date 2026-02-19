// ── Network configuration for multi-chain support ─────────────────────────

export type NetworkId = "celo-mainnet" | "celo-sepolia";

export interface NetworkConfig {
  id: NetworkId;
  label: string;
  chainId: number;
  chainIdHex: string;
  rpcUrl: string;
  blockExplorer: string;
  registryAddress: string;
  providerAddress: string;
  agentDemoVerifierAddress: string;
  agentGateAddress: string;
  hubV2Address: string;
  selfEndpointType: "celo" | "staging_celo";
  isTestnet: boolean;
  demoServiceUrl: string;
  demoAgentUrl: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

// ── Celo Mainnet ──────────────────────────────────────────────────────────

const CELO_MAINNET: NetworkConfig = {
  id: "celo-mainnet",
  label: "Celo",
  chainId: 42220,
  chainIdHex: "0xa4ec",
  rpcUrl: "https://forno.celo.org",
  blockExplorer: "https://celoscan.io",
  // Placeholder addresses — will be filled after mainnet deployment
  registryAddress: process.env.NEXT_PUBLIC_MAINNET_REGISTRY || "",
  providerAddress: process.env.NEXT_PUBLIC_MAINNET_PROVIDER || "",
  agentDemoVerifierAddress: process.env.NEXT_PUBLIC_MAINNET_DEMO_VERIFIER || "",
  agentGateAddress: process.env.NEXT_PUBLIC_MAINNET_AGENT_GATE || "",
  hubV2Address: "0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF",
  selfEndpointType: "celo",
  isTestnet: false,
  demoServiceUrl: process.env.NEXT_PUBLIC_MAINNET_DEMO_SERVICE_URL || "",
  demoAgentUrl: process.env.NEXT_PUBLIC_MAINNET_DEMO_AGENT_URL || "",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
};

// ── Celo Sepolia (Testnet) ────────────────────────────────────────────────

const CELO_SEPOLIA: NetworkConfig = {
  id: "celo-sepolia",
  label: "Sepolia",
  chainId: 11142220,
  chainIdHex: "0xaa044c",
  rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
  blockExplorer: "https://celo-sepolia.blockscout.com",
  registryAddress: process.env.NEXT_PUBLIC_SELF_ENDPOINT || "0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b",
  providerAddress: "0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4",
  agentDemoVerifierAddress: "0x26e05bF632fb5bACB665ab014240EAC1413dAE35",
  agentGateAddress: "0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577",
  hubV2Address: "0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74",
  selfEndpointType: "staging_celo",
  isTestnet: true,
  demoServiceUrl: process.env.NEXT_PUBLIC_DEMO_SERVICE_URL || "",
  demoAgentUrl: process.env.NEXT_PUBLIC_DEMO_AGENT_URL || "",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
};

// ── Exports ───────────────────────────────────────────────────────────────

export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  "celo-mainnet": CELO_MAINNET,
  "celo-sepolia": CELO_SEPOLIA,
};

export const DEFAULT_NETWORK: NetworkId =
  (process.env.NEXT_PUBLIC_DEFAULT_NETWORK as NetworkId) || "celo-mainnet";

export function getNetwork(id: NetworkId): NetworkConfig {
  return NETWORKS[id];
}

/** Check if a given network has all required contract addresses configured */
export function isNetworkReady(config: NetworkConfig): boolean {
  return !!config.registryAddress;
}
