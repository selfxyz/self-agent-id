// SPDX-License-Identifier: MIT

/**
 * Eliza (ai16z) plugin exposing Self Agent ID actions for an Ed25519 agent key.
 *
 * Eliza agents on Solana already use Ed25519 keys, so the same key can be
 * registered with Self Agent ID. Documentation-quality example code: adapt
 * to your Eliza version and plugin system.
 */

import { Ed25519Agent, SelfAgentVerifier } from "@selfxyz/agent-sdk";

/** Eliza plugin shape (adapt to your version). */
interface ElizaPlugin {
  name: string;
  description: string;
  actions: Record<string, ElizaAction>;
}

/** One plugin action: a description plus an async handler. */
interface ElizaAction {
  description: string;
  handler: (params: Record<string, unknown>) => Promise<unknown>;
}

/** The part of the Eliza runtime this plugin reads (settings). */
interface ElizaRuntime {
  getSetting(key: string): string | undefined;
}

/**
 * Create the Self Agent ID plugin for Eliza.
 *
 * Configuration (via Eliza settings):
 *   - SELF_ED25519_SEED: 64-char hex Ed25519 seed
 *     OR uses the agent's existing Solana key (as a 64-char hex seed)
 *   - SELF_NETWORK: "testnet" or "mainnet" (default: "testnet")
 *
 * @param runtime - Eliza runtime used to read settings.
 * @returns The plugin with checkIdentity, signRequest, authenticatedFetch and verifyAgent actions.
 * @throws If no seed is configured, or the seed is not 64 hex characters.
 */
export function createSelfIdentityPlugin(runtime: ElizaRuntime): ElizaPlugin {
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
              message:
                "Not registered. Register this Ed25519 key (see examples/standalone-ts: agent.ts --register).",
              agentKey: agent.agentKey,
            };
          }
          const info = await agent.getInfo();
          return {
            registered: true,
            agentId: info.agentId.toString(),
            // hasHumanProof && isProofFresh (what verifiers require)
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
