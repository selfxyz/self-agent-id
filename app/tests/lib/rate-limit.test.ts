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
});
