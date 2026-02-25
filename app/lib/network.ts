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
  hubV2Address: string;
  selfEndpointType: "celo" | "staging_celo";
  isTestnet: boolean;
  demoServiceUrl: string;
  demoAgentUrl: string;
  demoAgentAddress?: string;
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
  registryAddress: "0x60651482a3033A72128f874623Fc790061cc46D4",
  providerAddress: "0xb0F718Bad279e51A9447D36EAa457418dBd4D95b",
  agentDemoVerifierAddress: "0x404A2Bce7Dc4A9c19Cc41c4247E2bA107bce394C",
  agentGateAddress: "0xD4B30Da5319893FEAB07620DbFf0945e3aDef619",
  hubV2Address: "0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF",
  selfEndpointType: "celo",
  isTestnet: false,
  demoServiceUrl: "",
  demoAgentUrl: "",
  demoAgentAddress: "0x47a0B2c77b0c57B8d5E95Bf31D502a05211bB6FC",
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
  registryAddress: "0x29d941856134b1D053AfFF57fa560324510C79fa",
  providerAddress: "0x8e248DEB0F18B0A4b1c608F2d80dBCeB1B868F81",
  agentDemoVerifierAddress: "0x31A5A1d34728c5e6425594A596997A7Bf4aD607d",
  agentGateAddress: "0x9880Dc26c5D5aAA334e12C255a03A3Be3E50003E",
  hubV2Address: "0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74",
  selfEndpointType: "staging_celo",
  isTestnet: true,
  demoServiceUrl: "",
  demoAgentUrl: "",
  demoAgentAddress: "0xbEFb51b4c4b2B91f3685463360DD62f76aEe7ADF",
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
