// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Registration and deregistration flow management via the Self Agent ID REST API.
 *
 * These functions call the hosted API at self-agent-id.vercel.app by default
 * (or SELF_AGENT_API_BASE / a custom base URL) and return session objects
 * with polling capabilities.
 */

import type { NetworkName } from "./constants";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_API_BASE = "https://self-agent-id.vercel.app";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const CHAIN_IDS: Record<NetworkName, number> = {
  mainnet: 42220,
  testnet: 11142220,
};

// ── Public Types ─────────────────────────────────────────────────────────────

export interface RegistrationRequest {
  /** Registration mode */
  mode: "verified-wallet" | "agent-identity" | "wallet-free" | "smart-wallet";
  /** Network: "mainnet" (default) or "testnet" */
  network?: NetworkName;
  /** Credential disclosures to request */
  disclosures?: {
    minimumAge?: number;
    ofac?: boolean;
    nationality?: boolean;
  };
  /** Human's wallet address (required for verified-wallet and agent-identity) */
  humanAddress?: string;
  /** Agent display name */
  agentName?: string;
  /** Agent description */
  agentDescription?: string;
  /** Base URL of the Self Agent ID API (default: SELF_AGENT_API_BASE or https://self-agent-id.vercel.app) */
  apiBase?: string;
}

export interface RegistrationResult {
  agentId: number;
  agentAddress: string;
  credentials?: Record<string, unknown>;
  txHash?: string;
}

export interface RegistrationSession {
  /** Encrypted session token (pass to subsequent calls) */
  sessionToken: string;
  /** Current stage */
  stage: string;
  /** Deep link for Self app */
  deepLink: string;
  /** Agent's Ethereum address */
  agentAddress: string;
  /** When the session expires */
  expiresAt: string;
  /** Milliseconds until expiry */
  timeRemainingMs: number;
  /** Human-readable instructions */
  humanInstructions: string[];

  /** Poll until registration completes or times out */
  waitForCompletion(opts?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<RegistrationResult>;

  /** Export the agent's private key (only for modes that generated one) */
  exportKey(): Promise<string>;
}

export interface DeregistrationRequest {
  /** Network: "mainnet" (default) or "testnet" */
  network?: NetworkName;
  /** Agent's Ethereum address */
  agentAddress: string;
  /** Agent's private key (only needed for agent-identity / wallet-free deregistration) */
  agentPrivateKey?: string;
  /** Credential disclosures (should match original registration) */
  disclosures?: {
    minimumAge?: number;
    ofac?: boolean;
    nationality?: boolean;
  };
  /** Base URL of the Self Agent ID API (default: SELF_AGENT_API_BASE or https://self-agent-id.vercel.app) */
  apiBase?: string;
}

export interface DeregistrationSession {
  /** Encrypted session token */
  sessionToken: string;
  /** Current stage */
  stage: string;
  /** Deep link for Self app */
  deepLink: string;
  /** When the session expires */
  expiresAt: string;
  /** Milliseconds until expiry */
  timeRemainingMs: number;
  /** Human-readable instructions */
  humanInstructions: string[];

