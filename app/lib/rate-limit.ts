// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Fixed-window rate limiter on top of the shared security store.
 *
 * Backed by Upstash when configured, otherwise per-instance memory.
 */

import { incrementWithWindow } from "@/lib/security-store";

/**
 * Count one hit against `key` and report whether it is within the limit.
 *
 * The window starts at the first hit and resets when it expires.
 *
 * @param params.key - Counter key (callers namespace it, e.g. by route and IP).
 * @param params.limit - Hits allowed per window, multiplied by
 *   RATE_LIMIT_MULTIPLIER unless `fixed` (floored, minimum 1).
 * @param params.windowMs - Window length in ms (floored, minimum 1).
 * @param params.fixed - Ignore RATE_LIMIT_MULTIPLIER (caps that bound spend, e.g. relayer gas).
 * @returns `allowed` (this hit is within the limit), `remaining` hits, and
 *   `retryAfterMs` until the window resets (at least 1).
 */
export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
  fixed?: boolean;
}): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  const { key, limit, windowMs, fixed } = params;
  const scale = fixed ? 1 : multiplier();
  const safeLimit = Math.max(1, Math.floor(limit * scale));
  const safeWindow = Math.max(1, Math.floor(windowMs));

  const { count, ttlMs } = await incrementWithWindow(key, safeWindow);
  const allowed = count <= safeLimit;
  const remaining = Math.max(0, safeLimit - count);

  return {
    allowed,
    remaining,
    retryAfterMs: Math.max(1, ttlMs),
  };
}

/**
 * RATE_LIMIT_MULTIPLIER scales every per-IP limit, e.g. 5 for an event where
 * many people share one IP. Unset, invalid or below 1 means 1.
 */
function multiplier(): number {
  const m = Number(process.env.RATE_LIMIT_MULTIPLIER);
  return Number.isFinite(m) && m > 1 ? m : 1;
}
