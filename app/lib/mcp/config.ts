// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Per-request MCP server config, read from environment variables.
 *
 * SELF_AGENT_NETWORK picks mainnet (default) or testnet; SELF_RPC_URL
 * overrides that network's RPC; SELF_AGENT_API_BASE sends REST calls to
 * another deployment instead of in-process.
 */

import { NETWORKS } from "@selfxyz/agent-sdk";
import type { NetworkName } from "@selfxyz/agent-sdk";
import { trimTrailingSlashes } from "@/lib/agent-api-helpers";

/** Config every MCP tool handler receives. */
export interface McpConfig {
  /** SELF_AGENT_PRIVATE_KEY: the server's own agent key (privileged tools only). */
  privateKey: string | undefined;
  network: NetworkName;
  rpcUrl: string;
  registryAddress: string;
  /** This deployment's public base URL (getAppBaseUrl). */
  appUrl: string;
  /**
   * SELF_AGENT_API_BASE: call that deployment's REST API over HTTP. Unset (the
   * default), tools call this deployment's route handlers in-process.
   */
  apiUrl?: string;
  /** Client-IP headers of the MCP request, passed to in-process route calls. */
  callerHeaders: Record<string, string>;
}

/**
 * Build the MCP config for one request from the environment.
 *
 * @param appBaseUrl - This deployment's public base URL (getAppBaseUrl).
 * @param callerHeaders - x-real-ip / x-forwarded-for of the MCP request, so
 * the REST routes' per-IP limits apply to each MCP caller rather than to
 * this server.
 * @returns The resolved config (trailing slashes stripped from apiUrl).
 */
export function loadMcpConfig(
  appBaseUrl: string,
  callerHeaders: Record<string, string> = {},
): McpConfig {
  const network: NetworkName =
    process.env.SELF_AGENT_NETWORK === "testnet" ? "testnet" : "mainnet";
  const networkConfig = NETWORKS[network];
  const remote = process.env.SELF_AGENT_API_BASE
    ? trimTrailingSlashes(process.env.SELF_AGENT_API_BASE)
    : undefined;

  return {
    privateKey: process.env.SELF_AGENT_PRIVATE_KEY || undefined,
    network,
    rpcUrl: process.env.SELF_RPC_URL || networkConfig.rpcUrl,
    registryAddress: networkConfig.registryAddress,
    appUrl: appBaseUrl,
    ...(remote ? { apiUrl: remote } : {}),
    callerHeaders,
  };
}

/**
 * Pick the RPC URL for a network.
 *
 * SELF_RPC_URL only applies to the configured network; any other network
 * uses the SDK default.
 *
 * @param config - The request's MCP config.
 * @param network - Network to get an RPC URL for.
 * @returns The RPC URL.
 */
export function rpcUrlFor(config: McpConfig, network: NetworkName): string {
  return network === config.network ? config.rpcUrl : NETWORKS[network].rpcUrl;
}
