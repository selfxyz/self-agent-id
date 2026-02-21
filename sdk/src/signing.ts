import { ethers } from "ethers";

/**
 * Canonicalize URL for signing/verification:
 * - Absolute URL -> path + query
 * - Relative path/query preserved
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

/** Keccak256 hash of request body (empty string when absent) */
export function computeBodyHash(body?: string): string {
  const payload = body ?? "";
  return ethers.keccak256(ethers.toUtf8Bytes(payload));
}

/** Keccak256 signing message used by all SDKs */
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
