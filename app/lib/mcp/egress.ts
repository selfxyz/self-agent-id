// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Egress policy for the self_authenticated_fetch MCP tool.
 *
 * The tool sends requests signed with the server's agent key, so it must
 * never reach internal services. MCP_AUTH_FETCH_ALLOWED_HOSTS restricts hosts
 * (supports "*.example.com"); MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS=true
 * disables the private-network check.
 */

import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const HTTP_PROTOCOLS = new Set(["http:", "https:"]);

// Private, loopback, link-local, shared, reserved, documentation, benchmark and
// multicast ranges. BlockList also matches IPv4-mapped IPv6 (::ffff:a.b.c.d)
// against the IPv4 rules.
const BLOCKED_RANGES: Array<[string, number, "ipv4" | "ipv6"]> = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.88.99.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"], // includes 255.255.255.255
  ["::", 96, "ipv6"], // unspecified, loopback, IPv4-compatible
  ["64:ff9b::", 96, "ipv6"], // NAT64
  ["64:ff9b:1::", 48, "ipv6"], // local-use NAT64
  ["100::", 64, "ipv6"], // discard-only
  ["2001::", 32, "ipv6"], // Teredo
  ["2001:db8::", 32, "ipv6"], // documentation
  ["2002::", 16, "ipv6"], // 6to4
  ["fc00::", 7, "ipv6"], // unique-local
  ["fe80::", 10, "ipv6"], // link-local
  ["fec0::", 10, "ipv6"], // site-local
  ["ff00::", 8, "ipv6"], // multicast
];

const blockedAddresses = new BlockList();
for (const [net, prefix, type] of BLOCKED_RANGES) {
  blockedAddresses.addSubnet(net, prefix, type);
}

/**
 * Check whether an IP is in a blocked (non-public) range.
 *
 * @param address - IPv4 or IPv6 literal.
 * @returns True if blocked, or if the input is not an IP at all.
 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 0) return true;
  return blockedAddresses.check(address, version === 4 ? "ipv4" : "ipv6");
}

/**
 * Parse the comma-separated host allowlist (lowercased, trailing dot dropped).
 *
 * @param raw - MCP_AUTH_FETCH_ALLOWED_HOSTS value.
 * @returns Host patterns.
 */
function parseHostAllowlist(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/\.$/, ""))
    .filter(Boolean);
}

/**
 * Match a host against one allowlist pattern.
 *
 * @param host - Normalised hostname.
 * @param pattern - Exact host, or "*.suffix" (matches subdomains only, not
 *   the bare suffix).
 * @returns True on a match.
 */
function hostMatchesPattern(host: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return host.endsWith(`.${suffix}`);
  }
  return host === pattern;
}

/**
 * Read a boolean environment flag.
 *
 * @param name - Variable name.
 * @param fallback - Value when unset or empty.
 * @returns True for "1", "true" or "yes" (case-insensitive), else false.
 */
function envFlag(name: string, fallback: boolean): boolean {
  const value = (process.env[name] || "").trim().toLowerCase();
  if (!value) return fallback;
  return value === "1" || value === "true" || value === "yes";
}

/** Outcome of an egress check: the parsed URL, or why it was refused. */
type EgressResult = { ok: true; url: URL } | { ok: false; error: string };

/**
 * Validate one hop of an authenticated fetch.
 *
 * Callers must re-run this for every redirect target. Checks, in order: URL
 * parses, http(s) only, host allowlist (when set), then (unless private
 * networks are allowed) IP literals, single-label / .localhost / .internal
 * names, and every DNS answer against the blocked ranges.
 *
 * @param rawUrl - URL requested by the MCP client or a redirect.
 * @returns `{ ok: true, url }`, or `{ ok: false, error }` with the reason.
 */
export async function validateAuthenticatedFetchUrl(
  rawUrl: string,
): Promise<EgressResult> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  if (!HTTP_PROTOCOLS.has(parsed.protocol)) {
    return { ok: false, error: "Only http:// and https:// URLs are allowed" };
  }

  // URL.hostname keeps IPv6 brackets and a trailing root dot.
  const host = parsed.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  const allowlist = parseHostAllowlist(
    process.env.MCP_AUTH_FETCH_ALLOWED_HOSTS || "",
  );
  if (
    allowlist.length > 0 &&
    !allowlist.some((pattern) => hostMatchesPattern(host, pattern))
  ) {
    return {
      ok: false,
      error:
        `Host "${host}" is not allowed. ` +
        "Add it to MCP_AUTH_FETCH_ALLOWED_HOSTS.",
    };
  }

  if (envFlag("MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS", false)) {
    return { ok: true, url: parsed };
  }

  const blocked: EgressResult = {
    ok: false,
    error:
      `Host "${host}" resolves to a private/local network target. ` +
      "Set MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS=true to override.",
  };

  if (isIP(host))
    return isBlockedAddress(host) ? blocked : { ok: true, url: parsed };

  // Single-label names (intranet hosts, "localhost", "metadata") and the
  // reserved .localhost / .internal suffixes never point at public services.
  if (
    !host.includes(".") ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal")
  ) {
    return blocked;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    return { ok: false, error: `Host "${host}" could not be resolved` };
  }
  // ponytail: fetch() resolves the name again, so a DNS-rebinding server can
  // still answer differently between this check and the connect. Closing that
  // needs a pinned-IP dispatcher (undici connect.lookup); set
  // MCP_AUTH_FETCH_ALLOWED_HOSTS in production to remove the exposure.
  if (
    addresses.length === 0 ||
    addresses.some((a) => isBlockedAddress(a.address))
  ) {
    return blocked;
  }

  return { ok: true, url: parsed };
}
