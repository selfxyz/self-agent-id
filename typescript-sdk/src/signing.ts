// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";

/**
 * Canonicalize URL for signing/verification:
 * - Absolute URL -> path + query
 * - Relative path/query preserved
 *
 * @param url - The raw URL string (absolute, relative path, or query-only).
 * @returns The canonical path + query string used in signature computation.
 */
export function canonicalizeSigningUrl(url: string): string {
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

  // Best effort for relative path inputs like "api/data?x=1"
  try {
    const parsed = new URL(url, "http://self.local");
    return (parsed.pathname || "/") + parsed.search;
  } catch {
    return url;
  }
}

/**
 * Keccak256 hash of request body (empty string when absent).
 *
 * @param body - The raw request body string, or undefined/null for bodyless requests.
 * @returns The keccak256 hex digest of the body (or of the empty string).
 */
export function computeBodyHash(body?: string): string {
  const payload = body ?? "";
  return ethers.keccak256(ethers.toUtf8Bytes(payload));
}

/**
 * Keccak256 signing message used by all SDKs.
 *
 * Concatenates `timestamp + METHOD + canonicalUrl + bodyHash` and returns
 * the keccak256 digest. This is the value that agents sign with their private key.
 *
 * @param timestamp - ISO-8601 timestamp string included in the request header.
 * @param method - HTTP method (automatically uppercased).
 * @param url - Request URL (canonicalized internally).
 * @param body - Optional request body string.
 * @returns The keccak256 hex digest to be signed.
 */
export function computeSigningMessage(
  timestamp: string,
  method: string,
  url: string,
  body?: string
): string {
  const canonicalUrl = canonicalizeSigningUrl(url);
  const bodyHash = computeBodyHash(body);
  return ethers.keccak256(
    ethers.toUtf8Bytes(timestamp + method.toUpperCase() + canonicalUrl + bodyHash)
  );
}
