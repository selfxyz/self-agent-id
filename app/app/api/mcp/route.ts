// app/app/api/mcp/route.ts
//
// Remote MCP endpoint — Streamable HTTP transport via mcp-handler.
// Exposes Self Agent ID tools for identity management, verification, and auth.

import { z } from "zod";
import { createMcpHandler } from "mcp-handler";
import { NETWORKS } from "@selfxyz/agent-sdk";
import { loadMcpConfig } from "@/lib/mcp/config";
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

const handler = createMcpHandler(
  (server) => {
    const config = loadMcpConfig();

    // ── Discovery tools ───────────────────────────────────────────────────

    server.tool(
      "self_lookup_agent",
      "Look up any agent's public identity by agent ID. Returns registration status, credentials, and verification details. No private key required.",
      {
        agent_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("The numeric on-chain agent ID"),
        agent_address: z
          .string()
          .startsWith("0x")
          .optional()
          .describe(
            "The agent's Ethereum address (use agent_id when possible)",
          ),
        network: z
          .enum(["mainnet", "testnet"])
          .default(config.network)
          .describe("Network to query"),
      },
      async (args) => handleLookupAgent(args, config),
    );

    server.tool(
      "self_list_agents_for_human",
      "Check how many agents a specific human has registered (sybil detection). Returns all agent IDs associated with a human's wallet address.",
      {
        human_address: z
          .string()
          .startsWith("0x")
          .describe("The human's Ethereum wallet address"),
        network: z
          .enum(["mainnet", "testnet"])
          .default(config.network)
          .describe("Network to query"),
      },
      async (args) => handleListAgentsForHuman(args, config),
    );

    // ── Identity tools ──────────────────────────────────────────────────

    server.tool(
      "self_get_identity",
      "Check the current agent's on-chain identity status, credentials, and verification strength. Requires SELF_AGENT_PRIVATE_KEY.",
      {
        network: z
          .enum(["mainnet", "testnet"])
          .default(config.network)
          .describe("Network to query"),
      },
      async (args) => handleGetIdentity(args, config),
    );

    server.tool(
      "self_register_agent",
      "Initiate a new agent registration. Returns a QR code / deep link for the human owner to scan with the Self app. Use self_check_registration to poll for completion.",
      {
        minimum_age: z
          .union([z.literal(0), z.literal(18), z.literal(21)])
          .optional()
          .describe("Minimum age verification requirement"),
        ofac: z
          .boolean()
          .optional()
          .describe("Whether to require OFAC sanctions screening"),
        human_address: z
          .string()
          .startsWith("0x")
          .optional()
          .describe(
            "Optional: specific human wallet address to bind the agent to",
          ),
        network: z
          .enum(["mainnet", "testnet"])
          .default(config.network)
          .describe("Network to register on"),
      },
      async (args) => handleRegisterAgent(args, config),
    );

    server.tool(
      "self_check_registration",
      "Poll for the completion of a pending agent registration. Use after self_register_agent to check if the human has scanned the QR code.",
      {
        session_token: z
          .string()
          .describe("The session_token returned from self_register_agent"),
      },
      async (args) => handleCheckRegistration(args, config),
    );

    server.tool(
      "self_deregister_agent",
      "Revoke the current agent's on-chain identity. This is IRREVERSIBLE. Returns a QR code / deep link for the human owner to confirm via the Self app. Requires SELF_AGENT_PRIVATE_KEY.",
      {
        network: z
          .enum(["mainnet", "testnet"])
          .default(config.network)
          .describe("Network to deregister from"),
      },
      async (args) => handleDeregisterAgent(args, config),
    );

    // ── Auth tools ──────────────────────────────────────────────────────

    server.tool(
      "self_sign_request",
      "Generate Self Agent ID authentication headers for an HTTP request. The receiving service can verify these to confirm this agent is backed by a real human. Requires SELF_AGENT_PRIVATE_KEY.",
      {
        method: z
          .enum(["GET", "POST", "PUT", "DELETE"])
          .describe("HTTP method"),
        url: z.string().url().describe("Full URL of the request to sign"),
        body: z
          .string()
          .optional()
          .describe("Optional request body (for POST/PUT)"),
      },
      async (args) => handleSignRequest(args, config),
    );

    server.tool(
      "self_authenticated_fetch",
      "Make an HTTP request with Self Agent ID authentication automatically applied. Use instead of self_sign_request when you want the server to make the request directly. Requires SELF_AGENT_PRIVATE_KEY.",
      {
        method: z
          .enum(["GET", "POST", "PUT", "DELETE"])
          .describe("HTTP method"),
        url: z.string().url().describe("Full URL to send the request to"),
        body: z
          .string()
          .optional()
          .describe("Optional request body (for POST/PUT)"),
        content_type: z
          .string()
          .default("application/json")
          .describe("Content-Type header value"),
      },
      async (args) => handleAuthenticatedFetch(args, config),
    );

    // ── Verify tools ────────────────────────────────────────────────────

    server.tool(
      "self_verify_agent",
      "Verify whether another agent is backed by a real human. Checks on-chain registration, proof provider, sybil count, proof expiry, and optionally credentials. No private key required.",
      {
        agent_address: z
          .string()
          .startsWith("0x")
          .describe("The agent's Ethereum address to verify"),
        network: z
          .enum(["mainnet", "testnet"])
          .default(config.network)
          .describe("Network to query"),
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
      },
      async (args) => handleVerifyAgent(args, config),
    );

    server.tool(
      "self_verify_request",
      "Verify an incoming HTTP request was made by a verified Self Agent. Checks x-self-agent-* headers for valid signature, timestamp freshness, and on-chain registration.",
      {
        agent_address: z
          .string()
          .startsWith("0x")
          .describe("Agent address from x-self-agent-address header"),
        agent_signature: z
          .string()
          .startsWith("0x")
          .describe("ECDSA signature from x-self-agent-signature header"),
        agent_timestamp: z
          .string()
          .describe("Unix timestamp (ms) from x-self-agent-timestamp header"),
        method: z.string().describe("HTTP method of the incoming request"),
        path: z.string().describe("Path and query of the incoming request"),
        body: z.string().optional().describe("Request body if any"),
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
      async (uri) => ({
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
          "On-chain identity of the configured agent (requires SELF_AGENT_PRIVATE_KEY).",
        mimeType: "application/json",
      },
      async (uri) => {
        if (!config.privateKey) {
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify(
                  {
                    configured: false,
                    message:
                      "No agent identity configured. Set SELF_AGENT_PRIVATE_KEY.",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        try {
          const { SelfAgent: SA } = await import("@selfxyz/agent-sdk");
          const agent = new SA({
            privateKey: config.privateKey,
            network: config.network,
            rpcUrl: config.rpcUrl,
          });
          const registered = await agent.isRegistered();
          if (!registered) {
            return {
              contents: [
                {
                  uri: uri.href,
                  text: JSON.stringify(
                    {
                      configured: true,
                      registered: false,
                      address: agent.address,
                      network: config.network,
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          }
          const [info, credentials] = await Promise.all([
            agent.getInfo(),
            agent.getCredentials(),
          ]);
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify(
                  {
                    configured: true,
                    registered: true,
                    address: info.address,
                    agent_id:
                      typeof info.agentId === "bigint"
                        ? Number(info.agentId)
                        : info.agentId,
                    agent_key: info.agentKey,
                    is_verified: info.isVerified,
                    network: config.network,
                    credentials: credentials ?? null,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return {
            contents: [
              {
                uri: uri.href,
                text: JSON.stringify(
                  {
                    configured: true,
                    error: true,
                    message: `Failed to fetch identity: ${message}`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      },
    );

    // ── Prompts ─────────────────────────────────────────────────────────

    server.prompt(
      "self_integrate_verification",
      "Guided prompt for adding Self Agent ID verification middleware to a web API.",
      {
        framework: z
          .string()
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
- \`x-self-agent-signature\` — ECDSA signature over the request (method + URL + body + timestamp)
- \`x-self-agent-timestamp\` — Unix timestamp in milliseconds (for replay protection)

## SDK: SelfAgentVerifier

\`\`\`typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireProofOfHuman(true)
  .build();

const result = await verifier.verify({
  signature: "0x...",
  timestamp: "1700000000000",
  method: "POST",
  url: "/api/chat",
  body: '{"message": "hello"}',
});
\`\`\`

## Task

Generate a complete ${framework} middleware that:
1. Extracts the three \`x-self-agent-*\` headers
2. Uses \`SelfAgentVerifier\` to verify the request
3. Rejects unauthorized requests with 401
4. Attaches verified agent info to request context
5. Includes error handling and logging`,
            },
          },
        ],
      }),
    );
  },
  {},
  { basePath: "/api", maxDuration: 60 },
);

export { handler as GET, handler as POST, handler as DELETE };
