// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

type CounterEntry = { count: number; expiresAt: number };

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || "";
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || "";
const USE_UPSTASH = Boolean(UPSTASH_URL && UPSTASH_TOKEN);

type GlobalState = typeof globalThis & {
  __selfMemorySet?: Map<string, number>;
  __selfMemoryCounters?: Map<string, CounterEntry>;
};

const g = globalThis as GlobalState;
const memorySet = g.__selfMemorySet || new Map<string, number>();
const memoryCounters = g.__selfMemoryCounters || new Map<string, CounterEntry>();
g.__selfMemorySet = memorySet;
g.__selfMemoryCounters = memoryCounters;

function nowMs(): number {
  return Date.now();
}

function cleanupMemory(now: number): void {
  for (const [key, exp] of memorySet.entries()) {
    if (exp <= now) memorySet.delete(key);
  }
  for (const [key, entry] of memoryCounters.entries()) {
    if (entry.expiresAt <= now) memoryCounters.delete(key);
  }
}

async function runUpstashCommand(command: (string | number)[]): Promise<unknown> {
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

  const data = await res.json() as { result?: unknown; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result;
}

export function securityStoreMode(): "upstash" | "memory" {
  return USE_UPSTASH ? "upstash" : "memory";
}

/**
 * Atomic-ish set-if-absent with TTL.
 * Returns true if key was inserted, false if it already existed.
 */
export async function setIfAbsentWithTtl(key: string, ttlMs: number): Promise<boolean> {
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
 * Increment a rolling window counter.
 * Returns { count, ttlMs } for current window key.
 */
export async function incrementWithWindow(
  key: string,
  windowMs: number,
): Promise<{ count: number; ttlMs: number }> {
  const window = Math.max(1, Math.floor(windowMs));

  if (USE_UPSTASH) {
    try {
      const countRaw = await runUpstashCommand(["INCR", key]);
      const count = Number(countRaw || 0);
      if (count === 1) {
        await runUpstashCommand(["PEXPIRE", key, String(window)]);
      }
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
  return { count: existing.count, ttlMs: Math.max(0, existing.expiresAt - now) };
}

