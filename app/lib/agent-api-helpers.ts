// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Shared helpers for every API route: CORS/JSON responses, session-token auth,
 * body parsing, rate-limit responses, networks and input validation.
 *
 * Error bodies are always `{ error: string }` with CORS headers.
 */

import { NextResponse, type NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  type SessionData,
  decryptSession,
  rotateSessionToken,
} from "./session-token";
import { NETWORKS, type NetworkConfig, type NetworkId } from "./network";

import { typedRegistry } from "@/lib/contract-types";

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
 * Read SESSION_SECRET.
 *
 * Routes should use requireSessionSecret(), which turns a missing secret into
 * a 500 response.
 *
 * @returns The session encryption secret.
 * @throws If SESSION_SECRET is not set.
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
 * Answer an OPTIONS preflight.
 *
 * @returns 204 with CORS headers and no body.
 */
export function corsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: AGENT_CORS_HEADERS });
}

/**
 * Build a JSON response with CORS headers.
 *
 * @param body - JSON-serialisable response body.
 * @param status - HTTP status (default 200).
 * @returns The JSON response.
 */
export function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): NextResponse {
  return NextResponse.json(body, { status, headers: AGENT_CORS_HEADERS });
}

/**
 * Build a JSON error response with CORS headers.
 *
 * @param message - Human-readable error message.
 * @param status - HTTP status.
 * @returns `{ error: message }` with that status.
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
 * Resolve an {@link ApiNetwork} to its {@link NetworkConfig}.
 *
 * @param network - "mainnet" or "testnet".
 * @returns The network's RPC URL, registry address, etc.
 * @throws If the network name is unknown (validate with isValidNetwork first).
 */
export function getNetworkConfig(network: ApiNetwork): NetworkConfig {
  const id = NETWORK_MAP[network];
  if (!id) {
    throw new Error(`Unknown network: ${network}`);
  }
  return NETWORKS[id];
}

/**
 * Check whether a string is an {@link ApiNetwork}.
 *
 * @param value - Request value to check.
 * @returns True for "mainnet" or "testnet".
 */
export function isValidNetwork(value: string): value is ApiNetwork {
  return value === "mainnet" || value === "testnet";
}

// ── Session helpers ──────────────────────────────────────────────────────────

/**
 * Pull the token out of an `Authorization: Bearer <token>` header.
 *
 * The scheme is case-insensitive.
 *
 * @param authorizationHeader - Raw Authorization header, or null.
 * @returns The token, or null when the header is missing, not Bearer, or empty.
 */
