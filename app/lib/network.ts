// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

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
  agentDemoVerifierEd25519Address: string;
  hubV2Address: string;
  selfEndpointType: "celo" | "staging_celo";
  isTestnet: boolean;
  demoServiceUrl: string;
  demoAgentUrl: string;
  demoAgentAddress?: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  visaAddress: string;
  registryDeployBlock: number;
  visaDeployBlock: number;
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
  registryAddress: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
  providerAddress: "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
  agentDemoVerifierAddress: "0xD8ec054FD869A762bC977AC328385142303c7def",
  agentGateAddress: "0x26e05bF632fb5bACB665ab014240EAC1413dAE35",
  agentDemoVerifierEd25519Address: "", // TODO: deploy to mainnet
  hubV2Address: "0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF",
  selfEndpointType: "celo",
  isTestnet: false,
  demoServiceUrl: "",
  demoAgentUrl: "",
  demoAgentAddress: "0xAc8BA8E6328c293Ff5aC4121E41AFb50c8D32107",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  visaAddress: "0xCa97f7586CF9De62B8ca516d7Ee25f6AEae5e109",
  registryDeployBlock: 59_965_405,
  visaDeployBlock: 62_374_264,
};

// ── Celo Sepolia (Testnet) ────────────────────────────────────────────────

const CELO_SEPOLIA: NetworkConfig = {
  id: "celo-sepolia",
  label: "Sepolia",
  chainId: 11142220,
  chainIdHex: "0xaa044c",
  rpcUrl:
    process.env.NEXT_PUBLIC_RPC_CELO_SEPOLIA ||
    "https://forno.celo-sepolia.celo-testnet.org",
  blockExplorer: "https://celo-sepolia.blockscout.com",
  registryAddress: "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
  providerAddress: "0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c",
  agentDemoVerifierAddress: "0xc31BAe8f2d7FCd19f737876892f05d9bDB294241",
  agentGateAddress: "0x86Af07e30Aa42367cbcA7f2B1764Be346598bbc2",
  agentDemoVerifierEd25519Address: "", // TODO: deploy to Sepolia
  hubV2Address: "0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74",
  selfEndpointType: "staging_celo",
  isTestnet: true,
  demoServiceUrl: "",
  demoAgentUrl: "",
  demoAgentAddress: "0x56738c05507379C38Bbfa8f75064fd344716245F",
  nativeCurrency: { name: "CELO", symbol: "CELO", decimals: 18 },
  visaAddress: "0xf049FD6260Fce964B82728A86CF1BbEB8AB3E875",
  registryDeployBlock: 18_577_934,
  visaDeployBlock: 20_973_504,
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
