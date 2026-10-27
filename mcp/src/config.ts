// SPDX-License-Identifier: MIT

/**
 * Server config, read once from environment variables at startup.
 *
 * SELF_AGENT_NETWORK (or the older SELF_NETWORK) picks mainnet (default) or
 * testnet; SELF_RPC_URL overrides that network's RPC; SELF_AGENT_API_BASE
 * points the REST calls at another deployment; SELF_AGENT_PRIVATE_KEY
 * enables the tools that act as your agent.
 */

import { ethers } from "ethers";
import { NETWORKS, typedRegistry } from "@selfxyz/agent-sdk";
import type { NetworkName, TypedRegistryContract } from "@selfxyz/agent-sdk";

/** Default REST API base (the hosted Self Agent ID API). */
export const DEFAULT_API_BASE = "https://agent-api.self.xyz";

/** Config every tool handler receives. */
export interface ServerConfig {
  /** SELF_AGENT_PRIVATE_KEY: your agent's key (agent tools only). */
  privateKey: string | undefined;
  network: NetworkName;
  rpcUrl: string;
  /** SELF_AGENT_API_BASE without trailing slashes. */
  apiUrl: string;
}

/**
 * Build the config from the environment.
 *
 * @param env - Environment to read (default process.env).
 * @returns The resolved config.
 * @throws When the network is not "mainnet"/"testnet", SELF_AGENT_API_BASE is
 *   not an http(s) URL, or SELF_AGENT_PRIVATE_KEY is not a valid secp256k1
 *   key (the message never includes the key).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawNetwork = env.SELF_AGENT_NETWORK || env.SELF_NETWORK || "mainnet";
  if (rawNetwork !== "mainnet" && rawNetwork !== "testnet") {
    throw new Error(
      `Invalid SELF_AGENT_NETWORK: "${rawNetwork}". Expected "mainnet" or "testnet".`,
    );
  }
  const network: NetworkName = rawNetwork;

  const apiUrl = trimTrailingSlashes(
    env.SELF_AGENT_API_BASE || DEFAULT_API_BASE,
  );
  let protocol = "";
  try {
    protocol = new URL(apiUrl).protocol;
  } catch {
    // Reported below.
  }
  if (protocol !== "https:" && protocol !== "http:") {
    throw new Error("Invalid SELF_AGENT_API_BASE: expected an http(s) URL.");
  }

  const privateKey = env.SELF_AGENT_PRIVATE_KEY?.trim() || undefined;
  if (privateKey) {
    try {
      new ethers.Wallet(privateKey);
    } catch {
      // ethers echoes the key in its error text, so never rethrow it.
      throw new Error(
        "Invalid SELF_AGENT_PRIVATE_KEY: expected a 0x-prefixed 32-byte hex secp256k1 private key.",
      );
    }
  }

  return {
    privateKey,
    network,
    rpcUrl: env.SELF_RPC_URL || NETWORKS[network].rpcUrl,
    apiUrl,
  };
}

/**
 * Pick the RPC URL for a network.
 *
 * SELF_RPC_URL only applies to the configured network; any other network
 * uses the SDK default.
 *
 * @param config - Server config.
 * @param network - Network to get an RPC URL for.
 * @returns The RPC URL.
 */
export function rpcUrlFor(config: ServerConfig, network: NetworkName): string {
  return network === config.network ? config.rpcUrl : NETWORKS[network].rpcUrl;
}

/**
 * Connect to the registry contract of a network.
 *
 * @param config - Server config.
 * @param network - Network whose registry and RPC to use.
 * @returns A typed read-only registry contract.
 */
export function registryFor(
  config: ServerConfig,
  network: NetworkName,
): TypedRegistryContract {
  const provider = new ethers.JsonRpcProvider(rpcUrlFor(config, network));
  // The SDK is CommonJS and types the runner with ethers' CJS build; this ESM
  // provider is structurally identical at runtime.
  return typedRegistry(
    NETWORKS[network].registryAddress,
    provider as unknown as Parameters<typeof typedRegistry>[1],
  );
}

/**
 * Strip trailing "/" characters in linear time.
 *
 * @param url - URL or base URL.
 * @returns `url` without trailing slashes.
 */
function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}
