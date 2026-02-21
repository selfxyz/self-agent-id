import { ethers } from "ethers";
import { setIfAbsentWithTtl } from "@/lib/securityStore";

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

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
 * Call only after signature verification succeeds to avoid poisoning.
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

