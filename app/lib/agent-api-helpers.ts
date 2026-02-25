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

/** User-facing network identifier used in API requests (maps to a Celo chain). */
export type ApiNetwork = "mainnet" | "testnet";

/** Progression stages of an agent registration session. */
export type RegistrationStage =
  | "pending"
  | "qr-ready"
  | "proof-received"
  | "completed"
  | "failed"
  | "expired";

// ── Environment ──────────────────────────────────────────────────────────────

/**
 * Retrieve the SESSION_SECRET environment variable.
 * @returns The session encryption secret.
 * @throws If the variable is not set.
 */
export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is not set");
  }
  return secret;
}

// ── CORS ─────────────────────────────────────────────────────────────────────

/** Default CORS headers applied to all agent API responses. */
export const AGENT_CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

/**
 * Return a 204 No Content response with CORS headers (for OPTIONS preflight).
 * @returns An empty NextResponse with CORS headers.
 */
export function corsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: AGENT_CORS_HEADERS });
}

/**
 * Return a JSON response with CORS headers.
 * @param body - JSON-serializable response body.
 * @param status - HTTP status code (defaults to 200).
 * @returns A NextResponse containing the JSON body.
 */
export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, { status, headers: AGENT_CORS_HEADERS });
}

/**
 * Return a JSON error response with CORS headers.
 * @param message - Human-readable error message.
 * @param status - HTTP status code.
 * @returns A NextResponse with `{ error: message }` body.
 */
export function errorResponse(message: string, status: number): NextResponse {
  return jsonResponse({ error: message }, status);
}

// ── Network helpers ──────────────────────────────────────────────────────────

/** Maps user-facing network names to internal chain identifiers. */
const NETWORK_MAP: Record<ApiNetwork, NetworkId> = {
  mainnet: "celo-mainnet",
  testnet: "celo-sepolia",
};

/**
 * Resolve an {@link ApiNetwork} to its full {@link NetworkConfig} (RPC URL, registry address, etc.).
 * @param network - The user-facing network name.
 * @returns The corresponding network configuration.
 * @throws If the network name is unknown.
 */
export function getNetworkConfig(network: ApiNetwork): NetworkConfig {
  const id = NETWORK_MAP[network];
  if (!id) {
    throw new Error(`Unknown network: ${network}`);
  }
  return NETWORKS[id];
}

/**
 * Type guard that checks whether a string is a valid {@link ApiNetwork}.
 * @param value - The string to validate.
 * @returns `true` if the value is `"mainnet"` or `"testnet"`.
 */
export function isValidNetwork(value: string): value is ApiNetwork {
  return value === "mainnet" || value === "testnet";
}

// ── Session helpers ──────────────────────────────────────────────────────────

/** Result of decrypting and validating a session token. */
export interface SessionResponse {
  /** The decrypted session payload. */
  session: SessionData;
  /** The secret used for encryption/decryption. */
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

/**
 * Query the on-chain SelfAgentRegistry to check whether an agent is verified.
 * @param agentAddress - The Ethereum address of the agent.
 * @param networkConfig - Network configuration (RPC URL and registry address).
 * @returns An object with `isVerified` status and the agent's on-chain `agentId` (0 if unverified).
 */
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

/**
 * Return user-facing instructions for the current registration stage.
 * @param stage - The current registration stage.
 * @returns An array of instruction strings to display to the user.
 */
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

/**
 * Check whether a string is a valid Ethereum address (including checksum validation).
 * @param value - The string to validate.
 * @returns `true` if the string is a valid address.
 */
export function isValidAddress(value: string): boolean {
  try {
    ethers.getAddress(value);
    return true;
  } catch {
    return false;
  }
}
