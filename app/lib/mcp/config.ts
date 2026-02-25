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

export function loadMcpConfig(): McpConfig {
  const network: NetworkName = "mainnet";
  const networkConfig = NETWORKS[network];
  const apiUrl =
    process.env.SELF_AGENT_API_BASE ||
    "https://self-agent-id.vercel.app";

  return {
    privateKey: process.env.SELF_AGENT_PRIVATE_KEY || undefined,
    network,
    rpcUrl: process.env.SELF_RPC_URL || networkConfig.rpcUrl,
    apiUrl: apiUrl.replace(/\/+$/, ""),
    registryAddress: networkConfig.registryAddress,
  };
}
