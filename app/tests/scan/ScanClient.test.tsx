// @vitest-environment jsdom

import React from "react";
import { cleanup, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

// Mock @selfxyz/qrcode so the QR wrapper is a simple stub
vi.mock("@selfxyz/qrcode", () => ({
  SelfQRcodeWrapper: ({
    onError,
  }: {
    onError?: (d: { reason?: string }) => void;
  }) =>
    React.createElement(
      "div",
      {
        "data-testid": "qr-wrapper",
        onClick: () => onError?.({ reason: "scan-error" }),
      },
      "QR",
    ),
}));

// Mock next/dynamic to synchronously return our stub — ignores the factory
vi.mock("next/dynamic", () => ({
  default: (
    _factory: unknown,
    _opts?: unknown,
  ): React.ComponentType<{
    onError?: (d: { reason?: string; error_code?: string }) => void;
    size?: number;
    selfApp?: unknown;
  }> =>
    function MockDynamic({ onError }) {
      return React.createElement(
        "div",
        {
          "data-testid": "qr-wrapper",
          onClick: () => onError?.({ reason: "scan-error" }),
        },
        "QR",
      );
    },
}));

// Fake fetch — overridden per test
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import ScanClient from "@/app/scan/[sessionToken]/ScanClient";

const BASE_PROPS = {
  sessionToken: "test-token",
  sessionType: "register" as const,
  qrData: {} as never,
  deepLink: "selfid://test",
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function pendingFetch() {
  mockFetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ stage: "qr-ready" }),
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ── Render tests ─────────────────────────────────────────────────────────────

describe("ScanClient — initial render (desktop)", () => {
  it("shows QR wrapper and register title", () => {
    pendingFetch();
    render(React.createElement(ScanClient, BASE_PROPS));
    expect(screen.getByText("Register Your Agent")).toBeTruthy();
    expect(screen.getByTestId("qr-wrapper")).toBeTruthy();
    expect(screen.getByText(/Waiting for scan/i)).toBeTruthy();
  });

  it("renders deep link button with correct href", () => {
    pendingFetch();
    render(React.createElement(ScanClient, BASE_PROPS));
    const link = screen.getByRole("link", {
      name: /Open Self App to Register/i,
    });
    expect((link as HTMLAnchorElement).href).toContain("selfid://test");
  });
});

describe("ScanClient — copy per session type", () => {
  it.each([
    ["identify", "Verify Your Identity"],
    ["deregister", "Confirm Deregistration"],
    ["refresh", "Refresh Your Proof"],
    ["register", "Register Your Agent"],
  ] as const)("%s shows correct title", (type, title) => {
    pendingFetch();
    render(
      React.createElement(ScanClient, { ...BASE_PROPS, sessionType: type }),
    );
    expect(screen.getByText(title)).toBeTruthy();
  });
});

// ── Polling tests ─────────────────────────────────────────────────────────────

describe("ScanClient — polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("polls the correct status URL with Bearer token for each session type", async () => {
    for (const type of [
      "register",
      "identify",
      "deregister",
      "refresh",
    ] as const) {
      cleanup();
      mockFetch.mockClear();
      pendingFetch();

      render(
        React.createElement(ScanClient, { ...BASE_PROPS, sessionType: type }),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3100);
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `/api/agent/${type}/status`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );
    }
  });

  // Helper: fire the interval then drain the microtask queue so the
  // void async IIFE inside setInterval can complete its fetch + setState.
  async function tickPoll() {
    await act(async () => {
      vi.advanceTimersByTime(3100);
      // Drain: fetch resolves → json() resolves → setState called
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
  }

  it("transitions to success when polling returns stage=completed", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ stage: "completed" }),
    });

    render(React.createElement(ScanClient, BASE_PROPS));
    await tickPoll();

    expect(
      screen.getByText("Agent registered! Your identity is now linked."),
    ).toBeTruthy();
  });

  it("transitions to expired on 410 response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 410,
      json: async () => ({}),
    });

    render(React.createElement(ScanClient, BASE_PROPS));
    await tickPoll();

    expect(screen.getByText("Session Expired")).toBeTruthy();
  });

  it("uses the rotated session token on subsequent polls", async () => {
    let callCount = 0;
    mockFetch.mockImplementation(async () => {
      callCount++;
      return {
        ok: true,
        status: 200,
        json: async () =>
          callCount === 1
            ? { stage: "qr-ready", sessionToken: "rotated-token" }
            : { stage: "completed" },
      };
    });

    render(React.createElement(ScanClient, BASE_PROPS));

    await tickPoll(); // first poll — receives rotated token
    await tickPoll(); // second poll — should use rotated token

    const secondCall = mockFetch.mock.calls[1];
    const headers = secondCall?.[1]?.headers as Record<string, string>;
    expect(headers?.["Authorization"]).toBe("Bearer rotated-token");
  });
});

// ── Expiry timer ──────────────────────────────────────────────────────────────

describe("ScanClient — expiry timer", () => {
  it("immediately shows expired screen when expiresAt is in the past", async () => {
    vi.useFakeTimers();
    pendingFetch();

    render(
      React.createElement(ScanClient, {
        ...BASE_PROPS,
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByText("Session Expired")).toBeTruthy();
  });
});

// ── QR error ──────────────────────────────────────────────────────────────────

describe("ScanClient — QR onError callback", () => {
  it("shows error screen when QR wrapper fires onError", async () => {
    pendingFetch();
    render(React.createElement(ScanClient, BASE_PROPS));

    const qr = screen.getByTestId("qr-wrapper");
    await act(async () => {
      qr.click();
    });

    expect(screen.getByText("Scan Failed")).toBeTruthy();
    expect(screen.getByText("scan-error")).toBeTruthy();
  });
});
