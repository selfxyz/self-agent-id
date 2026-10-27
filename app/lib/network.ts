// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Canonical per-network config (Celo mainnet and Celo Sepolia).
 *
 * All contract addresses are hardcoded here; update them on redeploy.
 * chain-config.ts and agent-api-helpers.ts derive their lookups from this.
 */

/** Network key used across the app. */
export type NetworkId = "celo-mainnet" | "celo-sepolia";

/** Chain, RPC, explorer and contract addresses for one network. */
export interface NetworkConfig {
  id: NetworkId;
  /** Short display name ("Celo" / "Sepolia"). */
  label: string;
  chainId: number;
  /** Default RPC; overridable via NEXT_PUBLIC_RPC_CELO(_SEPOLIA). */
  rpcUrl: string;
  blockExplorer: string;
  registryAddress: string;
  /** Self proof provider contract. */
  providerAddress: string;
  visaAddress: string;
  /** Self app endpoint type: production ("celo") or staging ("staging_celo"). */
  selfEndpointType: "celo" | "staging_celo";
  isTestnet: boolean;
}

// ── Celo Mainnet ──────────────────────────────────────────────────────────

const CELO_MAINNET: NetworkConfig = {
  id: "celo-mainnet",
  label: "Celo",
  chainId: 42220,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_CELO || "https://forno.celo.org",
  blockExplorer: "https://celoscan.io",
  registryAddress: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
  providerAddress: "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
  visaAddress: "0xCa97f7586CF9De62B8ca516d7Ee25f6AEae5e109",
  selfEndpointType: "celo",
  isTestnet: false,
};

// ── Celo Sepolia (Testnet) ────────────────────────────────────────────────

const CELO_SEPOLIA: NetworkConfig = {
  id: "celo-sepolia",
  label: "Sepolia",
  chainId: 11142220,
  rpcUrl:
    process.env.NEXT_PUBLIC_RPC_CELO_SEPOLIA ||
    "https://forno.celo-sepolia.celo-testnet.org",
  blockExplorer: "https://celo-sepolia.blockscout.com",
  registryAddress: "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
  providerAddress: "0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c",
  visaAddress: "0xf049FD6260Fce964B82728A86CF1BbEB8AB3E875",
  selfEndpointType: "staging_celo",
  isTestnet: true,
};

// ── Exports ───────────────────────────────────────────────────────────────

/** Every supported network, keyed by NetworkId. */
export const NETWORKS: Record<NetworkId, NetworkConfig> = {
  "celo-mainnet": CELO_MAINNET,
  "celo-sepolia": CELO_SEPOLIA,
};

/** NEXT_PUBLIC_DEFAULT_NETWORK when it names a known network, else celo-mainnet. */
export const DEFAULT_NETWORK: NetworkId = Object.hasOwn(
  NETWORKS,
  process.env.NEXT_PUBLIC_DEFAULT_NETWORK ?? "",
)
  ? (process.env.NEXT_PUBLIC_DEFAULT_NETWORK as NetworkId)
  : "celo-mainnet";
