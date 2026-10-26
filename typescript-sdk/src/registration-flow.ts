// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Registration and deregistration flow management via the Self Agent ID REST API.
 *
 * These functions call the hosted API at agent-api.self.xyz by default
 * (or SELF_AGENT_API_BASE / a custom base URL) and return session objects
 * with polling capabilities. The session token rotates on every status poll;
 * each session object tracks the latest one internally.
 */

import { CHAIN_IDS, type NetworkName } from "./constants";
import type { RegistrationMode } from "./registration";

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_API_BASE = "https://agent-api.self.xyz";
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

// ── Public Types ─────────────────────────────────────────────────────────────

/** Credential disclosures to request from the human's passport/ID. */
export interface RegistrationDisclosureRequest {
  /** Minimum age gate: 0 (none), 18, or 21 */
  minimumAge?: number;
  /** Require OFAC screening */
  ofac?: boolean;
  /** The remaining flags ask the human to disclose that passport field */
  nationality?: boolean;
  name?: boolean;
  date_of_birth?: boolean;
  gender?: boolean;
  issuing_state?: boolean;
}

/** Options for `requestRegistration()`. */
export interface RegistrationRequest {
  /** Registration mode */
  mode: RegistrationMode;
  /** Network: "mainnet" (default) or "testnet" */
  network?: NetworkName;
  /** Credential disclosures to request */
  disclosures?: RegistrationDisclosureRequest;
  /** Ed25519 public key, 64-char hex, no 0x prefix (required for ed25519 and ed25519-linked modes) */
  ed25519Pubkey?: string;
  /** Ed25519 signature of challenge hash, 128-char hex (required for ed25519 and ed25519-linked modes) */
  ed25519Signature?: string;
  /** Human's wallet address (required for linked, ed25519-linked, privy and smartwallet) */
  humanAddress?: string;
  /** Base URL of the Self Agent ID API (default: SELF_AGENT_API_BASE or https://agent-api.self.xyz) */
  apiBase?: string;
}

/** Outcome of a completed registration. */
export interface RegistrationResult {
  /** On-chain agent ID (NFT token ID) */
  agentId: number;
  agentAddress: string;
  /** Disclosed credentials, when the API returned them */
  credentials?: Record<string, unknown>;
}

/** Live registration session returned by `requestRegistration()`. */
export interface RegistrationSession {
  /** Initial encrypted session token (rotates on each poll; the session tracks the latest) */
  sessionToken: string;
  /** Current stage */
  stage: string;
  /** Deep link for Self app */
  deepLink: string;
  /** URL of a PNG QR code encoding the deep link (safe to show to the human) */
  scanUrl: string;
  /** Agent's Ethereum address */
  agentAddress: string;
  /** When the session expires */
  expiresAt: string;
  /** Milliseconds until expiry */
  timeRemainingMs: number;
  /** Human-readable instructions */
  humanInstructions: string[];

  /**
   * Poll the status endpoint until registration completes.
   *
   * @param opts.timeoutMs - Give up after this long (default 30 minutes).
   * @param opts.pollIntervalMs - Delay between polls (default 5 seconds).
   * @returns The agent ID, address and any credentials.
   * @throws ExpiredSessionError if the session expired (HTTP 410 or stage "expired").
   * @throws RegistrationError on failure, other API errors, or timeout (polling can be resumed).
   */
  waitForCompletion(opts?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<RegistrationResult>;

  /**
   * Export the generated agent private key. Call after `waitForCompletion()`
   * so the latest session token is used.
   *
   * @returns The agent's hex private key.
   * @throws RegistrationError in ed25519 / ed25519-linked modes (the agent holds its own key) or on API errors.
   */
  exportKey(): Promise<string>;
}

/** Options for `requestProofRefresh()`. */
export interface ProofRefreshRequest {
  /** Agent ID (token ID) to refresh the proof for */
  agentId: number;
  /** Network: "mainnet" (default) or "testnet" */
  network?: NetworkName;
  /** Credential disclosures to request (should match original registration) */
  disclosures?: RegistrationDisclosureRequest;
  /** Base URL of the Self Agent ID API (default: SELF_AGENT_API_BASE or https://agent-api.self.xyz) */
  apiBase?: string;
}

/** Live proof-refresh session returned by `requestProofRefresh()`. */
export interface RefreshSession {
  /** Initial encrypted session token (rotates on each poll; the session tracks the latest) */
  sessionToken: string;
  /** Current stage */
  stage: string;
  /** Deep link for Self app */
  deepLink: string;
  /** URL of a PNG QR code encoding the deep link (safe to show to the human) */
  scanUrl: string;
  /** When the session expires */
  expiresAt: string;
  /** Milliseconds until expiry */
  timeRemainingMs: number;
  /** Human-readable instructions */
  humanInstructions: string[];

