// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * MCP request-signing tools, which act as this server's own agent.
 *
 * Both need SELF_AGENT_PRIVATE_KEY and the privileged scope (checked by the
 * MCP route). Authenticated fetch is limited by the egress policy.
 */

import { SelfAgent } from "@selfxyz/agent-sdk";
import type { McpConfig } from "../config";
import { validateAuthenticatedFetchUrl } from "../egress";
import { OUTBOUND_TIMEOUT_MS, toolError, toolSuccess } from "../utils";
import { readTextCapped } from "@/lib/agent-api-helpers";

/** Arguments of the sign-request tool. */
interface SignRequestArgs {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  body?: string;
}

/** Arguments of the authenticated-fetch tool. */
interface AuthenticatedFetchArgs {
  method: "GET" | "POST" | "PUT" | "DELETE";
  url: string;
  body?: string;
  content_type: string;
}

/** Tool error shown when SELF_AGENT_PRIVATE_KEY is not configured. */
export const NO_AGENT_KEY_ERROR =
  "No agent identity configured on this MCP server (SELF_AGENT_PRIVATE_KEY is not set). " +
  "To create one, call self_register_agent, have the human scan the QR code, then call " +
  "self_check_registration with reveal_private_key=true once it reports completed, and " +
  "configure that key as SELF_AGENT_PRIVATE_KEY.";

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 10 * 1024;

/**
 * Sign an HTTP request as this server's agent without sending it.
 *
 * @param args.method - HTTP method.
 * @param args.url - Full request URL.
 * @param args.body - Request body, if any.
 * @param config - The request's MCP config (needs privateKey).
 * @returns Tool success `{ headers, instructions }` with the x-self-agent-*
 *   headers; tool error when no key is configured or signing fails.
 */
export async function handleSignRequest(
  args: SignRequestArgs,
  config: McpConfig,
) {
  if (!config.privateKey) return toolError(NO_AGENT_KEY_ERROR);

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
  } catch (err) {
    console.error("[mcp] sign request failed:", err);
    return toolError("Failed to sign request");
  }
}

/**
 * Send a signed HTTP request as this server's agent and return the response.
 *
 * Follows up to 3 redirects by hand, re-checking the egress policy and
 * re-signing on every hop. A redirect that turns the request into a GET
 * (303, or 301/302 after POST) drops the body and Content-Type, and the next
 * hop is signed without a body. The response body is capped at 10 KiB.
 *
 * @param args.method - HTTP method.
 * @param args.url - Target URL (must pass the egress policy).
 * @param args.body - Request body, if any.
 * @param args.content_type - Content-Type header to send with the body.
 * @param config - The request's MCP config (needs privateKey).
 * @returns Tool success `{ status, url, body, truncated }`; tool error when no
 *   key is configured, the key is malformed, egress is blocked, there are too
 *   many redirects, or on timeout / network error.
 */
export async function handleAuthenticatedFetch(
  args: AuthenticatedFetchArgs,
  config: McpConfig,
) {
  if (!config.privateKey) return toolError(NO_AGENT_KEY_ERROR);

  let agent: SelfAgent;
  try {
    agent = new SelfAgent({
      privateKey: config.privateKey,
      network: config.network,
      rpcUrl: config.rpcUrl,
    });
  } catch (err) {
    console.error("[mcp] authenticated fetch: agent setup failed:", err);
    return toolError("Authenticated fetch failed: invalid agent key");
  }

  let url = args.url;
  let method: string = args.method;
  let body = args.body;
  let headers: Record<string, string> = { "Content-Type": args.content_type };

  try {
    // Redirects are followed by hand so every hop passes the egress policy
    // before it receives freshly signed headers.
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const egressCheck = await validateAuthenticatedFetchUrl(url);
      if (!egressCheck.ok) {
        return toolError(`Authenticated fetch blocked: ${egressCheck.error}`);
      }

      const response = await agent.fetch(url, {
        method,
        body,
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      });

      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel();
        url = new URL(location, url).href;
        // Same method rewrite as fetch: 303 (and 301/302 for POST) become a
        // body-less GET, so the body's Content-Type goes too.
        if (
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) &&
            method === "POST")
        ) {
          method = "GET";
          body = undefined;
          headers = {};
        }
        continue;
      }

      const { text, truncated } = await readTextCapped(
        response,
        MAX_RESPONSE_BYTES,
      );
      return toolSuccess({
        status: response.status,
        url,
        body: text,
        truncated,
      });
    }
    return toolError(
      `Authenticated fetch failed: more than ${MAX_REDIRECTS} redirects`,
    );
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      return toolError("Authenticated fetch failed: request timed out");
    }
    return toolError("Authenticated fetch failed: network error");
  }
}
