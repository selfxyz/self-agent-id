// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// ── In-memory rate limiter for relayer-funded API endpoints ─────────────────
// Prevents spam draining the relayer wallet. Resets on server restart.

interface RateLimitEntry {
  timestamps: number[];
}

const PER_IP_LIMIT = 5; // max requests per window per IP
const GLOBAL_LIMIT = 50; // max requests per window across all IPs
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

const ipMap = new Map<string, RateLimitEntry>();
let globalTimestamps: number[] = [];

function pruneTimestamps(timestamps: number[], now: number): number[] {
  return timestamps.filter((t) => now - t < WINDOW_MS);
}

/**
 * Check if a request should be rate-limited.
 * Returns null if allowed, or an error message if blocked.
 */
export function checkRateLimit(ip: string): string | null {
  const now = Date.now();

  // Global limit
  globalTimestamps = pruneTimestamps(globalTimestamps, now);
  if (globalTimestamps.length >= GLOBAL_LIMIT) {
    return "Rate limit exceeded — too many requests globally. Try again later.";
  }

  // Per-IP limit
  const entry = ipMap.get(ip);
  if (entry) {
    entry.timestamps = pruneTimestamps(entry.timestamps, now);
    if (entry.timestamps.length >= PER_IP_LIMIT) {
      return "Rate limit exceeded — max 5 visa claims per hour. Try again later.";
    }
  }

  return null;
}

/**
 * Record a successful relayer transaction (call after tx is sent, not before).
 */
export function recordRelayerTx(ip: string): void {
  const now = Date.now();

  globalTimestamps.push(now);

  const entry = ipMap.get(ip);
  if (entry) {
    entry.timestamps.push(now);
  } else {
    ipMap.set(ip, { timestamps: [now] });
  }
}
