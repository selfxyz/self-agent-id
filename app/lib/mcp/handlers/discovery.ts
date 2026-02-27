// app/lib/mcp/handlers/discovery.ts

import { getAgentInfo, getAgentsForHuman } from "@selfxyz/agent-sdk";
import type { McpConfig } from "../config";
import {
  toolError,
  toolSuccess,
  formatCredentialsSummary,
  formatAgentInfo,
} from "../utils";

interface LookupAgentArgs {
  agent_id?: number;
  agent_address?: string;
  network?: "mainnet" | "testnet";
}

interface ListAgentsForHumanArgs {
  human_address: string;
  network?: "mainnet" | "testnet";
}

export async function handleLookupAgent(
  args: LookupAgentArgs,
  config: McpConfig,
) {
  const { agent_id, agent_address, network = config.network } = args;

  if (agent_id == null && !agent_address) {
    return toolError(
      "Provide agent_id (the numeric on-chain ID) to look up an agent. " +
        "If you only have an address, use self_list_agents_for_human to find the agent_id first.",
    );
  }

  if (agent_id == null && agent_address) {
    return toolError(
      "Looking up by address alone is not supported. " +
        "Use self_list_agents_for_human with the human_address to find agent IDs, " +
        "then call self_lookup_agent with the agent_id.",
    );
  }

  try {
    const info = await getAgentInfo(agent_id!, {
      network,
      apiBase: config.apiUrl,
    });
    const formatted = formatAgentInfo(
      info as unknown as Record<string, unknown>,
    );
    const credentialsSummary = formatCredentialsSummary(info.credentials);
    return toolSuccess({ ...formatted, credentialsSummary });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to look up agent #${agent_id}: ${message}`);
  }
}

export async function handleListAgentsForHuman(
  args: ListAgentsForHumanArgs,
  config: McpConfig,
) {
  const { human_address, network = config.network } = args;

  try {
    const result = await getAgentsForHuman(human_address, {
      network,
      apiBase: config.apiUrl,
    });
    return toolSuccess(result as unknown as Record<string, unknown>);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to list agents for ${human_address}: ${message}`);
  }
}
