// SPDX-License-Identifier: MIT

/**
 * Shared helpers for the tool handlers: tool result blocks, address and
 * credential parsing, safe error logging and calls to the Self Agent ID REST
 * API.
 */

import { ethers } from "ethers";
import type { ServerConfig } from "./config.js";

/**
 * JSON.stringify replacer that writes bigints as decimal strings.
 *
 * @param _key - Property name (unused).
 * @param value - Property value.
 * @returns The value, with bigints converted to strings.
 */
function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * Build an MCP tool error result.
 *
 * @param message - Error text shown to the MCP client.
 * @returns `{ content: [text], isError: true }`.
 */
export function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/**
 * Build an MCP tool success result.
 *
 * @param data - Result object (bigints allowed).
 * @returns `{ content: [text] }` with the data as pretty-printed JSON.
 */
export function toolSuccess(data: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, bigintReplacer, 2) },
    ],
  };
}

/**
 * Describe an error for logs without its message, which can echo secrets
 * (ethers includes an invalid private key in its error text).
 *
 * @param err - Anything thrown.
 * @returns The error name plus an UPPER_CASE code when present, e.g.
 *   "TypeError (INVALID_ARGUMENT)"; the typeof for non-Error values.
 */
export function safeErrorDescription(err: unknown): string {
  if (!(err instanceof Error)) return typeof err;
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z_]+$/.test(code)
    ? `${err.name} (${code})`
    : err.name;
}

/** Tool error shown by the agent tools when SELF_AGENT_PRIVATE_KEY is unset. */
export const NO_AGENT_KEY_ERROR =
  "No agent key configured (SELF_AGENT_PRIVATE_KEY is not set). To create one, call " +
  "self_register_agent, have the human scan the QR code, then call self_check_registration " +
  "with reveal_private_key=true once it reports completed, set that key as " +
  "SELF_AGENT_PRIVATE_KEY in this MCP server's environment and restart it.";

// ── Parsing ─────────────────────────────────────────────────────────────────

/** Tool error for an agent_address that parseAddress rejects. */
export const INVALID_AGENT_ADDRESS_ERROR =
  "Invalid agent_address: expected a non-zero 0x-prefixed 40-hex-digit address (mixed case must be checksummed).";

/** Tool error for a human_address that parseAddress rejects. */
export const INVALID_HUMAN_ADDRESS_ERROR =
  "Invalid human_address: expected a non-zero 0x-prefixed 40-hex-digit address (mixed case must be checksummed).";

/**
 * Parse a strict EVM address.
 *
 * @param raw - Candidate value.
 * @returns The checksummed address, or null when it is not 0x + 40 hex
 *   digits, has a bad mixed-case checksum, or is the zero address.
 */
export function parseAddress(raw: unknown): string | null {
  if (typeof raw !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(raw)) return null;
  if (!ethers.isAddress(raw)) return null;
  const address = ethers.getAddress(raw);
  return address === ethers.ZeroAddress ? null : address;
}

/**
 * Normalise a disclosed credential string from the registry.
 *
 * @param value - Raw value (undisclosed fields are NUL-padded or separators).
 * @returns The trimmed value, or null when undisclosed or "UNAVAILABLE".
 */
export function disclosed(value: string | undefined | null): string | null {
  const v = (value ?? "").replace(/\0/g, "").trim();
  if (!/[\p{L}\p{N}]/u.test(v) || v.toUpperCase() === "UNAVAILABLE") {
    return null;
  }
  return v;
}

/** Credential fields used by the one-line summary. */
interface Credentials {
  nationality?: string;
  olderThan?: bigint | number;
  ofac?: boolean[];
}

/**
 * Summarise an agent's verification and credentials in one line.
 *
 * @param credentials - Agent credentials, if read.
 * @param verified - hasHumanProof && isProofFresh.
 * @returns e.g. "Verified human, 18+, OFAC clear, nationality: GBR", or
 *   "Not verified (no fresh human proof)".
 */
export function formatCredentialsSummary(
  credentials: Credentials | undefined | null,
  verified: boolean,
): string {
  if (!verified) return "Not verified (no fresh human proof)";
  if (!credentials) return "Verified human";
  const parts: string[] = ["Verified human"];
  const age = Number(credentials.olderThan ?? 0);
  if (age > 0) parts.push(`${age}+`);
  if (credentials.ofac?.[0] === true) parts.push("OFAC clear");
  const nationality = disclosed(credentials.nationality);
  if (nationality) parts.push(`nationality: ${nationality}`);
  return parts.join(", ");
}

// ── HTTP ────────────────────────────────────────────────────────────────────

/** Timeout for outbound HTTP calls made by tools. */
export const OUTBOUND_TIMEOUT_MS = 15_000;
const API_MAX_BYTES = 512 * 1024;

/**
 * Read at most maxBytes of a body, cancelling the rest of the stream.
 *
 * @param source - Response whose body to read.
 * @param maxBytes - Byte cap.
 * @returns The UTF-8 text (cut at maxBytes) and whether the body was longer.
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

/** A REST route's status and parsed JSON body ({} when not a JSON object). */
export type ApiResult = {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
};

/**
 * Call the Self Agent ID REST API (SELF_AGENT_API_BASE) with a 15 s timeout.
 *
 * @param config - Server config (for apiUrl).
 * @param path - Route path with query, e.g. "/api/agent/info/42220/1".
 * @param init - Method, headers and body for the request.
 * @returns Status, ok flag and the JSON body; data is {} when the body is not
 *   a JSON object or exceeds 512 KiB.
 * @throws On network errors or timeout.
 */
export async function apiFetch(
  config: Pick<ServerConfig, "apiUrl">,
  path: string,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<ApiResult> {
  const response = await fetch(`${config.apiUrl}${path}`, {
    ...init,
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  });
  const { text, truncated } = await readTextCapped(response, API_MAX_BYTES);
  let data: Record<string, unknown> = {};
  if (!truncated) {
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // Non-JSON body: callers fall back to the status code.
    }
  }
  return { status: response.status, ok: response.ok, data };
}

/**
 * Pick the error text to show for a failed REST call.
 *
 * @param result - Result from apiFetch.
 * @returns The body's `error` string, or "HTTP <status>".
 */
export function apiErrorText(result: ApiResult): string {
  return typeof result.data.error === "string"
    ? result.data.error
    : `HTTP ${result.status}`;
}
