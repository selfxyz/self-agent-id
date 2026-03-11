// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { DEFAULT_NETWORK, NETWORKS } from "@/lib/network";
import { typedRegistry, typedProvider } from "@/lib/contract-types";
import { buildAgentCard } from "@selfxyz/agent-sdk";
import type { ERC8004AgentDocument } from "@selfxyz/agent-sdk";
import { getAgentCardJSON } from "@/lib/agent-discovery";

// ── CORS headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, max-age=60",
} as const;

// ── Generic registry card (no agentId) ──────────────────────────────────────

function registryCard() {
  return getAgentCardJSON();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function resolveChainId(req: NextRequest): string {
  const fromQuery =
    req.nextUrl.searchParams.get("chain") ??
    req.nextUrl.searchParams.get("chainId");

  if (fromQuery) return fromQuery;

  const fallback = NETWORKS[DEFAULT_NETWORK];
  return String(fallback.chainId);
}

function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: CORS_HEADERS },
  );
}

// ── Route handler ───────────────────────────────────────────────────────────

/**
 * GET /.well-known/agent-card.json
 *
 * Serves A2A v0.3.0 agent cards.
 *
 * - Without `agentId` query param: returns a generic card describing the
 *   Self Agent ID registry itself.
 * - With `agentId=<number>`: fetches the agent's on-chain metadata from the
 *   SelfAgentRegistry contract and formats it as an A2A agent card. Optionally
 *   accepts `chainId` or `chain` to target a specific network (defaults to
 *   the configured default network).
 */
export async function GET(req: NextRequest) {
  const agentIdParam = req.nextUrl.searchParams.get("agentId");

  // ── No agentId: return generic registry card ──
  if (!agentIdParam) {
    return NextResponse.json(registryCard(), { headers: CORS_HEADERS });
  }

  // ── Validate agentId ──
  let agentId: bigint;
  try {
    agentId = BigInt(agentIdParam);
    if (agentId <= 0n) throw new Error();
  } catch {
    return errorResponse("Invalid agentId: must be a positive integer", 400);
  }

  // ── Resolve chain ──
  const chainId = resolveChainId(req);
  const config = CHAIN_CONFIG[chainId];
  if (!config) {
    return errorResponse(`Unsupported chain: ${chainId}`, 400);
  }

  // ── Look up the corresponding NetworkConfig for provider address ──
  const networkEntry = Object.values(NETWORKS).find(
    (n) => String(n.chainId) === chainId,
  );
  if (!networkEntry) {
    return errorResponse(`No network config for chain ${chainId}`, 400);
  }

  try {
    const rpcProvider = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, rpcProvider);

    // Check the agent exists by reading its metadata
    const rawMetadata: string = await registry.getAgentMetadata(agentId);

    if (!rawMetadata) {
      return errorResponse("Agent not found or has no metadata", 404);
    }

    // Try to parse existing on-chain metadata
    let onChainCard: Record<string, unknown> = {};
    try {
      onChainCard = JSON.parse(rawMetadata) as Record<string, unknown>;
    } catch {
      // Metadata is not valid JSON — we'll build the card from contract state
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://selfagentid.xyz";
    const a2aEndpoint = `${appUrl}/api/a2a`;

    // Try to enrich with on-chain proof data via buildAgentCard
    let card: ERC8004AgentDocument;
    try {
      const provider = typedProvider(networkEntry.providerAddress, rpcProvider);
      card = await buildAgentCard(Number(agentId), registry, provider, {
        name: (onChainCard.name as string) || `Agent #${agentId}`,
        description:
          (onChainCard.description as string) ||
          "Human-verified AI agent on Self Protocol",
        image: (onChainCard.image as string) || `${appUrl}/icon.png`,
        url: a2aEndpoint,
        services: [
          { name: "A2A", endpoint: a2aEndpoint, version: "0.3.0" },
          {
            name: "web",
            endpoint: `${appUrl}/.well-known/a2a/${agentId}`,
          },
        ],
        skills: (onChainCard.skills as ERC8004AgentDocument["skills"]) ?? [
          {
            id: "default",
            name: "Default",
            description: "This agent has not declared specific skills.",
          },
        ],
        version: (onChainCard.version as string) || "1.0.0",
        agentProvider: {
          name: "Self",
          url: "https://self.xyz",
        },
        capabilities: {
          streaming: false,
          pushNotifications: false,
          stateTransitionHistory: false,
          extendedAgentCard: false,
        },
        supportedInterfaces: [
          {
            url: a2aEndpoint,
            protocolBinding: "JSONRPC",
            protocolVersion: "0.3.0",
          },
        ],
        iconUrl:
          (onChainCard.iconUrl as string) ||
          (onChainCard.image as string) ||
          `${appUrl}/icon.png`,
      });
    } catch {
      // buildAgentCard failed (e.g. agent has no proof provider) —
      // return a minimal card from on-chain metadata only
      card = {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        name: (onChainCard.name as string) || `Agent #${agentId}`,
        description:
          (onChainCard.description as string) ||
          "AI agent registered on Self Protocol",
        image: (onChainCard.image as string) || `${appUrl}/icon.png`,
        services: [{ name: "A2A", endpoint: a2aEndpoint, version: "0.3.0" }],
        version: (onChainCard.version as string) || "1.0.0",
        url: a2aEndpoint,
        provider: {
          name: "Self",
          url: "https://self.xyz",
        },
        capabilities: {
          streaming: false,
          pushNotifications: false,
          stateTransitionHistory: false,
          extendedAgentCard: false,
        },
        supportedInterfaces: [
          {
            url: a2aEndpoint,
            protocolBinding: "JSONRPC",
            protocolVersion: "0.3.0",
          },
        ],
        defaultInputModes: ["text/plain", "application/json"],
        defaultOutputModes: ["text/plain", "application/json"],
        skills: (onChainCard.skills as ERC8004AgentDocument["skills"]) ?? [
          {
            id: "default",
            name: "Default",
            description: "This agent has not declared specific skills.",
          },
        ],
        selfProtocol: {
          agentId: Number(agentId),
          registry: config.registry,
          chainId: Number(chainId),
          proofProvider: ethers.ZeroAddress,
          providerName: "unknown",
          verificationStrength: 0,
          trustModel: {
            proofType: "unknown",
            sybilResistant: false,
            ofacScreened: false,
            minimumAgeVerified: 0,
          },
        },
      };
    }

    return NextResponse.json(card, { headers: CORS_HEADERS });
  } catch (err) {
    // Distinguish "agent doesn't exist" from RPC errors
    const message = err instanceof Error ? err.message : "Unknown error";
    if (
      message.includes("nonexistent token") ||
      message.includes("invalid token") ||
      message.includes("ERC721")
    ) {
      return errorResponse("Agent not found", 404);
    }
    return errorResponse("Agent not found or metadata unavailable", 404);
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
