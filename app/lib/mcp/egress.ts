// app/lib/mcp/egress.ts

import { isIP } from "node:net";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

function parseHostAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function isIpv4Private(host: string): boolean {
  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isIpv6Private(host: string): boolean {
  const value = host.toLowerCase();

  if (value === "::1" || value === "::") return true;
  if (value.startsWith("::ffff:")) {
    const mappedIpv4 = value.slice("::ffff:".length);
    return isIpv4Private(mappedIpv4);
  }

  // fc00::/7 unique-local and fe80::/10 link-local.
  if (value.startsWith("fc") || value.startsWith("fd")) return true;
  if (
    value.startsWith("fe8") ||
    value.startsWith("fe9") ||
    value.startsWith("fea") ||
    value.startsWith("feb")
  ) {
    return true;
  }

  return false;
}

function isPrivateNetworkHost(host: string): boolean {
  const value = host.toLowerCase();
  if (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value === "metadata.google.internal"
  ) {
    return true;
  }

  const ipVersion = isIP(value);
  if (ipVersion === 4) return isIpv4Private(value);
  if (ipVersion === 6) return isIpv6Private(value);
  return false;
}

function hostMatchesPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return host.endsWith(`.${suffix}`);
  }
  return host === pattern;
}

function isAllowlistedHost(host: string, allowlist: string[]): boolean {
  return allowlist.some((pattern) => hostMatchesPattern(host, pattern));
}

function envFlag(name: string, fallback: boolean): boolean {
  const value = (process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

export function validateAuthenticatedFetchUrl(rawUrl: string):
  | {
      ok: true;
      url: URL;
    }
  | {
      ok: false;
      error: string;
    } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: "Only http:// and https:// URLs are allowed" };
  }

  const host = parsed.hostname.toLowerCase();
  const allowlist = parseHostAllowlist(
    process.env.MCP_AUTH_FETCH_ALLOWED_HOSTS || "",
  );
  if (allowlist.length > 0 && !isAllowlistedHost(host, allowlist)) {
    return {
      ok: false,
      error:
        `Host "${host}" is not allowed. ` +
        "Add it to MCP_AUTH_FETCH_ALLOWED_HOSTS.",
    };
  }

  const allowPrivateNetworks = envFlag(
    "MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS",
    false,
  );
  if (!allowPrivateNetworks && isPrivateNetworkHost(host)) {
    return {
      ok: false,
      error:
        `Host "${host}" resolves to a private/local network target. ` +
        "Set MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS=true to override.",
    };
  }

  return { ok: true, url: parsed };
}
