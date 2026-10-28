// SPDX-License-Identifier: MIT

/**
 * Builds the MCP server: the 10 Self Agent ID tools, the self://networks and
 * self://identity resources and the self_integrate_verification prompt.
 *
 * Tool names, schemas and descriptions match the hosted server at
 * https://agent-api.self.xyz/api/mcp. The agent tools (get identity,
 * deregister, sign request, authenticated fetch) act as the agent whose key is
 * in SELF_AGENT_PRIVATE_KEY and return a setup hint when it is unset.
 */

import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ethers } from "ethers";
import { z } from "zod";
import { NETWORKS } from "@selfxyz/agent-sdk";
import { loadConfig, type ServerConfig } from "./config.js";
import {
  handleLookupAgent,
  handleListAgentsForHuman,
} from "./tools/discovery.js";
import {
  handleGetIdentity,
  handleRegisterAgent,
  handleCheckRegistration,
  handleDeregisterAgent,
} from "./tools/identity.js";
import { handleSignRequest, handleAuthenticatedFetch } from "./tools/auth.js";
import { handleVerifyAgent, handleVerifyRequest } from "./tools/verify.js";

const { version } = createRequire(import.meta.url)("../package.json") as {
  version: string;
};

/** Tool description suffix for tools that need no agent key. */
const PUBLIC = " No agent key needed.";
/** Tool description suffix for tools that act as your agent. */
const AGENT_KEY =
  " Acts as your agent: requires SELF_AGENT_PRIVATE_KEY in this MCP server's environment.";

/** Zod schema for a 0x-prefixed, checksum-valid Ethereum address. */
const ethAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Must be a 0x-prefixed 20-byte hex address")
  .refine((value) => ethers.isAddress(value), "Invalid address checksum");

/**
 * Create the MCP server with every tool, resource and prompt registered.
 *
 * @param config - Server config (default: loadConfig() from the environment).
 * @returns The server (not yet connected) and the config it uses.
 * @throws When the environment config is invalid (see loadConfig).
 */
