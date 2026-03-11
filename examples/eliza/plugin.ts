// SPDX-License-Identifier: MIT

/**
 * Eliza (ai16z) Plugin: Self Agent Identity
 *
 * Integrates Self Agent ID with Eliza agents. Eliza agents on Solana
 * already use Ed25519 keypairs — this plugin registers the same key
 * with Self Agent ID for human-verified identity.
 *
 * NOTE: This is documentation-quality example code. Adapt to your
 * Eliza version and plugin system.
 */

import { Ed25519Agent, SelfAgentVerifier, HEADERS } from "@selfxyz/agent-sdk";

/**
 * Eliza plugin interface (adapt to your version)
 */
interface ElizaPlugin {
  name: string;
  description: string;
  actions: Record<string, ElizaAction>;
}

interface ElizaAction {
  description: string;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

interface ElizaRuntime {
  getSetting(key: string): string | undefined;
}

/**
 * Create the Self Agent ID plugin for Eliza.
 *
 * Configuration (via Eliza settings):
 *   - SELF_ED25519_SEED: 64-char hex Ed25519 seed
 *     OR uses the agent's existing Solana keypair
 *   - SELF_NETWORK: "testnet" or "mainnet" (default: "testnet")
 */
export function createSelfIdentityPlugin(runtime: ElizaRuntime): ElizaPlugin {
  // Use existing Solana key or a dedicated Self key
  const seed =
    runtime.getSetting("SELF_ED25519_SEED") ||
    runtime.getSetting("SOLANA_PRIVATE_KEY") ||
    "";

  if (!seed) {
    throw new Error(
      "Self Identity plugin requires SELF_ED25519_SEED or SOLANA_PRIVATE_KEY",
    );
  }

  const network =
    (runtime.getSetting("SELF_NETWORK") as "testnet" | "mainnet") || "testnet";

  const agent = new Ed25519Agent({ privateKey: seed, network });

  const verifier = SelfAgentVerifier.create()
    .network(network)
    .sybilLimit(0) // Eliza agents may share a human backer
    .build();

  return {
    name: "self-identity",
    description: "Human-verified agent identity via Self Agent ID (Ed25519)",
    actions: {
      checkIdentity: {
        description: "Check if this agent is registered with Self Agent ID",
        handler: async () => {
          const registered = await agent.isRegistered();
          if (!registered) {
            return {
              registered: false,
              message: "Not registered. Visit https://app.ai.self.xyz/register",
              agentKey: agent.agentKey,
            };
          }
          const info = await agent.getInfo();
          return {
            registered: true,
            agentId: info.agentId.toString(),
            isVerified: info.isVerified,
            address: agent.address,
          };
        },
      },

      signRequest: {
        description: "Sign an HTTP request for authenticated communication",
        handler: async (params) => {
          const method = (params.method as string) || "GET";
          const url = params.url as string;
          const body = params.body as string | undefined;
          const headers = await agent.signRequest(method, url, body);
          return { headers };
        },
      },

      authenticatedFetch: {
        description: "Make an authenticated HTTP request",
        handler: async (params) => {
          const url = params.url as string;
          const method = (params.method as string) || "GET";
          const body = params.body as string | undefined;
          const res = await agent.fetch(url, {
            method,
            body,
            headers: body ? { "Content-Type": "application/json" } : undefined,
          });
          return {
            status: res.status,
            body: await res.text(),
          };
        },
      },

      demoVerify: {
        description:
          "Test your agent against the live Self Agent ID demo endpoint",
        handler: async (params) => {
          const network = (params.network as string) || "celo-sepolia";
          const res = await agent.fetch(
            `https://app.ai.self.xyz/api/demo/agent-to-agent?network=${network}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ test: "eliza-demo" }),
            },
          );
          return {
            status: res.status,
            body: await res.json(),
          };
        },
      },

      verifyAgent: {
        description: "Verify an inbound request from another agent",
        handler: async (params) => {
          const result = await verifier.verify({
            signature: params.signature as string,
            timestamp: params.timestamp as string,
            method: (params.method as string) || "GET",
            url: params.url as string,
            body: params.body as string | undefined,
            keytype: params.keytype as string | undefined,
            agentKey: params.agentKey as string | undefined,
          });
          return {
            valid: result.valid,
            agentAddress: result.agentAddress,
            agentId: result.agentId?.toString(),
            error: result.error,
          };
        },
      },
    },
  };
}