export function extractBearerToken(
  authorizationHeader: string | null,
): string | null {
  if (!authorizationHeader) return null;
  const [scheme, ...rest] = authorizationHeader.trim().split(/\s+/);
  if (!scheme || scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token || null;
}

/**
 * Read SESSION_SECRET for a route.
 *
 * @returns The secret, or a 500 `{ error: "Server configuration error" }`
 *   response (details logged) when it is unset.
 */
export function requireSessionSecret(): string | NextResponse {
  try {
    return getSessionSecret();
  } catch (err) {
    console.error("session secret unavailable:", err);
    return errorResponse("Server configuration error", 500);
  }
}

/** Flow names used in the wrong-flow error message. */
const SESSION_FLOW_LABEL: Record<SessionData["type"], string> = {
  register: "a registration",
  deregister: "a deregistration",
  refresh: "a proof refresh",
  identify: "an identify",
};

/**
 * Authenticate a status/qr/export request by its session token.
 *
 * The token comes from `Authorization: Bearer`, or from `options.token` when
 * the route found it elsewhere (export also accepts `{ token }` in the body).
 *
 * @param req - Request (only its headers are read).
 * @param type - Flow the token must belong to.
 * @param options.token - Token to use instead of the Authorization header.
 * @param options.graceMs - Accept tokens that expired up to this long ago
 *   (the caller must then check `expiresAt` itself).
 * @returns `{ session, secret }`, or the error response to send:
 *   400 missing token; 500 SESSION_SECRET unset; 410 "Session expired";
 *   401 "Invalid session token" (tampered, wrong secret, malformed);
 *   400 "Token is not for a/an <flow> session" (other flow).
 */
export function requireSession(
  req: { headers: { get(name: string): string | null } },
  type: SessionData["type"],
  options: { token?: string; graceMs?: number } = {},
): { session: SessionData; secret: string } | NextResponse {
  const token =
    options.token ?? extractBearerToken(req.headers.get("authorization"));
  if (!token) {
    return errorResponse(
      "Missing session token. Provide Authorization: Bearer <sessionToken>.",
      400,
    );
  }
  const secret = requireSessionSecret();
  if (secret instanceof Response) return secret;

  let session: SessionData;
  try {
    session = decryptSession(token, secret, { graceMs: options.graceMs });
  } catch (err) {
    if (err instanceof Error && err.message === "Session expired") {
      return errorResponse("Session expired", 410);
    }
    return errorResponse("Invalid session token", 401);
  }
  if (session.type !== type) {
    return errorResponse(
      `Token is not for ${SESSION_FLOW_LABEL[type]} session`,
      400,
    );
  }
  return { session, secret };
}

/**
 * Build the standard 200 status response with a rotated session token.
 *
 * Expects `session.expiresAt` to be set (every minted session has it).
 *
 * @param session - Current session state (already updated by the caller).
 * @param secret - SESSION_SECRET.
 * @param extra - Extra fields merged into the body (may override defaults).
 * @returns 200 `{ sessionToken, stage, expiresAt, timeRemainingMs, ...extra }`.
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
 * Query the SelfAgentRegistry for an agent key's human proof.
 *
 * @param agentAddress - Agent's EVM address, or a raw 32-byte agent key
 *   (Ed25519) when isRawAgentKey is set.
 * @param networkConfig - Network to query (RPC URL and registry address).
 * @param isRawAgentKey - Use agentAddress as the agent key as-is instead of
 *   left-padding it to 32 bytes.
 * @returns `hasHumanProof` (registered and not burned; says nothing about
 *   proof freshness) and the on-chain `agentId` (0n without a proof).
 * @throws On RPC failure or a malformed address/key.
 */
export async function checkAgentOnChain(
  agentAddress: string,
  networkConfig: NetworkConfig,
  isRawAgentKey = false,
): Promise<{
  hasHumanProof: boolean;
  agentId: bigint;
}> {
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  const registry = typedRegistry(networkConfig.registryAddress, provider);
  const agentKey = isRawAgentKey
    ? agentAddress
    : ethers.zeroPadValue(agentAddress, 32);
  // isVerifiedAgent only checks the human-proof flag, not its expiry.
  const hasHumanProof: boolean = await registry.isVerifiedAgent(agentKey);
  const agentId = hasHumanProof ? await registry.getAgentId(agentKey) : 0n;
  return { hasHumanProof, agentId };
}

// ── Human-readable instructions ──────────────────────────────────────────────

/** Which human-in-the-loop flow a session belongs to (drives wording). */
type SessionFlow =
  | "registration"
  | "deregistration"
  | "refresh"
  | "identification";

/** Message shown when a flow reaches "completed". */
const FLOW_COMPLETE_MESSAGE: Record<SessionFlow, string> = {
  registration: "Registration complete. Your agent is now verified on-chain.",
  deregistration: "Deregistration complete. Your agent has been removed.",
  refresh: "Refresh complete. Your agent's human proof has been renewed.",
  identification: "Identification complete.",
};

/**
 * Build user-facing instructions for a session stage.
 *
 * @param stage - Current session stage.
 * @param flow - Flow the session belongs to (default "registration").
 * @returns Instruction lines to show the human (empty for unknown stages).
 */
export function humanInstructions(
  stage: RegistrationStage,
  flow: SessionFlow = "registration",
): string[] {
  const Flow = flow.charAt(0).toUpperCase() + flow.slice(1);
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
      return [FLOW_COMPLETE_MESSAGE[flow]];
    case "failed":
      return [`${Flow} failed. Start a new session and try again.`];
    case "expired":
      return [`Session expired. Please start a new ${flow}.`];
    default:
      return [];
  }
}

// ── Address validation ───────────────────────────────────────────────────────

/**
 * Check whether a string is an EVM address ethers accepts.
 *
 * Lenient: also accepts ICAP and un-prefixed forms; use parseAddress for
 * request input.
 *
 * @param value - String to check.
 * @returns True if ethers.getAddress accepts it (mixed case must checksum).
 */
export function isValidAddress(value: string): boolean {
  try {
    ethers.getAddress(value);
    return true;
  } catch {
    return false;
  }
}

// ── Request helpers ──────────────────────────────────────────────────────────

/** Default max JSON request body size for agent API routes. */
const MAX_JSON_BODY_BYTES = 16 * 1024;

/**
 * Best-effort client IP for rate limiting.
 *
 * Prefers `x-real-ip`, which Vercel sets from the TCP connection, over the
 * client-appendable `x-forwarded-for` (first entry).
 * ponytail: header-based; behind a proxy that passes these through untouched
 * the key is spoofable — move limits to an edge/WAF rule if that matters.
 *
 * @param req - Request (only its headers are read).
 * @returns The IP, or "unknown" when neither header is set.
 */