export function createServer(config: ServerConfig = loadConfig()): {
  server: McpServer;
  config: ServerConfig;
} {
  const server = new McpServer({ name: "self-agent-id", version });

  const network = z
    .enum(["mainnet", "testnet"])
    .default(config.network)
    .describe("Network to query");

  // ── Discovery tools ─────────────────────────────────────────────────────

  server.registerTool(
    "self_lookup_agent",
    {
      description:
        "Look up an agent's public identity by agent ID or agent address. Returns registration, verification status, proof provider and disclosed credentials." +
        PUBLIC,
      inputSchema: {
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
    },
    (args) => handleLookupAgent(args, config),
  );

  server.registerTool(
    "self_list_agents_for_human",
    {
      description:
        "List the agents a wallet address owns (linked agents) plus the agent whose key is that address, if any. " +
        "Returns the agents (id, address, verification status), total_count (the number of agents listed for this wallet; " +
        "not a per-human count: for sybil checks use self_verify_agent's max_agents_per_human) " +
        "and complete=false if the list may be partial." +
        PUBLIC,
      inputSchema: {
        human_address: ethAddress.describe(
          "The human's Ethereum wallet address",
        ),
        network,
      },
    },
    (args) => handleListAgentsForHuman(args, config),
  );

  // ── Identity tools ──────────────────────────────────────────────────────

  server.registerTool(
    "self_get_identity",
    {
      description:
        "Check your configured agent: on-chain registration, verification (fresh human proof), credentials and verification strength." +
        AGENT_KEY,
      inputSchema: { network },
    },
    (args) => handleGetIdentity(args, config),
  );

  server.registerTool(
    "self_register_agent",
    {
      description:
        "Start registering a new agent. The Self Agent ID API generates the agent keypair; returns a QR code / deep link for the human to scan with the Self app. " +
        "Without human_address the agent is wallet-free (mode wallet-free); with it the agent is linked to that wallet (mode linked). " +
        "Poll with self_check_registration." +
        PUBLIC,
      inputSchema: {
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
    },
    (args) => handleRegisterAgent(args, config),
  );

  server.registerTool(
    "self_check_registration",
    {
      description:
        "Poll a registration started with self_register_agent. Reports the stage (qr-ready, completed, expired, failed) and a rotated session_token to use for the next poll. " +
        "Once completed, pass reveal_private_key=true to receive the new agent's private key (anyone holding the session token can export it, as with the REST export endpoint; it will appear in this conversation)." +
        PUBLIC,
      inputSchema: {
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
    },
    (args) => handleCheckRegistration(args, config),
  );

  server.registerTool(
    "self_deregister_agent",
    {
      description:
        "Revoke your configured agent on-chain. This is IRREVERSIBLE. Returns a QR code / deep link for the human owner to confirm via the Self app." +
        AGENT_KEY,
      inputSchema: { network: network.describe("Network to deregister from") },
    },
    (args) => handleDeregisterAgent(args, config),
  );

  // ── Auth tools ──────────────────────────────────────────────────────────

  const httpMethod = z
    .enum(["GET", "POST", "PUT", "DELETE"])
    .describe("HTTP method");
  const requestBody = z
    .string()
    .max(100_000)
    .optional()
    .describe("Optional request body (for POST/PUT)");

  server.registerTool(
    "self_sign_request",
    {
      description:
        "Generate Self Agent ID authentication headers for an HTTP request, signed as your agent. The receiving service can verify them to confirm the agent is backed by a real human." +
        AGENT_KEY,
      inputSchema: {
        method: httpMethod,
        url: z
          .string()
          .url()
          .max(2048)
          .describe("Full URL of the request to sign"),
        body: requestBody,
      },
    },
    (args) => handleSignRequest(args, config),
  );

  server.registerTool(
    "self_authenticated_fetch",
    {
      description:
        "Make an HTTP request signed as your agent. Private/internal network targets are blocked; redirects are followed (max 3) only to allowed targets. Returns status and up to 10KB of the body." +
        AGENT_KEY,
      inputSchema: {
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
    },
    (args) => handleAuthenticatedFetch(args, config),
  );

  // ── Verify tools ────────────────────────────────────────────────────────

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

  server.registerTool(
    "self_verify_agent",
    {
      description:
        "Verify whether an agent address is backed by a real human." +
        POLICY_TEXT +
        PUBLIC,
      inputSchema: {
        agent_address: ethAddress.describe(
          "The agent's Ethereum address to verify",
        ),
        ...policy,
      },
    },
    (args) => handleVerifyAgent(args, config),
  );

  server.registerTool(
    "self_verify_request",
    {
      description:
        "Verify an incoming HTTP request was signed by a verified Self Agent: checks the x-self-agent-* signature, timestamp freshness (5 min), replay (per MCP server process) and on-chain status. " +
        "Supports ECDSA (secp256k1) signed requests only; Ed25519-signed requests are not supported by this tool (verify those with the TypeScript SDK's SelfAgentVerifier)." +
        POLICY_TEXT +
        PUBLIC,
      inputSchema: {
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
    },
    (args) => handleVerifyRequest(args, config),
  );

  // ── Resources ───────────────────────────────────────────────────────────

  server.registerResource(
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
              api_base: config.apiUrl,
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

  server.registerResource(
    "self-identity",
    "self://identity",
    {
      title: "Current Agent Identity",
      description:
        "On-chain identity of your configured agent (requires SELF_AGENT_PRIVATE_KEY).",
      mimeType: "application/json",
    },
    async (uri) => {
      const result = await handleGetIdentity({}, config);
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

  // ── Prompts ─────────────────────────────────────────────────────────────

  server.registerPrompt(
    "self_integrate_verification",
    {
      title: "Integrate Self Agent ID Verification",
      description:
        "Guided prompt for adding Self Agent ID verification middleware to a web API.",
      argsSchema: {
        framework: z
          .string()
          .max(100)
          .describe('Web framework (e.g., "Express", "FastAPI", "Hono")'),
      },
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
- \`x-self-agent-address\`: the agent's Ethereum address
- \`x-self-agent-signature\`: ECDSA signature over the request (timestamp + method + path/query + body hash)
- \`x-self-agent-timestamp\`: Unix timestamp in milliseconds (for replay protection)

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

  return { server, config };
}
