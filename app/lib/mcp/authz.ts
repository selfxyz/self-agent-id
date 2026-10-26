// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Privileged MCP access check.
 *
 * A bearer token matching MCP_PRIVILEGED_API_KEY or one of the comma-separated
 * MCP_PRIVILEGED_API_KEYS unlocks the tools that use the server's agent key.
 * Any other bearer token (or none) is anonymous, so public tools keep working.
 */

import { timingSafeEqual } from "crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

/** Scope granted to callers holding a privileged API key. */
export const MCP_PRIVILEGED_SCOPE = "mcp:privileged";

/**
 * Split a comma-separated list, trimming entries and dropping empties.
 *
 * @param raw - Comma-separated string.
 * @returns The non-empty entries.
 */
function parseTokenList(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * Read the configured privileged API keys from the environment.
 *
 * @returns Deduplicated keys from MCP_PRIVILEGED_API_KEY and
 *   MCP_PRIVILEGED_API_KEYS (empty when neither is set).
 */
function getPrivilegedApiKeys(): string[] {
  const single = (process.env.MCP_PRIVILEGED_API_KEY || "").trim();
  const list = parseTokenList(process.env.MCP_PRIVILEGED_API_KEYS || "");
  const all = single ? [single, ...list] : list;

  return [...new Set(all)];
}

/**
 * Compare two strings in constant time (for equal lengths).
 *
 * @param a - First string.
 * @param b - Second string.
 * @returns True when the UTF-8 bytes match.
 */
function secureEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Check a token against every known key without short-circuiting.
 *
 * @param token - Bearer token from the request.
 * @param knownTokens - Configured privileged keys.
 * @returns True if any key matches.
 */
function isKnownPrivilegedToken(token: string, knownTokens: string[]): boolean {
  let matched = false;
  for (const candidate of knownTokens) {
    matched = secureEquals(token, candidate) || matched;
  }
  return matched;
}

/**
 * Turn an MCP bearer token into privileged auth info.
 *
 * @param bearerToken - Token from the Authorization header, if any.
 * @returns AuthInfo with the privileged scope when the token matches a
 *   configured key; undefined (anonymous) otherwise.
 */
export function verifyMcpBearerToken(
  bearerToken: string | undefined,
): AuthInfo | undefined {
  if (!bearerToken) return undefined;

  const keys = getPrivilegedApiKeys();
  if (!isKnownPrivilegedToken(bearerToken, keys)) return undefined;

  return {
    token: bearerToken,
    clientId: "mcp-privileged",
    scopes: [MCP_PRIVILEGED_SCOPE],
  };
}

/**
 * Check whether a caller's auth info carries the privileged scope.
 *
 * @param authInfo - Auth info attached to the MCP request, if any.
 * @returns True when the privileged scope is present.
 */
export function hasPrivilegedScope(
  authInfo: { scopes?: string[] } | undefined,
): boolean {
  return Boolean(authInfo?.scopes?.includes(MCP_PRIVILEGED_SCOPE));
}
