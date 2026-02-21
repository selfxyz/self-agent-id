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
  demoAgentAddress?: string;
  registrationChallengeMode: "legacy-human-only" | "chain-and-contract";
  nativeCurrency: { name: string; symbol: string; decimals: number };
}

// ── Celo Mainnet ──────────────────────────────────────────────────────────
// All addresses hardcoded — update here on redeploy.

const CELO_MAINNET: NetworkConfig = {
  id: "celo-mainnet",
  label: "Celo",
  chainId: 42220,
  chainIdHex: "0xa4ec",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_CELO || "https://forno.celo.org",
  blockExplorer: "https://celoscan.io",
  registryAddress: "0x62e37d0f6c5f67784b8828b3df68bcdbb2e55095",
  providerAddress: "0x0B43f87aE9F2AE2a50b3698573B614fc6643A084",
  agentDemoVerifierAddress: "0x0aA08262b0Bd2d07ab15ffc8FFfF3D256291e0b2",
  agentGateAddress: "0x2d710190e018fCf006E38eEB869b25C5F7d82424",
  hubV2Address: "0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF",
  selfEndpointType: "celo",
  isTestnet: false,
  demoServiceUrl: "",
  demoAgentUrl: "",
  demoAgentAddress: process.env.NEXT_PUBLIC_DEMO_AGENT_ADDRESS_CELO || undefined,
  registrationChallengeMode: "legacy-human-only",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
};

// ── Celo Sepolia (Testnet) ────────────────────────────────────────────────

const CELO_SEPOLIA: NetworkConfig = {
  id: "celo-sepolia",
  label: "Sepolia",
  chainId: 11142220,
  chainIdHex: "0xaa044c",
  rpcUrl: process.env.NEXT_PUBLIC_RPC_CELO_SEPOLIA || "https://forno.celo-sepolia.celo-testnet.org",
  blockExplorer: "https://celo-sepolia.blockscout.com",
  registryAddress: "0x42cea1b318557ade212bed74fc3c7f06ec52bd5b",
  providerAddress: "0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4",
  agentDemoVerifierAddress: "0x26e05bF632fb5bACB665ab014240EAC1413dAE35",
  agentGateAddress: "0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577",
  hubV2Address: "0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74",
  selfEndpointType: "staging_celo",
  isTestnet: true,
  demoServiceUrl: "",
  demoAgentUrl: "",
  demoAgentAddress: process.env.NEXT_PUBLIC_DEMO_AGENT_ADDRESS_CELO_SEPOLIA || undefined,
  registrationChallengeMode: "legacy-human-only",
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