  /** Poll until deregistration completes or times out */
  waitForCompletion(opts?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<void>;
}

export interface ApiAgentInfo {
  agentId: number;
  chainId: number;
  agentKey: string;
  agentAddress: string;
  isVerified: boolean;
  proofProvider: string;
  verificationStrength: number;
  strengthLabel: string;
  credentials: {
    nationality?: string;
    olderThan?: number;
    ofac?: boolean[];
  };
  registeredAt: number;
  network: string;
}

export interface ApiAgentsForHuman {
  humanAddress: string;
  chainId: number;
  agents: Array<{
    agentId: number;
    agentKey: string;
    agentAddress: string;
    isVerified: boolean;
  }>;
  totalCount: number;
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class ExpiredSessionError extends Error {
  constructor(
    message = "Registration session expired. Call requestRegistration() again to start a new session."
  ) {
    super(message);
    this.name = "ExpiredSessionError";
  }
}

export class RegistrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RegistrationError";
  }
}

// ── Internal Helpers ─────────────────────────────────────────────────────────

/**
 * Read the API base URL from the SELF_AGENT_API_BASE environment variable,
 * falling back to the hardcoded default.
 *
 * @returns The base URL string.
 */
function defaultApiBaseFromEnv(): string {
  if (typeof process !== "undefined" && process?.env?.SELF_AGENT_API_BASE) {
    return process.env.SELF_AGENT_API_BASE;
  }
  return DEFAULT_API_BASE;
}

/**
 * Resolve the final API base URL, stripping any trailing slashes.
 *
 * @param apiBase - Explicit override, or undefined to use the environment/default.
 * @returns A normalized base URL with no trailing slash.
 */
function resolveApiBase(apiBase?: string): string {
  return (apiBase ?? defaultApiBaseFromEnv()).replace(/\/+$/, "");
}

function chainIdForNetwork(network: NetworkName): number {
  return CHAIN_IDS[network];
}

async function apiFetch<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await globalThis.fetch(url, init);
  const body = await res.json();

  if (!res.ok) {
    const errorMsg =
      typeof body === "object" && body !== null && "error" in body
        ? (body as { error: string }).error
        : `HTTP ${res.status}`;
    throw new RegistrationError(errorMsg);
  }

