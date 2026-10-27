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
 * @param params.limit - Hits allowed per window (floored, minimum 1).
 * @param params.windowMs - Window length in ms (floored, minimum 1).
 * @returns `allowed` (this hit is within the limit), `remaining` hits, and
 *   `retryAfterMs` until the window resets (at least 1).
 */
export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  const { key, limit, windowMs } = params;
  const safeLimit = Math.max(1, Math.floor(limit));
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
