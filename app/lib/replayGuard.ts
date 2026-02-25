// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";
import { setIfAbsentWithTtl } from "@/lib/securityStore";

/** Maximum age (in ms) before a signed request is considered stale. Default: 5 minutes. */
const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Normalize a URL into a canonical form for consistent signature verification.
 * Strips the origin (scheme + host) and ensures the result starts with `/`.
 * @param url - The raw URL or path to canonicalize.
 * @returns A canonical path+query string (e.g. `/api/register?network=mainnet`).
 */
function canonicalizeSigningUrl(url: string): string {
  if (!url) return "";

  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const parsed = new URL(url);
      return (parsed.pathname || "/") + parsed.search;
    } catch {
      return url;
    }
  }

  if (url.startsWith("?")) return `/${url}`;
  if (url.startsWith("/")) return url;

  try {
    const parsed = new URL(url, "http://self.local");
    return (parsed.pathname || "/") + parsed.search;
  } catch {
    return url;
  }
}

/**
 * Compute the canonical signing message hash from request parameters.
 * The message is `keccak256(timestamp + METHOD + canonicalUrl + keccak256(body))`.
 * @param params.timestamp - Unix timestamp string included in the signature.
 * @param params.method - HTTP method (uppercased internally).
 * @param params.url - Request URL (canonicalized internally).
 * @param params.body - Optional request body (empty string if absent).
 * @returns A keccak256 hex digest of the assembled message.
 */
function computeMessage(params: {
  timestamp: string;
  method: string;
  url: string;
  body?: string;
}): string {
  const canonicalUrl = canonicalizeSigningUrl(params.url);
  const bodyHash = ethers.keccak256(ethers.toUtf8Bytes(params.body ?? ""));
  return ethers.keccak256(
    ethers.toUtf8Bytes(
      params.timestamp + params.method.toUpperCase() + canonicalUrl + bodyHash,
    ),
  );
}

/**
 * Distributed replay guard keyed by signature + canonical signing message.
 * Records a request fingerprint in the security store and rejects duplicates.
 * Call only after signature verification succeeds to avoid store poisoning.
 *
 * @param params.signature - The request signature (used as part of the dedup key).
 * @param params.timestamp - Unix-epoch timestamp string from the signed request.
 * @param params.method - HTTP method of the request.
 * @param params.url - Request URL (canonicalized internally).
 * @param params.body - Optional request body.
 * @param params.maxAgeMs - Window in ms during which replays are blocked (default: {@link DEFAULT_MAX_AGE_MS}).
 * @param params.scope - Namespace prefix for the dedup key (default: `"self"`).
 * @returns `{ ok: true }` if the request is fresh, or `{ ok: false, error }` if replayed or invalid.
 */
export async function checkAndRecordReplay(params: {
  signature: string;
  timestamp: string;
  method: string;
  url: string;
  body?: string;
  maxAgeMs?: number;
  scope?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { signature, timestamp, method, url, body } = params;
  const maxAgeMs = params.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const scope = params.scope ?? "self";

  const ts = Number.parseInt(timestamp, 10);
  if (Number.isNaN(ts)) {
    return { ok: false, error: "Invalid timestamp" };
  }

  const message = computeMessage({ timestamp, method, url, body });
  const key = `replay:${scope}:${signature.toLowerCase()}:${message.toLowerCase()}`;
  const ttlMs = Math.max(1, ts + maxAgeMs - Date.now());
  const inserted = await setIfAbsentWithTtl(key, ttlMs);
  if (!inserted) return { ok: false, error: "Replay detected" };
  return { ok: true };
}

