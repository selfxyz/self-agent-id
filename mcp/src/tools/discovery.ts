// SPDX-License-Identifier: MIT

/**
 * Lookup tools: look up one agent, list a human's agents.
 *
 * Both are public (no agent key needed) and call the REST API so response
 * shapes match it.
 */

import { ethers } from "ethers";
import { CHAIN_IDS } from "@selfxyz/agent-sdk";
import { registryFor, type ServerConfig } from "../config.js";
import {
  apiErrorText,
  apiFetch,
  formatCredentialsSummary,
  INVALID_AGENT_ADDRESS_ERROR,
  INVALID_HUMAN_ADDRESS_ERROR,
  parseAddress,
  safeErrorDescription,
  toolError,
  toolSuccess,
} from "../utils.js";

/** Arguments of the agent lookup tool (agent_id or agent_address). */
export interface LookupAgentArgs {
  agent_id?: number;
  agent_address?: string;
  network?: "mainnet" | "testnet";
}

/** Arguments of the list-agents-for-human tool. */
export interface ListAgentsForHumanArgs {
  human_address: string;
  network?: "mainnet" | "testnet";
}

/**
 * Look up one agent by agent ID or agent address.
 *
 * An address is first resolved to an agent ID on-chain (getAgentId), then the
 * agent is read via GET /api/agent/info/{chainId}/{agentId}.
 *
 * @param args.agent_id - Agent ID (takes precedence).
 * @param args.agent_address - Agent's EVM address.
 * @param args.network - Network (default: the configured network).
 * @param config - Server config.
 * @returns Tool success with the info route's body plus `credentialsSummary`;
 *   tool error when neither argument is given, agent_address is malformed,
 *   the agent is not found, or the lookup fails.
 */
export async function handleLookupAgent(
  args: LookupAgentArgs,
  config: ServerConfig,
) {
  const { agent_address, network = config.network } = args;
  let agentId = args.agent_id;

  if (agentId == null && !agent_address) {
    return toolError("Provide agent_id or agent_address.");
  }
  let address: string | null = null;
  if (agentId == null) {
    address = parseAddress(agent_address);
    if (!address) return toolError(INVALID_AGENT_ADDRESS_ERROR);
  }

  try {
    if (agentId == null) {
      const registry = registryFor(config, network);
      const id = await registry.getAgentId(ethers.zeroPadValue(address!, 32));
      if (id === 0n) {
        return toolError(
          `No agent is registered for address ${address} on ${network}.`,
        );
      }
      agentId = Number(id);
    }

    const result = await apiFetch(
      config,
      `/api/agent/info/${CHAIN_IDS[network]}/${encodeURIComponent(String(agentId))}`,
    );
    if (result.status === 404) {
      return toolError(`Agent #${agentId} not found on ${network}.`);
    }
    if (!result.ok) {
      return toolError(
        `Failed to look up agent #${agentId}: ${apiErrorText(result)}`,
      );
    }
    const info = result.data;
    const credentialsSummary = formatCredentialsSummary(
      info.credentials as Parameters<typeof formatCredentialsSummary>[0],
      info.isVerified === true,
    );
    return toolSuccess({ ...info, credentialsSummary });
  } catch (err) {
    console.error(
      "[self-agent-mcp] lookup agent failed:",
      safeErrorDescription(err),
    );
    return toolError("Failed to look up agent: upstream error");
  }
}

/**
 * List the agents a wallet owns, plus the agent whose key is that address,
 * via GET /api/agent/agents/{chainId}/{address}.
 *
 * @param args.human_address - Wallet address.
 * @param args.network - Network (default: the configured network).
 * @param config - Server config.
 * @returns Tool success `{ human_address, network, agents, total_count,
 *   complete? }`; tool error for a malformed address, or when the route
 *   fails or is unreachable.
 */
export async function handleListAgentsForHuman(
  args: ListAgentsForHumanArgs,
  config: ServerConfig,
) {
  const { human_address, network = config.network } = args;
  if (!parseAddress(human_address)) {
    return toolError(INVALID_HUMAN_ADDRESS_ERROR);
  }

  try {
    const result = await apiFetch(
      config,
      `/api/agent/agents/${CHAIN_IDS[network]}/${encodeURIComponent(human_address)}`,
    );
    if (!result.ok) {
      return toolError(
        `Failed to list agents for ${human_address}: ${apiErrorText(result)}`,
      );
    }
    const data = result.data;
    const agents = Array.isArray(data.agents) ? data.agents : [];
    return toolSuccess({
      human_address: data.humanAddress ?? human_address,
      network,
      agents,
      total_count: data.totalCount ?? agents.length,
      ...(typeof data.complete === "boolean"
        ? { complete: data.complete }
        : {}),
    });
  } catch (err) {
    console.error(
      "[self-agent-mcp] list agents failed:",
      safeErrorDescription(err),
    );
    return toolError(
      `Failed to list agents for ${human_address}: API unreachable`,
    );
  }
}