export function getClientIp(req: {
  headers: { get(name: string): string | null };
}): string {
  return (
    req.headers.get("x-real-ip")?.trim() ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Strip trailing "/" characters in linear time (a `/\\/+$/` regex is
 * polynomial on long runs of slashes).
 *
 * @param url - URL or base URL.
 * @returns `url` without trailing slashes.
 */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url.charCodeAt(end - 1) === 47) end--;
  return url.slice(0, end);
}

/**
 * Public base URL used to build links handed to clients (scanUrl etc.).
 *
 * Never derived from Host / X-Forwarded-Host in production, so a client
 * cannot make the API mint links to an attacker-controlled domain.
 *
 * @param req - Request whose origin is used outside production only.
 * @returns NEXT_PUBLIC_APP_URL (trailing slashes stripped); else the request
 *   origin outside production; else "https://agent-api.self.xyz".
 */
export function getAppBaseUrl(req?: { nextUrl: { origin: string } }): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
    ? trimTrailingSlashes(process.env.NEXT_PUBLIC_APP_URL)
    : undefined;
  if (configured) return configured;
  if (req && process.env.NODE_ENV !== "production") return req.nextUrl.origin;
  return "https://agent-api.self.xyz";
}

/**
 * Read at most maxBytes of a body, cancelling the rest of the stream.
 *
 * @param source - Request or response whose body to read.
 * @param maxBytes - Byte cap.
 * @returns The UTF-8 text (cut at maxBytes) and whether the body was longer.
 * @throws If reading the stream fails.
 */
export async function readTextCapped(
  source: Pick<Response, "body">,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!source.body) return { text: "", truncated: false };
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > maxBytes) {
      truncated = true;
      await reader.cancel().catch(() => undefined);
      break;
    }
  }
  const bytes = Buffer.concat(chunks).subarray(0, maxBytes);
  return { text: new TextDecoder().decode(bytes), truncated };
}

/**
 * Read and JSON-parse a request body with a size cap.
 *
 * Never buffers more than maxBytes; a Content-Length over the cap is rejected
 * without reading. Non-object bodies (arrays, primitives, null) are rejected
 * so handlers can destructure safely.
 *
 * @param req - Incoming request.
 * @param maxBytes - Body cap (default 16 KiB).
 * @param options.allowEmpty - Parse an empty/whitespace body as `{}`.
 * @returns `{ ok: true, body }`, or `{ ok: false, response }` with:
 *   413 "Request body too large"; 400 "Invalid JSON body" (including an
 *   empty body without allowEmpty); 400 "Request body must be a JSON object".
 * @throws If reading the body stream fails (e.g. client disconnect).
 */
export async function readJsonObjectBody(
  req: NextRequest,
  maxBytes = MAX_JSON_BODY_BYTES,
  options: { allowEmpty?: boolean } = {},
): Promise<
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse }
> {
  const declared = Number(req.headers.get("content-length") || 0);
  const { text, truncated } =
    declared > maxBytes
      ? { text: "", truncated: true }
      : await readTextCapped(req, maxBytes);
  if (truncated) {
    return {
      ok: false,
      response: errorResponse("Request body too large", 413),
    };
  }
  if (options.allowEmpty && !text.trim()) return { ok: true, body: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, response: errorResponse("Invalid JSON body", 400) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      response: errorResponse("Request body must be a JSON object", 400),
    };
  }
  return { ok: true, body: parsed as Record<string, unknown> };
}

/**
 * Build a PNG image response that embeds anywhere.
 *
 * Works as `<img src>` on any origin (CORS + Cross-Origin-Resource-Policy, so
 * COEP pages accept it), rendered inline, never sniffed, never cached (QR
 * tokens are short-lived).
 *
 * @param png - PNG bytes.
 * @param filename - Filename for Content-Disposition (must not contain quotes).
 * @returns 200 image/png response.
 */
