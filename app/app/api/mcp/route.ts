// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/mcp — remote MCP server (Streamable HTTP via mcp-handler,
 * stateless; GET and DELETE are routed to the same handler).
 *
 * Auth: none for public tools; privileged tools (self_get_identity,
 * self_deregister_agent, self_sign_request, self_authenticated_fetch, and the
 * self://identity resource) need Authorization: Bearer <MCP_PRIVILEGED_API_KEY>
 * and use this server's SELF_AGENT_PRIVATE_KEY.
 * Rate limit: 120/min per IP; tools call the REST routes in-process as the
 * caller, so each call also counts against that route's limit. Body limit 1 MB.
 * Returns MCP JSON-RPC responses (JSON or an SSE stream). Every response,
 * including OPTIONS preflights, carries CORS headers that allow the MCP
 * transport headers (Authorization, Mcp-Protocol-Version, Mcp-Session-Id,
 * Last-Event-ID).
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { NETWORKS } from "@selfxyz/agent-sdk";
import { loadMcpConfig } from "@/lib/mcp/config";
import { toolError } from "@/lib/mcp/utils";
import { hasPrivilegedScope, verifyMcpBearerToken } from "@/lib/mcp/authz";
import {
  AGENT_CORS_HEADERS,
  extractBearerToken,
  getAppBaseUrl,
  getClientIp,
  rateLimitResponse,
  readTextCapped,
} from "@/lib/agent-api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  handleLookupAgent,
  handleListAgentsForHuman,
} from "@/lib/mcp/handlers/discovery";
import {
  handleGetIdentity,
  handleRegisterAgent,
  handleCheckRegistration,
  handleDeregisterAgent,
} from "@/lib/mcp/handlers/identity";
import {
  handleSignRequest,
  handleAuthenticatedFetch,
} from "@/lib/mcp/handlers/auth";
import {
  handleVerifyAgent,
  handleVerifyRequest,
} from "@/lib/mcp/handlers/verify";
import pkg from "@/package.json";

/** The part of mcp-handler's per-call `extra` this route reads. */
type McpExtra = {
  authInfo?: {
    scopes?: string[];
  };
};

/** Tool description suffix for public tools. */
const PUBLIC = " Public: no authorization needed.";
/** Tool description suffix for privileged tools. */
const PRIVILEGED =
  " Privileged: requires Authorization: Bearer <MCP privileged API key> and uses this server's SELF_AGENT_PRIVATE_KEY.";
/** Error text for a privileged tool or resource called without the key. */
const PRIVILEGED_MESSAGE =
  "requires privileged MCP authorization (Authorization: Bearer <MCP privileged API key>). " +
  "Self-hosted servers set MCP_PRIVILEGED_API_KEY.";

/**
 * Gate a privileged tool on the caller's bearer scope.
 *
 * @param toolName - Tool name, for the error message.
 * @param extra - mcp-handler call context carrying `authInfo`.
 * @returns null when allowed, else a tool error result to return as-is.
 */
function requirePrivilegedToolAccess(toolName: string, extra?: McpExtra) {
  if (hasPrivilegedScope(extra?.authInfo)) return null;
  return toolError(`Tool "${toolName}" ${PRIVILEGED_MESSAGE}`);
}

/** Zod schema for a 0x-prefixed, checksum-valid Ethereum address. */
const ethAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x-prefixed 20-byte hex address")
  .refine((value) => ethers.isAddress(value), "Invalid address checksum");

/**
 * Base URL of this deployment and client-IP headers of the request being
 * served, so tools call this deployment's REST routes on behalf of (and
 * rate-limited as) the MCP caller (see loadMcpConfig).
 */
const requestContext = new AsyncLocalStorage<{
  baseUrl: string;
  callerHeaders: Record<string, string>;
}>();

/**
 * mcp-handler instance registering every tool, resource and prompt. The
 * setup callback runs per request, inside `requestContext`, so the tool
 * config targets this deployment as the current caller.
 */
