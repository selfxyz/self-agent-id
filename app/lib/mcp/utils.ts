// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Shared helpers for MCP tool handlers: tool result blocks, credential
 * summaries and calls to this deployment's REST routes.
 */

import { NextRequest } from "next/server";
import { readTextCapped } from "@/lib/agent-api-helpers";
import { disclosed } from "@/lib/agent-read";
import type { McpConfig } from "./config";

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

// ── Formatting ──────────────────────────────────────────────────────────────

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

// ── REST calls ──────────────────────────────────────────────────────────────

/** Tool error for an agent_address that parseAddress rejects. */
export const INVALID_AGENT_ADDRESS_ERROR =
  "Invalid agent_address: expected a non-zero 0x-prefixed 40-hex-digit address (mixed case must be checksummed).";

/** Timeout for outbound HTTP calls made by MCP tools. */
export const OUTBOUND_TIMEOUT_MS = 15_000;
const API_MAX_BYTES = 512 * 1024;

/** A REST route's status and parsed JSON body ({} when not a JSON object). */
export type ApiResult = {
  status: number;
  ok: boolean;
  data: Record<string, unknown>;
};

/** A route handler of this app, with any dynamic params already bound. */
export type RouteHandler = (req: NextRequest) => Response | Promise<Response>;

/**
 * Call one of this deployment's REST routes.
 *
 * By default the handler runs in-process with the MCP caller's IP headers, so
 * per-IP limits apply to each MCP client (over HTTP they would all share this
 * server's egress IP). With SELF_AGENT_API_BASE set, `path` is fetched from
 * that deployment instead (15 s timeout).
 *
 * @param config - The request's MCP config.
 * @param path - Route path with query, e.g. "/api/agent/info/42220/1".
 * @param handler - The route handler to run in-process.
 * @param init - Method, headers and body for the request.
 * @returns Status, ok flag and the JSON body; data is {} when the body is not
 *   a JSON object or exceeds 512 KiB.
 * @throws On network errors or timeout (remote), or if the handler throws.
 */
export async function apiFetch(
  config: McpConfig,
  path: string,
  handler: RouteHandler,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<ApiResult> {
  const response = config.apiUrl
    ? await fetch(`${config.apiUrl}${path}`, {
        ...init,
        signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
      })
    : await handler(
        new NextRequest(`${config.appUrl}${path}`, {
          ...init,
          headers: { ...init.headers, ...config.callerHeaders },
        }),
      );
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