export function pngResponse(png: Buffer, filename: string): Response {
  return new Response(new Uint8Array(png), {
    status: 200,
    headers: {
      ...AGENT_CORS_HEADERS,
      "Content-Type": "image/png",
      "Content-Length": String(png.byteLength),
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Build a 429 response with CORS headers and a Retry-After header.
 *
 * @param retryAfterMs - Time until the window resets, in ms.
 * @param message - Error message (default "Rate limit exceeded. Try again later.").
 * @returns 429 `{ error, retryAfterMs }`, Retry-After in whole seconds (min 1).
 */
export function rateLimitResponse(
  retryAfterMs: number,
  message = "Rate limit exceeded. Try again later.",
): NextResponse {
  const res = jsonResponse({ error: message, retryAfterMs }, 429);
  res.headers.set(
    "Retry-After",
    String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
  );
  return res;
}

// ── Disclosures ──────────────────────────────────────────────────────────────

/** Validated disclosure request shared by register / deregister / refresh. */
export interface ParsedDisclosures {
  minimumAge: 0 | 18 | 21;
  ofac: boolean;
  nationality: boolean;
  name: boolean;
  date_of_birth: boolean;
  gender: boolean;
  issuing_state: boolean;
}

/** Boolean disclosure flags, as named in requests and in the Self app request. */
export const DISCLOSURE_KEYS = [
  "ofac",
  "nationality",
  "name",
  "date_of_birth",
  "gender",
  "issuing_state",
] as const;

/**
 * Strictly validate a `disclosures` request field.
 *
 * Booleans must be real booleans ("false" is not false) and minimumAge must be
 * 0, 18 or 21. Unknown keys are ignored.
 *
 * @param raw - The `disclosures` field (undefined means no disclosures).
 * @returns `{ ok: true, disclosures }` with every flag defaulted to false and
 *   minimumAge to 0, or `{ ok: false, error }` naming the bad field.
 */
export function parseDisclosures(
  raw: unknown,
): { ok: true; disclosures: ParsedDisclosures } | { ok: false; error: string } {
  const out: ParsedDisclosures = {
    minimumAge: 0,
    ofac: false,
    nationality: false,
    name: false,
    date_of_birth: false,
    gender: false,
    issuing_state: false,
  };
  if (raw === undefined) return { ok: true, disclosures: out };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "disclosures must be an object" };
  }
  const d = raw as Record<string, unknown>;
  if (d.minimumAge !== undefined) {
    if (d.minimumAge !== 0 && d.minimumAge !== 18 && d.minimumAge !== 21) {
      return { ok: false, error: "minimumAge must be 0, 18, or 21" };
    }
    out.minimumAge = d.minimumAge;
  }
  for (const key of DISCLOSURE_KEYS) {
    const value = d[key];
    if (value === undefined) continue;
    if (typeof value !== "boolean") {
      return { ok: false, error: `disclosures.${key} must be a boolean` };
    }
    out[key] = value;
  }
  return { ok: true, disclosures: out };
}

// ── Shared validation ────────────────────────────────────────────────────────

/** Error messages shared by every route, so one condition reads one way. */
export const ERRORS = {
  invalidNetwork: 'network must be "mainnet" or "testnet"',
  unsupportedChain: "Unsupported chain",
  invalidAgentId: "Invalid agent ID",
  agentNotFound: "Agent not found",
  invalidAddress: "Invalid address",
  rpc: "RPC error",
  qrRender: "Failed to render QR code",
} as const;

/** Largest uint256, the upper bound for agent IDs. */
const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Parse an agent ID path/query param.
 *
 * Only canonical positive decimal strings within uint256 are accepted (no hex,
 * octal, whitespace or leading zeros), so every agent has exactly one URL.
 *
 * @param id - Raw param value.
 * @returns The agent ID, or null if invalid.
 */
export function validateAgentId(id: string): bigint | null {
  if (!/^[1-9][0-9]{0,77}$/.test(id)) return null;
  const n = BigInt(id);
  return n <= MAX_UINT256 ? n : null;
}

/**
 * Parse an agent ID from a JSON body field.
 *
 * @param raw - A positive safe-integer number, or a canonical decimal string
 *   (for IDs beyond 2^53).
 * @returns The agent ID, or null if invalid.
 */
export function parseAgentIdField(raw: unknown): bigint | null {
  if (typeof raw === "number") {
    return Number.isSafeInteger(raw) && raw > 0 ? BigInt(raw) : null;
  }
  return typeof raw === "string" ? validateAgentId(raw) : null;
}

/**
 * Parse a strict EVM address from request input.
 *
 * Requires `0x` + 40 hex, a valid checksum when mixed-case, and not the zero
 * address. Rejects ICAP and un-prefixed forms.
 *
 * @param raw - Request value (any type).
 * @returns The checksummed address, or null if invalid.
 */
export function parseAddress(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  if (!isValidAddress(raw)) return null; // bad mixed-case checksum
  const address = ethers.getAddress(raw);
  return address === ethers.ZeroAddress ? null : address;
}

/**
 * Map a chain ID to its API network name.
 *
 * @param chainId - Chain ID as a number or URL param string.
 * @returns "mainnet" / "testnet", or null if unsupported.
 */
export function networkForChainId(chainId: number | string): ApiNetwork | null {
  // Canonical decimal only, like CHAIN_CONFIG lookups ("0xa4ec", " 42220 " → null).
  if (typeof chainId === "string" && !/^[1-9][0-9]*$/.test(chainId)) {
    return null;
  }
  const id = Number(chainId);
  for (const network of ["mainnet", "testnet"] as const) {
    if (getNetworkConfig(network).chainId === id) return network;
  }
  return null;
}
