// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// ── Server-side chain config for API routes ──────────────────────────────────
// Derived from the canonical NETWORKS in network.ts to avoid address duplication.
// API routes use chainId (number) as the lookup key since it comes from URL params.

import { NETWORKS, type NetworkConfig } from "./network";

export interface ChainConfig {
  rpc: string;
  registry: string;
  visa: string;
  blockExplorer: string;
  registryDeployBlock: number;
  visaDeployBlock: number;
}

/** Map of chainId (as string) to RPC + registry address */
export const CHAIN_CONFIG: Record<string, ChainConfig> = Object.fromEntries(
  Object.values(NETWORKS).map((net: NetworkConfig) => [
    String(net.chainId),
    {
      rpc: net.rpcUrl,
      registry: net.registryAddress,
      visa: net.visaAddress,
      blockExplorer: net.blockExplorer,
      registryDeployBlock: net.registryDeployBlock,
      visaDeployBlock: net.visaDeployBlock,
    },
  ]),
);
