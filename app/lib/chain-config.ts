// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Per-chain RPC and contract config for API routes, keyed by chain ID.
 *
 * Derived from NETWORKS in network.ts so addresses live in one place. Routes
 * index it with the chainId URL param (a string).
 */

import { NETWORKS, type NetworkConfig } from "./network";

/** RPC URL and contract addresses for one chain. */
export interface ChainConfig {
  rpc: string;
  registry: string;
  visa: string;
}

/**
 * Chain ID (as a string) to ChainConfig.
 *
 * Null prototype so inherited keys like "constructor" or "__proto__" are not
 * mistaken for supported chain IDs when indexed with untrusted URL params.
 */
export const CHAIN_CONFIG: Record<string, ChainConfig> = Object.assign(
  Object.create(null) as Record<string, ChainConfig>,
  Object.fromEntries(
    Object.values(NETWORKS).map((net: NetworkConfig) => [
      String(net.chainId),
      {
        rpc: net.rpcUrl,
        registry: net.registryAddress,
        visa: net.visaAddress,
      },
    ]),
  ),
);