const baseHandler = createMcpHandler(
  (server) => {
    const context = requestContext.getStore();
    const config = loadMcpConfig(
      context?.baseUrl ?? "",
      context?.callerHeaders,
    );
    const network = z
      .enum(["mainnet", "testnet"])
      .default(config.network)
      .describe("Network to query");

    // ── Discovery tools ───────────────────────────────────────────────────

    server.tool(
      "self_lookup_agent",
      "Look up an agent's public identity by agent ID or agent address. Returns registration, verification status, proof provider and disclosed credentials." +
        PUBLIC,
      {
        agent_id: z
          .number()
          .int()
          .positive()
          .max(Number.MAX_SAFE_INTEGER)
          .optional()
          .describe("The numeric on-chain agent ID"),
        agent_address: ethAddress
          .optional()
          .describe(
            "The agent's Ethereum address (used when agent_id is omitted)",
          ),
        network,
      },
      async (args) => handleLookupAgent(args, config),
    );

    server.tool(
      "self_list_agents_for_human",
      "List the agents a wallet address owns (linked agents) plus the agent whose key is that address, if any. " +
        "Returns the agents (id, address, verification status), total_count (the number of agents listed for this wallet; " +
        "not a per-human count — for sybil checks use self_verify_agent's max_agents_per_human) " +
        "and complete=false if the list may be partial." +
        PUBLIC,
      {
        human_address: ethAddress.describe(
          "The human's Ethereum wallet address",
        ),
        network,
      },
      async (args) => handleListAgentsForHuman(args, config),
    );

    // ── Identity tools ──────────────────────────────────────────────────

    server.tool(
      "self_get_identity",
      "Check this server's configured agent: on-chain registration, verification (fresh human proof), credentials and verification strength." +
        PRIVILEGED,
      { network },
      async (args, extra) => {
        const denied = requirePrivilegedToolAccess("self_get_identity", extra);
        if (denied) return denied;
        return handleGetIdentity(args, config);
      },
    );

    server.tool(
      "self_register_agent",
      "Start registering a new agent. The server generates the agent keypair; returns a QR code / deep link for the human to scan with the Self app. " +
        "Without human_address the agent is wallet-free (mode wallet-free); with it the agent is linked to that wallet (mode linked). " +
        "Poll with self_check_registration." +
        PUBLIC,
      {
        minimum_age: z
          .union([z.literal(0), z.literal(18), z.literal(21)])
          .optional()
          .describe("Minimum age verification requirement"),
        ofac: z
          .boolean()
          .optional()
          .describe("Whether to require OFAC sanctions screening"),
        human_address: ethAddress
          .optional()
          .describe("Optional: human wallet address to link the agent to"),
        network: network.describe("Network to register on"),
      },
      async (args) => handleRegisterAgent(args, config),
    );

    server.tool(
      "self_check_registration",
      "Poll a registration started with self_register_agent. Reports the stage (qr-ready, completed, expired, failed) and a rotated session_token to use for the next poll. " +
        "Once completed, pass reveal_private_key=true to receive the new agent's private key (anyone holding the session token can export it, as with the REST export endpoint; it will appear in this conversation)." +
        PUBLIC,
      {
        session_token: z
          .string()
          .min(1)
          .max(8192)
          .describe(
            "The latest session_token from self_register_agent or self_check_registration",
          ),
        reveal_private_key: z
          .boolean()
          .default(false)
          .describe(
            "When the registration is completed, also export and return the agent private key",
          ),
      },
      async (args) => handleCheckRegistration(args, config),
    );

    server.tool(
      "self_deregister_agent",
      "Revoke this server's configured agent on-chain. This is IRREVERSIBLE. Returns a QR code / deep link for the human owner to confirm via the Self app." +
        PRIVILEGED,
      { network: network.describe("Network to deregister from") },
      async (args, extra) => {
        const denied = requirePrivilegedToolAccess(
          "self_deregister_agent",
          extra,
        );
        if (denied) return denied;
        return handleDeregisterAgent(args, config);
      },
    );

    // ── Auth tools ──────────────────────────────────────────────────────

    const httpMethod = z
      .enum(["GET", "POST", "PUT", "DELETE"])
      .describe("HTTP method");
    const requestBody = z
      .string()
      .max(100_000)
      .optional()
      .describe("Optional request body (for POST/PUT)");

    server.tool(
      "self_sign_request",
      "Generate Self Agent ID authentication headers for an HTTP request, signed as this server's agent. The receiving service can verify them to confirm the agent is backed by a real human." +
        PRIVILEGED,
      {
        method: httpMethod,
        url: z
          .string()
          .url()
          .max(2048)
          .describe("Full URL of the request to sign"),
        body: requestBody,
      },
      async (args, extra) => {
        const denied = requirePrivilegedToolAccess("self_sign_request", extra);
        if (denied) return denied;
        return handleSignRequest(args, config);
      },
    );

    server.tool(
      "self_authenticated_fetch",
      "Make an HTTP request signed as this server's agent. Private/internal network targets are blocked; redirects are followed (max 3) only to allowed targets. Returns status and up to 10KB of the body." +
        PRIVILEGED,
      {
        method: httpMethod,
        url: z
          .string()
          .url()
          .max(2048)
          .describe("Full URL to send the request to"),
        body: requestBody,
        content_type: z
          .string()
          .max(200)
          .default("application/json")
          .describe("Content-Type header value"),
      },
      async (args, extra) => {
        const denied = requirePrivilegedToolAccess(
          "self_authenticated_fetch",
          extra,
        );
        if (denied) return denied;
        return handleAuthenticatedFetch(args, config);
      },
    );

    // ── Verify tools ────────────────────────────────────────────────────

    // Both verify tools apply the same policy, matching SelfAgentVerifier
    // defaults: fresh human proof, Self provider, at most 1 agent per human.
    const policy = {
      network,
      require_age: z
        .union([z.literal(0), z.literal(18), z.literal(21)])
        .default(0)
        .describe("Minimum age requirement"),
      require_ofac: z
        .boolean()
        .default(false)
        .describe("Whether to require OFAC screening"),
      require_self_provider: z
        .boolean()
        .default(true)
        .describe("Require Self Protocol as proof provider"),
      max_agents_per_human: z
        .number()
        .int()
        .min(0)
        .max(10)
        .default(1)
        .describe(
          "Reject if the human behind the agent has more agents than this (0 = no limit)",
        ),
    };
    const POLICY_TEXT =
      " Passes only with a fresh proof-of-human and the policy parameters (defaults: Self provider required, at most 1 agent per human, no age/OFAC requirement).";

    server.tool(
      "self_verify_agent",
      "Verify whether an agent address is backed by a real human." +
        POLICY_TEXT +
        PUBLIC,
      {
        agent_address: ethAddress.describe(
          "The agent's Ethereum address to verify",
        ),
        ...policy,
      },
      async (args) => handleVerifyAgent(args, config),
    );

    server.tool(
      "self_verify_request",
      "Verify an incoming HTTP request was signed by a verified Self Agent: checks the x-self-agent-* signature, timestamp freshness (5 min), replay (per MCP server instance) and on-chain status. " +
        "Supports ECDSA (secp256k1) signed requests only; Ed25519-signed requests are not supported by this tool (verify those with the TypeScript SDK's SelfAgentVerifier)." +
        POLICY_TEXT +
        PUBLIC,
      {
        agent_address: z
          .string()
          .max(200)
          .describe("Agent address from x-self-agent-address header"),
        agent_signature: z
          .string()
          .max(1000)
          .describe("ECDSA signature from x-self-agent-signature header"),
        agent_timestamp: z
          .string()
          .max(100)
          .describe("Unix timestamp (ms) from x-self-agent-timestamp header"),
        method: z
          .string()
          .max(20)
          .describe("HTTP method of the incoming request"),
        path: z
          .string()
          .max(2048)
          .describe("Path and query of the incoming request"),
        body: z
          .string()
          .max(100_000)
          .optional()
          .describe("Request body if any"),
        ...policy,
      },
      async (args) => handleVerifyRequest(args, config),
    );

    // ── Resources ───────────────────────────────────────────────────────

    server.resource(
      "self-networks",
      "self://networks",
      {
        title: "Self Protocol Networks",
        description: "Available networks with contract addresses and RPC URLs.",
        mimeType: "application/json",
      },
      (uri) => ({
        contents: [
          {
            uri: uri.href,
            text: JSON.stringify(
              {
                current_network: config.network,
                networks: {
                  mainnet: {
                    chain_id: 42220,
                    chain_name: "Celo",
                    registry: NETWORKS.mainnet.registryAddress,
                    rpc_url: NETWORKS.mainnet.rpcUrl,
                    block_explorer: "https://celoscan.io",
                  },
                  testnet: {
                    chain_id: 11142220,
                    chain_name: "Celo Sepolia",
                    registry: NETWORKS.testnet.registryAddress,
                    rpc_url: NETWORKS.testnet.rpcUrl,
                    block_explorer: "https://celo-sepolia.blockscout.com",
                  },
                },
              },
              null,
              2,
            ),
          },
        ],
      }),
    );

    server.resource(
      "self-identity",
      "self://identity",
      {
        title: "Current Agent Identity",
        description:
          "On-chain identity of this server's configured agent (privileged).",
        mimeType: "application/json",
      },
      async (uri, extra) => {
        const result = hasPrivilegedScope(extra?.authInfo)
          ? await handleGetIdentity({}, config)
          : toolError(`This resource ${PRIVILEGED_MESSAGE}`);
        const text = result.content[0].text;
        return {
          contents: [
            {
              uri: uri.href,
              text:
                "isError" in result
                  ? JSON.stringify({ error: true, message: text }, null, 2)
                  : text,
            },
          ],
        };
      },
    );

    // ── Prompts ─────────────────────────────────────────────────────────

    server.prompt(
      "self_integrate_verification",
      "Guided prompt for adding Self Agent ID verification middleware to a web API.",
      {
        framework: z
          .string()
          .max(100)
          .describe('Web framework (e.g., "Express", "FastAPI", "Hono")'),
      },
      ({ framework }) => ({
        messages: [
          {
            role: "user" as const,
            content: {
              type: "text" as const,
              text: `I want to add Self Agent ID verification to my ${framework} API so that only registered, proof-of-human AI agents can access protected endpoints.

## How Self Agent ID Verification Works

AI agents registered with Self Protocol sign every HTTP request with three headers:
- \`x-self-agent-address\` — The agent's Ethereum address
- \`x-self-agent-signature\` — ECDSA signature over the request (timestamp + method + path/query + body hash)
- \`x-self-agent-timestamp\` — Unix timestamp in milliseconds (for replay protection)

## SDK: SelfAgentVerifier

\`\`\`typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

// verify() always requires a registered agent with a fresh proof-of-human.
const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireSelfProvider()
  .sybilLimit(1)
  .build();

const result = await verifier.verify({
  signature: req.headers["x-self-agent-signature"],
  timestamp: req.headers["x-self-agent-timestamp"],
  method: "POST",
  url: "/api/chat",
  body: '{"message": "hello"}',
});
// result.valid, result.agentAddress, result.agentId, result.error
\`\`\`

## Task

Generate a complete ${framework} middleware that:
1. Extracts the \`x-self-agent-*\` headers
2. Uses \`SelfAgentVerifier\` to verify the request (with the raw request body)
3. Rejects unauthorized requests with 401
4. Attaches verified agent info to request context
5. Includes error handling and logging`,
            },
          },
        ],
      }),
    );
  },
  { serverInfo: { name: "self-agent-id", version: pkg.version } },
  { basePath: "/api", maxDuration: 60 },
);

