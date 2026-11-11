// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for checkRateLimit (lib/rate-limit) over a mocked security store. */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIncrementWithWindow } = vi.hoisted(() => ({
  mockIncrementWithWindow: vi.fn(),
}));

vi.mock("@/lib/security-store", () => ({
  incrementWithWindow: mockIncrementWithWindow,
}));

import { checkRateLimit } from "@/lib/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows requests while the count is under the limit", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 3, ttlMs: 5000 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("allows a request when the count equals the limit", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 5, ttlMs: 5000 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("denies requests once the count exceeds the limit", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 6, ttlMs: 5000 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("never reports a negative remaining count", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 100, ttlMs: 5000 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.remaining).toBe(0);
  });

  it("reports a retryAfterMs of at least 1", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 1, ttlMs: 0 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(1);
  });

  it("clamps limit and windowMs to a minimum of 1", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 1, ttlMs: 1 });
    await checkRateLimit({ key: "test", limit: 0, windowMs: 0 });
    expect(mockIncrementWithWindow).toHaveBeenCalledWith("test", 1);
  });

  it("scales limits by RATE_LIMIT_MULTIPLIER unless fixed", async () => {
    vi.stubEnv("RATE_LIMIT_MULTIPLIER", "5");
    mockIncrementWithWindow.mockResolvedValue({ count: 50, ttlMs: 1000 });
    const scaled = await checkRateLimit({
      key: "a",
      limit: 10,
      windowMs: 60_000,
    });
    expect(scaled).toMatchObject({ allowed: true, remaining: 0 });
    const fixed = await checkRateLimit({
      key: "b",
      limit: 10,
      windowMs: 60_000,
      fixed: true,
    });
    expect(fixed.allowed).toBe(false);
    vi.unstubAllEnvs();
  });

  it("ignores invalid or sub-1 multipliers", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 11, ttlMs: 1000 });
    for (const v of ["abc", "0.5", "-3", ""]) {
      vi.stubEnv("RATE_LIMIT_MULTIPLIER", v);
      const r = await checkRateLimit({ key: "c", limit: 10, windowMs: 60_000 });
      expect(r.allowed).toBe(false);
    }
    vi.unstubAllEnvs();
  });
});