  /**
   * Poll the status endpoint until the refreshed proof is recorded on-chain.
   *
   * @param opts.timeoutMs - Give up after this long (default 30 minutes).
   * @param opts.pollIntervalMs - Delay between polls (default 5 seconds).
   * @returns The new proof expiry, when the API reports it.
   * @throws ExpiredSessionError if the session expired.
   * @throws RegistrationError on failure, other API errors, or timeout (polling can be resumed).
   */
  waitForCompletion(opts?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<{ proofExpiresAt?: Date }>;
}

/** Options for `requestDeregistration()`. */
export interface DeregistrationRequest {
  /** Network: "mainnet" (default) or "testnet" */
  network?: NetworkName;
  /** Agent's Ethereum address */
  agentAddress: string;
  /** Credential disclosures (should match original registration) */
  disclosures?: RegistrationDisclosureRequest;
  /** Base URL of the Self Agent ID API (default: SELF_AGENT_API_BASE or https://agent-api.self.xyz) */
  apiBase?: string;
}

/** Live deregistration session returned by `requestDeregistration()`. */
export interface DeregistrationSession {
  /** Initial encrypted session token (rotates on each poll; the session tracks the latest) */
  sessionToken: string;
  /** Current stage */
  stage: string;
  /** Deep link for Self app */
  deepLink: string;
  /** URL of a PNG QR code encoding the deep link (safe to show to the human) */
  scanUrl: string;
  /** When the session expires */
  expiresAt: string;
  /** Milliseconds until expiry */
  timeRemainingMs: number;
  /** Human-readable instructions */
  humanInstructions: string[];

  /**
   * Poll the status endpoint until the agent is removed on-chain.
   *
   * @param opts.timeoutMs - Give up after this long (default 30 minutes).
   * @param opts.pollIntervalMs - Delay between polls (default 5 seconds).
   * @throws ExpiredSessionError if the session expired.
   * @throws RegistrationError on failure, other API errors, or timeout (polling can be resumed).
   */
  waitForCompletion(opts?: {
    timeoutMs?: number;
    pollIntervalMs?: number;
  }): Promise<void>;
}

/** Agent record from `GET /api/agent/info/{chainId}/{agentId}`. */
export interface ApiAgentInfo {
  agentId: number;
  chainId: number;
  agentKey: string;
  agentAddress: string;
  /** `hasHumanProof && isProofFresh` */
  isVerified: boolean;
  hasHumanProof: boolean;
  isProofFresh: boolean;
  /** ISO-8601 proof expiry, or null if the agent has no proof */
  proofExpiresAt: string | null;
  proofProvider: string;
  verificationStrength: number;
  strengthLabel: string;
  credentials: {
    nationality: string | null;
    olderThan: number;
    ofac: boolean[];
  };
  /** Block number (not a timestamp) at which the agent was registered */
  registeredAtBlock: number;
  network: string;
}

/** Agent list from `GET /api/agent/agents/{chainId}/{address}`. */
export interface ApiAgentsForHuman {
  humanAddress: string;
  chainId: number;
  agents: Array<{
    agentId: number;
    agentKey: string;
    agentAddress: string;
    /** The human owns this agent's NFT */
    isOwner: boolean;
    /** The human's own address is this agent's key */
    isAgentKey: boolean;
    /** `hasHumanProof && isProofFresh` */
    isVerified: boolean;
    hasHumanProof: boolean;
    isProofFresh: boolean;
    proofExpiresAt: string | null;
  }>;
  totalCount: number;
  ownedCount: number;
  /** False if not every owned agent could be enumerated */
  complete: boolean;
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when a registration, refresh or deregistration session has expired. */
export class ExpiredSessionError extends Error {
  /**
   * @param message - Error message (defaults to a registration-specific hint).
   */
  constructor(
    message = "Registration session expired. Call requestRegistration() again to start a new session.",
  ) {
    super(message);
    this.name = "ExpiredSessionError";
  }
}

/** Thrown when a Self Agent ID API call fails or a session ends in failure. */
export class RegistrationError extends Error {
  /** HTTP status of the failed API call (e.g. 404 "Agent not found"), if any */
  readonly status?: number;

