// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Key/value store for rate limits and replay guards.
 *
 * Uses Upstash Redis (REST) when UPSTASH_REDIS_REST_URL/TOKEN are set,
 * otherwise an in-memory map that is per-instance and lost on cold start.
 * Upstash errors fall back to memory instead of failing the request.
 */

/** In-memory counter for one window. */
type CounterEntry = { count: number; expiresAt: number };

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const USE_UPSTASH = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

if (!USE_UPSTASH && typeof process !== "undefined") {
  console.warn(
    "[security-store] UPSTASH_REDIS_REST_URL/TOKEN not set — " +
      "rate limiting and replay protection will use in-memory fallback. " +
      "This does not persist across serverless invocations or scale across instances.",
  );
}

/** globalThis slots that keep the memory maps alive across dev hot reloads. */
type GlobalState = typeof globalThis & {
  __selfMemorySet?: Map<string, number>;
  __selfMemoryCounters?: Map<string, CounterEntry>;
};

const g = globalThis as GlobalState;
const memorySet = g.__selfMemorySet || new Map<string, number>();
const memoryCounters =
  g.__selfMemoryCounters || new Map<string, CounterEntry>();
g.__selfMemorySet = memorySet;
g.__selfMemoryCounters = memoryCounters;

/**
 * Read the current time.
 *
 * @returns Milliseconds since the epoch.
 */
function nowMs(): number {
  return Date.now();
}

/**
 * Drop expired entries from both in-memory maps.
 *
 * @param now - Current time in ms.
 */
function cleanupMemory(now: number): void {
  for (const [key, exp] of memorySet.entries()) {
    if (exp <= now) memorySet.delete(key);
  }
  for (const [key, entry] of memoryCounters.entries()) {
    if (entry.expiresAt <= now) memoryCounters.delete(key);
  }
}

/**
 * Run one Redis command through the Upstash REST API.
 *
 * @param command - Command and arguments, e.g. ["INCR", key].
 * @returns The command's `result` field.
 * @throws On a non-2xx response or an `error` in the response body.
 */
async function runUpstashCommand(
  command: (string | number)[],
): Promise<unknown> {
  const res = await fetch(UPSTASH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${UPSTASH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`Upstash command failed (${res.status})`);
  }

  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result;
}

/**
 * Report which backend is configured.
 *
 * @returns "upstash" when Upstash credentials are set, otherwise "memory".
 */
export function securityStoreMode(): "upstash" | "memory" {
  return USE_UPSTASH ? "upstash" : "memory";
}

/**
 * Set a key only if it is absent, with a TTL (replay guard).
 *
 * Atomic on Upstash (SET NX PX); best-effort per-instance in memory.
 *
 * @param key - Key to claim.
 * @param ttlMs - Time to live in ms (floored, minimum 1).
 * @returns True if the key was inserted, false if it already existed.
 */
export async function setIfAbsentWithTtl(
  key: string,
  ttlMs: number,
): Promise<boolean> {
  const ttl = Math.max(1, Math.floor(ttlMs));

  if (USE_UPSTASH) {
    try {
      const result = await runUpstashCommand([
        "SET",
        key,
        "1",
        "NX",
        "PX",
        String(ttl),
      ]);
      return result === "OK";
    } catch {
      // Fall back to in-memory mode on transient store errors.
    }
  }

  const now = nowMs();
  cleanupMemory(now);
  const existingExp = memorySet.get(key);
  if (existingExp && existingExp > now) return false;
  memorySet.set(key, now + ttl);
  return true;
}

/**
 * Increment a fixed-window counter.
 *
 * The window starts at the first increment and the key expires when it ends.
 *
 * @param key - Counter key.
 * @param windowMs - Window length in ms (floored, minimum 1).
 * @returns `count` after this increment and `ttlMs` left in the window.
 */
export async function incrementWithWindow(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number }> {
  const window = Math.max(1, Math.floor(windowMs));

  if (USE_UPSTASH) {
    try {
      // Create the key with its TTL first (INCR keeps an existing TTL), so a
      // crash between calls can never leave a counter that never expires.
      await runUpstashCommand(["SET", key, "0", "NX", "PX", String(window)]);
      const countRaw = await runUpstashCommand(["INCR", key]);
      const count = Number(countRaw || 0);
      const ttlRaw = await runUpstashCommand(["PTTL", key]);
      const ttl = Math.max(0, Number(ttlRaw || 0));
      return { count, ttlMs: ttl > 0 ? ttl : window };
    } catch {
      // Fall back to in-memory mode on transient store errors.
    }
  }

  const now = nowMs();
  cleanupMemory(now);
  const existing = memoryCounters.get(key);
  if (!existing || existing.expiresAt <= now) {
    memoryCounters.set(key, { count: 1, expiresAt: now + window });
    return { count: 1, ttlMs: window };
  }

  existing.count += 1;
  memoryCounters.set(key, existing);
  return {
    count: existing.count,
    ttlMs: Math.max(0, existing.expiresAt - now),
  };
}
