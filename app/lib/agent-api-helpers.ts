// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// ── Shared helpers for agent registration/deregistration API routes ───────────

import { NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  type SessionData,
  decryptSession,
  rotateSessionToken,
} from "./session-token";
import { NETWORKS, type NetworkConfig, type NetworkId } from "./network";
import { REGISTRY_ABI } from "./constants";

// ── Types ────────────────────────────────────────────────────────────────────

export type ApiNetwork = "mainnet" | "testnet";

export type RegistrationStage =
  | "pending"
  | "qr-ready"
  | "proof-received"
  | "completed"
  | "failed"
  | "expired";

// ── Environment ──────────────────────────────────────────────────────────────

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set");
  }
  return secret;
}

// ── CORS ─────────────────────────────────────────────────────────────────────

export const AGENT_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export function corsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: AGENT_CORS_HEADERS });
}

export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, { status, headers: AGENT_CORS_HEADERS });
}

export function errorResponse(message: string, status: number): NextResponse {
  return jsonResponse({ error: message }, status);
}

// ── Network helpers ──────────────────────────────────────────────────────────

const NETWORK_MAP: Record<ApiNetwork, NetworkId> = {
  mainnet: "celo-mainnet",
  testnet: "celo-sepolia",
};

export function getNetworkConfig(network: ApiNetwork): NetworkConfig {
  const id = NETWORK_MAP[network];
  if (!id) {
    throw new Error(`Unknown network: ${network}`);
  }
  return NETWORKS[id];
}

export function isValidNetwork(value: string): value is ApiNetwork {
  return value === "mainnet" || value === "testnet";
}

// ── Session helpers ──────────────────────────────────────────────────────────

export interface SessionResponse {
  session: SessionData;
  secret: string;
}

/**
 * Decrypt and validate a session token from a request.
 * Returns the session data and secret, or throws with an appropriate error.
 */
export function decryptAndValidateSession(token: string): SessionResponse {
  const secret = getSessionSecret();
  const session = decryptSession(token, secret);
  return { session, secret };
}

/**
 * Build a standard token-bearing JSON response with time metadata.
 */
export function sessionResponse(
  session: SessionData,
  secret: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  const token = rotateSessionToken(session, {}, secret);
  const expiresAt = session.expiresAt!;
  const timeRemainingMs = Math.max(
    0,
    new Date(expiresAt).getTime() - Date.now(),
  );

  return jsonResponse({
    sessionToken: token,
    stage: session.stage,
    expiresAt,
    timeRemainingMs,
    ...extra,
  });
}

// ── On-chain queries ─────────────────────────────────────────────────────────

export async function checkAgentOnChain(
  agentAddress: string,
  networkConfig: NetworkConfig,
): Promise<{
  isVerified: boolean;
  agentId: bigint;
}> {
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  const registry = new ethers.Contract(
    networkConfig.registryAddress,
    REGISTRY_ABI,
    provider,
  );
  const agentKey = ethers.zeroPadValue(agentAddress, 32);
  const isVerified: boolean = await registry.isVerifiedAgent(agentKey);
  let agentId = 0n;
  if (isVerified) {
    agentId = await registry.getAgentId(agentKey);
  }
  return { isVerified, agentId };
}

// ── Human-readable instructions ──────────────────────────────────────────────

export function humanInstructions(stage: RegistrationStage): string[] {
  switch (stage) {
    case "pending":
      return ["Session created. Awaiting QR generation."];
    case "qr-ready":
      return [
        "Open the Self app on your phone.",
        "Scan the QR code displayed below or open the deep link.",
        "Follow the prompts to scan your passport.",
        "Wait for the proof to be submitted on-chain.",
      ];
    case "proof-received":
      return [
        "Proof received from Self app.",
        "Waiting for on-chain confirmation...",
      ];
    case "completed":
      return ["Registration complete. Your agent is now verified on-chain."];
    case "failed":
      return [
        "Registration failed. Check the error details and try again.",
      ];
    case "expired":
      return ["Session expired. Please start a new registration."];
    default:
      return [];
  }
}

// ── Address validation ───────────────────────────────────────────────────────

export function isValidAddress(value: string): boolean {
  try {
    ethers.getAddress(value);
    return true;
  } catch {
    return false;
  }
}
