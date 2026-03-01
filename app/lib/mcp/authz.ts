// app/lib/mcp/authz.ts

import { timingSafeEqual } from "crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

export const MCP_PRIVILEGED_SCOPE = "mcp:privileged";

function parseTokenList(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function getPrivilegedApiKeys(): string[] {
  const single = (process.env.MCP_PRIVILEGED_API_KEY || "").trim();
  const list = parseTokenList(process.env.MCP_PRIVILEGED_API_KEYS || "");
  const all = single ? [single, ...list] : list;

  return [...new Set(all)];
}

function secureEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isKnownPrivilegedToken(token: string, knownTokens: string[]): boolean {
  let matched = false;
  for (const candidate of knownTokens) {
    matched = secureEquals(token, candidate) || matched;
  }
  return matched;
}

export function verifyMcpBearerToken(
  _req: Request,
  bearerToken?: string,
): AuthInfo | undefined {
  if (!bearerToken) return undefined;

  const keys = getPrivilegedApiKeys();
  if (keys.length === 0) {
    throw new Error("Privileged MCP authentication is not configured");
  }
  if (!isKnownPrivilegedToken(bearerToken, keys)) {
    throw new Error("Invalid MCP bearer token");
  }

  return {
    token: bearerToken,
    clientId: "mcp-privileged",
    scopes: [MCP_PRIVILEGED_SCOPE],
  };
}

export function hasPrivilegedScope(
  authInfo: { scopes?: string[] } | undefined,
): boolean {
  return Boolean(authInfo?.scopes?.includes(MCP_PRIVILEGED_SCOPE));
}
