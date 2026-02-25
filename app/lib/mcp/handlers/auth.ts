// app/lib/mcp/handlers/auth.ts

import { SelfAgent } from "@selfxyz/agent-sdk";
import type { McpConfig } from "../config";
import { toolError, toolSuccess, truncateBody } from "../utils";

interface SignRequestArgs {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  body?: string;
}

interface AuthenticatedFetchArgs {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  body?: string;
  content_type: string;
}

export async function handleSignRequest(args: SignRequestArgs, config: McpConfig) {
  if (!config.privateKey) {
    return toolError(
      "No agent identity configured. Set SELF_AGENT_PRIVATE_KEY in your MCP server configuration, " +
        "or use self_register_agent to create a new agent identity.",
    );
  }

  try {
    const agent = new SelfAgent({
      privateKey: config.privateKey,
      network: config.network,
      rpcUrl: config.rpcUrl,
    });

    const headers = await agent.signRequest(args.method, args.url, args.body);

    return toolSuccess({
      headers,
      instructions:
        "Add these three headers to your HTTP request. " +
        "The receiving service can verify them to confirm this agent is backed by a real human.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to sign request: ${message}`);
  }
}

export async function handleAuthenticatedFetch(args: AuthenticatedFetchArgs, config: McpConfig) {
  if (!config.privateKey) {
    return toolError(
      "No agent identity configured. Set SELF_AGENT_PRIVATE_KEY in your MCP server configuration, " +
        "or use self_register_agent to create a new agent identity.",
    );
  }

  try {
    const agent = new SelfAgent({
      privateKey: config.privateKey,
      network: config.network,
      rpcUrl: config.rpcUrl,
    });

    const response = await agent.fetch(args.url, {
      method: args.method,
      body: args.body,
      headers: { "Content-Type": args.content_type },
    });

    const rawBody = await response.text();
    const { body, truncated } = truncateBody(rawBody);

    return toolSuccess({
      status: response.status,
      body,
      truncated,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Authenticated fetch failed: ${message}`);
  }
}
