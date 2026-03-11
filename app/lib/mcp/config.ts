// app/lib/mcp/config.ts

import { NETWORKS } from "@selfxyz/agent-sdk";
import type { NetworkName } from "@selfxyz/agent-sdk";

export interface McpConfig {
  privateKey: string | undefined;
  network: NetworkName;
  rpcUrl: string;
  apiUrl: string;
  registryAddress: string;
}

export function loadMcpConfig(overrideNetwork?: NetworkName): McpConfig {
  const envNetwork = process.env.SELF_AGENT_NETWORK;
  const network: NetworkName =
    overrideNetwork ?? (envNetwork === "testnet" ? "testnet" : "mainnet");
  const networkConfig = NETWORKS[network];
  const apiUrl = process.env.SELF_AGENT_API_BASE || "https://app.ai.self.xyz";

  return {
    privateKey: process.env.SELF_AGENT_PRIVATE_KEY || undefined,
    network,
    rpcUrl: process.env.SELF_RPC_URL || networkConfig.rpcUrl,
    apiUrl: apiUrl.replace(/\/+$/, ""),
    registryAddress: networkConfig.registryAddress,
  };
}