/** Largest accepted POST body (1 MB). */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * CORS headers for every MCP response: the agent API defaults plus the
 * methods and request headers the Streamable HTTP transport uses.
 */
const MCP_CORS_HEADERS: Record<string, string> = {
  ...AGENT_CORS_HEADERS,
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
};

/**
 * Copy a response with the MCP CORS headers added (the body, including an
 * SSE stream, is passed through untouched).
 *
 * @param res - Response to decorate.
 * @returns A new Response with the same status, body and headers plus CORS.
 */
function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [name, value] of Object.entries(MCP_CORS_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Build a JSON-RPC error response with a null id and CORS headers.
 *
 * @param status - HTTP status.
 * @param code - JSON-RPC error code.
 * @param message - Error message.
 * @returns The error Response.
 */
function jsonRpcError(status: number, code: number, message: string) {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, headers: MCP_CORS_HEADERS },
  );
}

/**
 * Default a tools/call message's missing `arguments` to {} (in place), so
 * tools whose parameters are all optional still validate.
 *
 * @param message - One parsed JSON-RPC message; anything else is ignored.
 */
function defaultToolArguments(message: unknown) {
  if (!message || typeof message !== "object") return;
  const { method, params } = message as { method?: unknown; params?: unknown };
  if (method !== "tools/call" || !params || typeof params !== "object") return;
  const p = params as { arguments?: unknown };
  p.arguments ??= {};
}

