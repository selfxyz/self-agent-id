import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIncrementWithWindow } = vi.hoisted(() => ({
  mockIncrementWithWindow: vi.fn(),
}));

vi.mock("@/lib/securityStore", () => ({
  incrementWithWindow: mockIncrementWithWindow,
}));

import { checkRateLimit } from "@/lib/rateLimit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when count <= limit", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 3, ttlMs: 5000 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2);
  });

  it("allows when count equals limit exactly", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 5, ttlMs: 5000 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("denies when count > limit", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 6, ttlMs: 5000 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("remaining never goes negative", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 100, ttlMs: 5000 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.remaining).toBe(0);
  });

  it("retryAfterMs is at least 1", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 1, ttlMs: 0 });
    const result = await checkRateLimit({
      key: "test",
      limit: 5,
      windowMs: 60000,
    });
    expect(result.retryAfterMs).toBeGreaterThanOrEqual(1);
  });

  it("clamps limit and windowMs to min 1", async () => {
    mockIncrementWithWindow.mockResolvedValue({ count: 1, ttlMs: 1 });
    await checkRateLimit({ key: "test", limit: 0, windowMs: 0 });
    expect(mockIncrementWithWindow).toHaveBeenCalledWith("test", 1);
  });
});