  /**
   * @param message - Error message (the API's `error` field when available).
   * @param status - HTTP status of the failed call, if any.
   */
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RegistrationError";
    this.status = status;
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

/**
 * Map a network name to its Celo chain ID.
 *
 * @param network - "mainnet" or "testnet".
 * @returns The chain ID.
 */
function chainIdForNetwork(network: NetworkName): number {
  return CHAIN_IDS[network];
}

/**
 * Fetch JSON from the API, turning non-2xx responses into `RegistrationError`.
 *
 * @param url - Full request URL.
 * @param init - Optional fetch options.
 * @returns The parsed JSON body (null if the body was not JSON).
 * @throws RegistrationError with the API's `error` message (or `HTTP <status>`) and status.
 */
async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await globalThis.fetch(url, init);
  const body: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const errorMsg =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : `HTTP ${res.status}`;
    throw new RegistrationError(errorMsg, res.status);
  }

  return body as T;
}

/**
 * Poll a session status endpoint, sending the session token as a Bearer token.
 *
 * @param url - Status endpoint URL.
 * @param token - Latest session token.
 * @param expiredMessage - Message for the `ExpiredSessionError` thrown on HTTP 410.
 * @returns The status response (including the rotated session token).
 * @throws ExpiredSessionError on HTTP 410; RegistrationError on other API errors.
 */
async function fetchStatus(
  url: string,
  token: string,
  expiredMessage?: string,
): Promise<StatusResponse> {
  try {
    return await apiFetch<StatusResponse>(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    if (err instanceof RegistrationError && err.status === 410) {
      throw new ExpiredSessionError(expiredMessage);
    }
    throw err;
  }
}

/**
 * Resolve after a delay.
 *
 * @param ms - Delay in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Registration Status Response Shape ──────────────────────────────────────

/** Body of the register/refresh/deregister status endpoints. */
interface StatusResponse {
  sessionToken: string;
  stage: string;
  expiresAt: string;
  timeRemainingMs: number;
  agentAddress?: string;
  agentId?: number;
  credentials?: Record<string, unknown>;
  proofExpiresAt?: string;
  humanInstructions?: string[];
}

// ── Registration Init Response Shape ────────────────────────────────────────

/** Body of `POST /api/agent/register`. */
interface RegisterInitResponse {
  sessionToken: string;
  stage: string;
  deepLink: string;
  scanUrl: string;
  agentAddress: string;
  expiresAt: string;
  timeRemainingMs: number;
  humanInstructions: string[];
  network: string;
  mode: string;
}

// ── Refresh Init Response Shape ─────────────────────────────────────────────

/** Body of `POST /api/agent/refresh`. */
interface RefreshInitResponse {
  sessionToken: string;
  stage: string;
  deepLink: string;
  scanUrl: string;
  agentId: number;
  expiresAt: string;
  timeRemainingMs: number;
  humanInstructions: string[];
  network: string;
}

// ── Deregistration Init Response Shape ──────────────────────────────────────

/** Body of `POST /api/agent/deregister`. */
interface DeregisterInitResponse {
  sessionToken: string;
  stage: string;
  deepLink: string;
  scanUrl: string;
  agentAddress: string;
  agentId: number;
  expiresAt: string;
  timeRemainingMs: number;
  humanInstructions: string[];
  network: string;
}

// ── Core Functions ───────────────────────────────────────────────────────────

/**
 * Start an agent registration session through the Self Agent ID REST API.
 *
 * Show `deepLink` or `scanUrl` to the human; they scan it with the Self app.
 *
 * @param opts - Mode, network, disclosures and mode-specific fields (see `RegistrationRequest`).
 * @returns A session with `waitForCompletion()` and `exportKey()`.
 * @throws RegistrationError if the API rejects the request.
 *
 * @example
 * ```ts
 * const session = await requestRegistration({
 *   mode: "wallet-free",
 *   disclosures: { minimumAge: 18 },
 * });
 * console.log(session.scanUrl); // show this QR to the human
 * const { agentId } = await session.waitForCompletion();
 * const privateKey = await session.exportKey();
 * ```
 */
export async function requestRegistration(
  opts: RegistrationRequest,
): Promise<RegistrationSession> {
  const base = resolveApiBase(opts.apiBase);
  const network = opts.network ?? "mainnet";

  const payload = {
    mode: opts.mode,
    network,
    disclosures: opts.disclosures,
    humanAddress: opts.humanAddress,
    ed25519Pubkey: opts.ed25519Pubkey,
    ed25519Signature: opts.ed25519Signature,
  };

  const data = await apiFetch<RegisterInitResponse>(
    `${base}/api/agent/register`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  return buildRegistrationSession(data, base);
}

/**
 * Start an agent deregistration session through the Self Agent ID REST API.
 *
 * @param opts - Agent address, network and the disclosures used at registration.
 * @returns A session with `waitForCompletion()`.
 * @throws RegistrationError if the API rejects the request.
 */
export async function requestDeregistration(
  opts: DeregistrationRequest,
): Promise<DeregistrationSession> {
  const base = resolveApiBase(opts.apiBase);
  const network = opts.network ?? "mainnet";

  const payload = {
    network,
    agentAddress: opts.agentAddress,
    disclosures: opts.disclosures,
  };

  const data = await apiFetch<DeregisterInitResponse>(
    `${base}/api/agent/deregister`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  return buildDeregistrationSession(data, base);
}

/**
 * Initiate a proof refresh for an existing agent through the Self Agent ID REST API.
 *
 * @param opts - Agent ID, network and the disclosures used at registration.
 * @returns A session with a deep link for the human and `waitForCompletion()`.
 * @throws RegistrationError if the API rejects the request.
 */
export async function requestProofRefresh(
  opts: ProofRefreshRequest,
): Promise<RefreshSession> {
  const base = resolveApiBase(opts.apiBase);
  const network = opts.network ?? "mainnet";

  const payload = {
    agentId: opts.agentId,
    network,
    disclosures: opts.disclosures,
  };

  const data = await apiFetch<RefreshInitResponse>(
    `${base}/api/agent/refresh`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );

  return buildRefreshSession(data, base);
}

/**
 * Fetch agent info from the public query API.
 *
 * @param agentId - On-chain agent ID.
 * @param opts.network - "mainnet" (default) or "testnet".
 * @param opts.apiBase - API base URL override.
 * @returns The agent's status, proof and credential summary.
 * @throws RegistrationError with `status === 404` if the agent does not exist (never minted or burned).
 */
export async function getAgentInfo(
  agentId: number,
  opts?: { network?: NetworkName; apiBase?: string },
): Promise<ApiAgentInfo> {
  const base = resolveApiBase(opts?.apiBase);
  const network = opts?.network ?? "mainnet";
  const chainId = chainIdForNetwork(network);

  return apiFetch<ApiAgentInfo>(`${base}/api/agent/info/${chainId}/${agentId}`);
}

/**
 * Fetch all agents for a human address from the public query API.
 *
 * @param address - The human's wallet address.
 * @param opts.network - "mainnet" (default) or "testnet".
 * @param opts.apiBase - API base URL override.
 * @returns The agents list (empty when the address has none).
 * @throws RegistrationError on API errors.
 */
export async function getAgentsForHuman(
  address: string,
  opts?: { network?: NetworkName; apiBase?: string },
): Promise<ApiAgentsForHuman> {
  const base = resolveApiBase(opts?.apiBase);
  const network = opts?.network ?? "mainnet";
  const chainId = chainIdForNetwork(network);

  return apiFetch<ApiAgentsForHuman>(
    `${base}/api/agent/agents/${chainId}/${address}`,
  );
}

// ── Session Builders ─────────────────────────────────────────────────────────

/**
 * Wrap a register-init response in a session object that tracks the rotating token.
 *
 * @param data - Response from `POST /api/agent/register`.
 * @param apiBase - Resolved API base URL.
 * @returns The registration session.
 */
function buildRegistrationSession(
  data: RegisterInitResponse,
  apiBase: string,
): RegistrationSession {
  let currentToken = data.sessionToken;

  return {
    sessionToken: data.sessionToken,
    stage: data.stage,
    deepLink: data.deepLink,
    scanUrl: data.scanUrl,
    agentAddress: data.agentAddress,
    expiresAt: data.expiresAt,
    timeRemainingMs: data.timeRemainingMs,
    humanInstructions: data.humanInstructions,

    /** See {@link RegistrationSession.waitForCompletion}. */
    async waitForCompletion(opts) {
      const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const interval = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        await sleep(interval);

        const status = await fetchStatus(
          `${apiBase}/api/agent/register/status`,
          currentToken,
        );

        currentToken = status.sessionToken;

        if (status.stage === "completed") {
          return {
            agentId: status.agentId!,
            agentAddress: status.agentAddress ?? data.agentAddress,
            credentials: status.credentials ?? undefined,
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
        `Registration did not complete within ${timeout}ms. The session may still be active — call waitForCompletion() again to resume polling.`,
      );
    },

    /** See {@link RegistrationSession.exportKey}. */
    async exportKey() {
      // The token rotates on every status poll; only the latest one (from the
      // poll that observed "completed") can export the key.
      const status = await apiFetch<{ privateKey: string }>(
        `${apiBase}/api/agent/register/export`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentToken}`,
          },
          body: JSON.stringify({ token: currentToken }),
        },
      );
      return status.privateKey;
    },
  };
}

/**
 * Wrap a refresh-init response in a session object that tracks the rotating token.
 *
 * @param data - Response from `POST /api/agent/refresh`.
 * @param apiBase - Resolved API base URL.
 * @returns The refresh session.
 */
function buildRefreshSession(
  data: RefreshInitResponse,
  apiBase: string,
): RefreshSession {
  let currentToken = data.sessionToken;

  return {
    sessionToken: data.sessionToken,
    stage: data.stage,
    deepLink: data.deepLink,
    scanUrl: data.scanUrl,
    expiresAt: data.expiresAt,
    timeRemainingMs: data.timeRemainingMs,
    humanInstructions: data.humanInstructions,

    /** See {@link RefreshSession.waitForCompletion}. */
    async waitForCompletion(opts) {
      const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const interval = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        await sleep(interval);

        const status = await fetchStatus(
          `${apiBase}/api/agent/refresh/status`,
          currentToken,
          "Proof refresh session expired. Call requestProofRefresh() again to start a new session.",
        );

        currentToken = status.sessionToken;

        if (status.stage === "completed") {
          return {
            proofExpiresAt: status.proofExpiresAt
              ? new Date(status.proofExpiresAt)
              : undefined,
          };
        }

        if (status.stage === "failed") {
          throw new RegistrationError("Proof refresh failed on-chain.");
        }

        if (status.stage === "expired") {
          throw new ExpiredSessionError(
            "Proof refresh session expired. Call requestProofRefresh() again to start a new session.",
          );
        }
      }

      throw new RegistrationError(
        `Proof refresh did not complete within ${timeout}ms. The session may still be active — call waitForCompletion() again to resume polling.`,
      );
    },
  };
}

/**
 * Wrap a deregister-init response in a session object that tracks the rotating token.
 *
 * @param data - Response from `POST /api/agent/deregister`.
 * @param apiBase - Resolved API base URL.
 * @returns The deregistration session.
 */
function buildDeregistrationSession(
  data: DeregisterInitResponse,
  apiBase: string,
): DeregistrationSession {
  let currentToken = data.sessionToken;

  return {
    sessionToken: data.sessionToken,
    stage: data.stage,
    deepLink: data.deepLink,
    scanUrl: data.scanUrl,
    expiresAt: data.expiresAt,
    timeRemainingMs: data.timeRemainingMs,
    humanInstructions: data.humanInstructions,

    /** See {@link DeregistrationSession.waitForCompletion}. */
    async waitForCompletion(opts) {
      const timeout = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const interval = opts?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
      const deadline = Date.now() + timeout;

      while (Date.now() < deadline) {
        await sleep(interval);

        const status = await fetchStatus(
          `${apiBase}/api/agent/deregister/status`,
          currentToken,
          "Deregistration session expired. Call requestDeregistration() again to start a new session.",
        );

        currentToken = status.sessionToken;

        if (status.stage === "completed") {
          return;
        }

        if (status.stage === "failed") {
          throw new RegistrationError("Deregistration failed on-chain.");
        }

        if (status.stage === "expired") {
          throw new ExpiredSessionError(
            "Deregistration session expired. Call requestDeregistration() again to start a new session.",
          );
        }
      }

      throw new RegistrationError(
        `Deregistration did not complete within ${timeout}ms. The session may still be active — call waitForCompletion() again to resume polling.`,
      );
    },
  };
}