/**
 * Rate-limit, pre-parse the body, attach bearer auth and caller context, then
 * delegate to mcp-handler.
 *
 * @param req - Incoming MCP request.
 * @returns mcp-handler's response (JSON or SSE); 400 JSON-RPC -32700 parse
 *   error; 413 JSON-RPC -32600 body over 1 MB; 429 {error, retryAfterMs}.
 *   All with the MCP CORS headers.
 */
async function handler(req: NextRequest): Promise<Response> {
  const limit = await checkRateLimit({
    key: `mcp:${getClientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!limit.allowed) return withCors(rateLimitResponse(limit.retryAfterMs));

  // mcp-handler awaits req.json() outside any try/catch, so a malformed body
  // would leave the request hanging. Parse (size-capped) here first.
  let body: string | undefined;
  if (req.method === "POST") {
    if (Number(req.headers.get("content-length") || 0) > MAX_BODY_BYTES) {
      return jsonRpcError(413, -32600, "Request body too large");
    }
    const { text, truncated } = await readTextCapped(req, MAX_BODY_BYTES);
    if (truncated) return jsonRpcError(413, -32600, "Request body too large");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return jsonRpcError(400, -32700, "Parse error");
    }
    if (Array.isArray(parsed)) parsed.forEach(defaultToolArguments);
    else defaultToolArguments(parsed);
    body = JSON.stringify(parsed);
  }

  const headers = new Headers(req.headers);
  headers.delete("content-length");
  const forwarded = new Request(req.url, { method: req.method, headers, body });
  const bearer = extractBearerToken(req.headers.get("authorization"));
  const authInfo = verifyMcpBearerToken(bearer ?? undefined);
  if (authInfo) Object.assign(forwarded, { auth: authInfo });

  const callerHeaders: Record<string, string> = {};
  for (const name of ["x-real-ip", "x-forwarded-for"]) {
    const value = req.headers.get(name);
    if (value) callerHeaders[name] = value;
  }
  const res = await requestContext.run(
    { baseUrl: getAppBaseUrl(req), callerHeaders },
    () => baseHandler(forwarded),
  );
  return withCors(res);
}

/**
 * Answer the CORS preflight, allowing the MCP transport headers.
 *
 * @returns 204 with the MCP CORS headers.
 */
export function OPTIONS() {
  return new Response(null, { status: 204, headers: MCP_CORS_HEADERS });
}

export { handler as GET, handler as POST, handler as DELETE };