  return body as T;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Registration Status Response Shape ──────────────────────────────────────

interface StatusResponse {
  sessionToken: string;
  stage: string;
  expiresAt: string;
  timeRemainingMs: number;
  agentAddress?: string;
  agentId?: number;
  credentials?: Record<string, unknown>;
  txHash?: string;
  humanInstructions?: string[];
}

// ── Registration Init Response Shape ────────────────────────────────────────

interface RegisterInitResponse {
  sessionToken: string;
  stage: string;
  deepLink: string;
  agentAddress: string;
  expiresAt: string;
  timeRemainingMs: number;
  humanInstructions: string[];
  network: string;
  mode: string;
}

// ── Deregistration Init Response Shape ──────────────────────────────────────

interface DeregisterInitResponse {
  sessionToken: string;
  stage: string;
  deepLink: string;
  agentAddress: string;
  agentId: number;
  expiresAt: string;
  timeRemainingMs: number;
  humanInstructions: string[];
  network: string;
}

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Initiate agent registration through the Self Agent ID REST API.
 *
 * Returns a session object with polling and key export methods.
 */
export async function requestRegistration(
  opts: RegistrationRequest
): Promise<RegistrationSession> {
  const base = resolveApiBase(opts.apiBase);
  const network = opts.network ?? "mainnet";

  const payload = {
    mode: opts.mode,
    network,
    disclosures: opts.disclosures,
    humanAddress: opts.humanAddress,
    agentName: opts.agentName,
    agentDescription: opts.agentDescription,
  };

  const data = await apiFetch<RegisterInitResponse>(
    `${base}/api/agent/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  return buildRegistrationSession(data, base);
}

/**
 * Initiate agent deregistration through the Self Agent ID REST API.
 */
export async function requestDeregistration(
  opts: DeregistrationRequest
): Promise<DeregistrationSession> {
  const base = resolveApiBase(opts.apiBase);
  const network = opts.network ?? "mainnet";

  const payload = {
    network,
    agentAddress: opts.agentAddress,
    agentPrivateKey: opts.agentPrivateKey,
    disclosures: opts.disclosures,
  };

  const data = await apiFetch<DeregisterInitResponse>(
    `${base}/api/agent/deregister`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }
  );

  return buildDeregistrationSession(data, base);
}

/**
 * Fetch agent info from the public query API.
 */
export async function getAgentInfo(
  agentId: number,
  opts?: { network?: NetworkName; apiBase?: string }
): Promise<ApiAgentInfo> {
  const base = resolveApiBase(opts?.apiBase);
  const network = opts?.network ?? "mainnet";
  const chainId = chainIdForNetwork(network);

  return apiFetch<ApiAgentInfo>(
    `${base}/api/agent/info/${chainId}/${agentId}`
  );
}

/**
 * Fetch all agents for a human address from the public query API.
 */
export async function getAgentsForHuman(
  address: string,
  opts?: { network?: NetworkName; apiBase?: string }
): Promise<ApiAgentsForHuman> {
  const base = resolveApiBase(opts?.apiBase);
  const network = opts?.network ?? "mainnet";
  const chainId = chainIdForNetwork(network);

  return apiFetch<ApiAgentsForHuman>(
    `${base}/api/agent/agents/${chainId}/${address}`
  );
}

// ── Session Builders ─────────────────────────────────────────────────────────

function buildRegistrationSession(
  data: RegisterInitResponse,
  apiBase: string
): RegistrationSession {
  let currentToken = data.sessionToken;

  return {
    sessionToken: data.sessionToken,
    stage: data.stage,
    deepLink: data.deepLink,
    agentAddress: data.agentAddress,
    expiresAt: data.expiresAt,
    timeRemainingMs: data.timeRemainingMs,
    humanInstructions: data.humanInstructions,

    async waitForCompletion(opts) {
      const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const interval = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        await sleep(interval);

        let status: StatusResponse;
        try {
          status = await apiFetch<StatusResponse>(
            `${apiBase}/api/agent/register/status?token=${encodeURIComponent(currentToken)}`
          );
        } catch (err) {
          if (
            err instanceof RegistrationError &&
            err.message.toLowerCase().includes("expired")
          ) {
            throw new ExpiredSessionError();
          }
          throw err;
        }

        // Update the rolling token
        currentToken = status.sessionToken;

        if (status.stage === "completed") {
          return {
            agentId: status.agentId!,
            agentAddress: status.agentAddress ?? data.agentAddress,
            credentials: status.credentials ?? undefined,
            txHash: status.txHash ?? undefined,
          };
        }

        if (status.stage === "failed") {
          throw new RegistrationError("Registration failed on-chain.");
        }

        if (status.stage === "expired") {
          throw new ExpiredSessionError();
        }
      }

      throw new RegistrationError(
        `Registration did not complete within ${timeout}ms. The session may still be active — call waitForCompletion() again to resume polling.`
      );
    },

    async exportKey() {
      const status = await apiFetch<{ privateKey: string }>(
        `${apiBase}/api/agent/register/export?token=${encodeURIComponent(currentToken)}`
      );
      return status.privateKey;
    },
  };
}

function buildDeregistrationSession(
  data: DeregisterInitResponse,
  apiBase: string
): DeregistrationSession {
  let currentToken = data.sessionToken;

  return {
    sessionToken: data.sessionToken,
    stage: data.stage,
    deepLink: data.deepLink,
    expiresAt: data.expiresAt,
    timeRemainingMs: data.timeRemainingMs,
    humanInstructions: data.humanInstructions,

    async waitForCompletion(opts) {
      const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const interval = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        await sleep(interval);

        let status: StatusResponse;
        try {
          status = await apiFetch<StatusResponse>(
            `${apiBase}/api/agent/deregister/status?token=${encodeURIComponent(currentToken)}`
          );
        } catch (err) {
          if (
            err instanceof RegistrationError &&
            err.message.toLowerCase().includes("expired")
          ) {
            throw new ExpiredSessionError(
              "Deregistration session expired. Call requestDeregistration() again to start a new session."
            );
          }
          throw err;
        }

        currentToken = status.sessionToken;

        if (status.stage === "completed") {
          return;
        }

        if (status.stage === "failed") {
          throw new RegistrationError("Deregistration failed on-chain.");
        }

        if (status.stage === "expired") {
          throw new ExpiredSessionError(
            "Deregistration session expired. Call requestDeregistration() again to start a new session."
          );
        }
      }

      throw new RegistrationError(
        `Deregistration did not complete within ${timeout}ms. The session may still be active — call waitForCompletion() again to resume polling.`
      );
    },
  };
}
