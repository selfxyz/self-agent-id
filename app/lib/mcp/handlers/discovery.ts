// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * MCP lookup tools: look up one agent, list a human's agents.
 *
 * Both are public (no privileged scope) and go through the REST routes so
 * per-IP limits and response shapes match the API.
 */

import { ethers } from "ethers";
import { rpcUrlFor, type McpConfig } from "../config";
import {
  apiErrorText,
  apiFetch,
  formatCredentialsSummary,
  INVALID_AGENT_ADDRESS_ERROR,
  toolError,
  toolSuccess,
} from "../utils";
import { typedRegistry } from "@/lib/contract-types";
import { getNetworkConfig, parseAddress } from "@/lib/agent-api-helpers";
import { GET as infoGET } from "@/app/api/agent/info/[chainId]/[agentId]/route";
import { GET as agentsGET } from "@/app/api/agent/agents/[chainId]/[address]/route";
import { NETWORKS } from "@selfxyz/agent-sdk";

/** Arguments of the agent lookup tool (agent_id or agent_address). */
interface LookupAgentArgs {
  agent_id?: number;
  agent_address?: string;
  network?: "mainnet" | "testnet";
}

/** Arguments of the list-agents-for-human tool. */
interface ListAgentsForHumanArgs {
  human_address: string;
  network?: "mainnet" | "testnet";
}

/**
 * Look up one agent by agent ID or agent address.
 *
 * An address is first resolved to an agent ID on-chain (getAgentId), then the
 * agent is read via GET /api/agent/info.
 *
 * @param args.agent_id - Agent ID (takes precedence).
 * @param args.agent_address - Agent's EVM address.
 * @param args.network - Network (default: the server's configured network).
 * @param config - The request's MCP config.
 * @returns Tool success with the info route's body plus `credentialsSummary`;
 *   tool error when neither argument is given, agent_address is malformed,
 *   the agent is not found, or the lookup fails.
 */
export async function handleLookupAgent(
  args: LookupAgentArgs,
  config: McpConfig,
) {
  const { agent_address, network = config.network } = args;
  let agentId = args.agent_id;

  if (agentId == null && !agent_address) {
    return toolError("Provide agent_id or agent_address.");
  }
  let address: string | null = null;
  if (agentId == null) {
    address = parseAddress(agent_address);
    if (!address) {
      return toolError(INVALID_AGENT_ADDRESS_ERROR);
    }
  }

  try {
    if (agentId == null) {
      const registry = typedRegistry(
        NETWORKS[network].registryAddress,
        new ethers.JsonRpcProvider(rpcUrlFor(config, network)),
      );
      const id = await registry.getAgentId(ethers.zeroPadValue(address!, 32));
      if (id === 0n) {
        return toolError(
          `No agent is registered for address ${address} on ${network}.`,
        );
      }
      agentId = Number(id);
    }

    const params = {
      chainId: String(getNetworkConfig(network).chainId),
      agentId: String(agentId),
    };
    const result = await apiFetch(
      config,
      `/api/agent/info/${params.chainId}/${params.agentId}`,
      (req) => infoGET(req, { params: Promise.resolve(params) }),
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
    console.error("[mcp] lookup agent failed:", err);
    return toolError("Failed to look up agent: upstream error");
  }
}

/**
 * List the agents a wallet owns, plus the agent whose key is that address.
 *
 * @param args.human_address - Wallet address.
 * @param args.network - Network (default: the server's configured network).
 * @param config - The request's MCP config.
 * @returns Tool success `{ human_address, network, agents, total_count,
 *   complete? }`; tool error when the route fails or is unreachable.
 */
export async function handleListAgentsForHuman(
  args: ListAgentsForHumanArgs,
  config: McpConfig,
) {
  const { human_address, network = config.network } = args;

  try {
    const params = {
      chainId: String(getNetworkConfig(network).chainId),
      address: human_address,
    };
    const result = await apiFetch(
      config,
      `/api/agent/agents/${params.chainId}/${encodeURIComponent(human_address)}`,
      (req) => agentsGET(req, { params: Promise.resolve(params) }),
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
    console.error("[mcp] list agents failed:", err);
    return toolError(
      `Failed to list agents for ${human_address}: API unreachable`,
    );
  }
}
