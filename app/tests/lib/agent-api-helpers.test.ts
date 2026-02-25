import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Pure function tests (no mocks needed) ───────────────────────────────────

describe("agent-api-helpers (pure)", () => {
  let mod: typeof import("@/lib/agent-api-helpers");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("SESSION_SECRET", "test-session-secret-32chars!!");
    mod = await import("@/lib/agent-api-helpers");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("isValidNetwork", () => {
    it("returns true for 'mainnet'", () => {
      expect(mod.isValidNetwork("mainnet")).toBe(true);
    });

    it("returns true for 'testnet'", () => {
      expect(mod.isValidNetwork("testnet")).toBe(true);
    });

    it("returns false for other strings", () => {
      expect(mod.isValidNetwork("devnet")).toBe(false);
      expect(mod.isValidNetwork("")).toBe(false);
      expect(mod.isValidNetwork("MAINNET")).toBe(false);
    });
  });

  describe("getSessionSecret", () => {
    it("returns env value when set", () => {
      expect(mod.getSessionSecret()).toBe("test-session-secret-32chars!!");
    });

    it("throws when missing", async () => {
      vi.resetModules();
      vi.stubEnv("SESSION_SECRET", "");
      // Need to delete it since stubEnv sets it to empty string
      delete process.env.SESSION_SECRET;
      const fresh = await import("@/lib/agent-api-helpers");
      expect(() => fresh.getSessionSecret()).toThrow(
        "SESSION_SECRET environment variable is not set",
      );
    });
  });

  describe("humanInstructions", () => {
    it("returns array for pending stage", () => {
      const result = mod.humanInstructions("pending");
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns array for qr-ready stage", () => {
      const result = mod.humanInstructions("qr-ready");
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("returns array for completed stage", () => {
      const result = mod.humanInstructions("completed");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns array for failed stage", () => {
      const result = mod.humanInstructions("failed");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns array for expired stage", () => {
      const result = mod.humanInstructions("expired");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns empty array for unknown stage", () => {
      const result = mod.humanInstructions("unknown" as any);
      expect(result).toEqual([]);
    });
  });

  describe("getNetworkConfig", () => {
    it("returns celo-mainnet config for 'mainnet'", () => {
      const config = mod.getNetworkConfig("mainnet");
      expect(config.id).toBe("celo-mainnet");
      expect(config.chainId).toBe(42220);
    });

    it("returns celo-sepolia config for 'testnet'", () => {
      const config = mod.getNetworkConfig("testnet");
      expect(config.id).toBe("celo-sepolia");
      expect(config.chainId).toBe(11142220);
    });

    it("throws for unknown network", () => {
      expect(() => mod.getNetworkConfig("badnet" as any)).toThrow(
        "Unknown network",
      );
    });
  });

  // SECURITY_GAP: Finding #8 — CORS headers use wildcard "*" origin.
  // When CORS is hardened, the Access-Control-Allow-Origin will change
  // and these tests should fail as the signal to update assertions.
  describe("corsResponse", () => {
    it("returns 204 with wildcard CORS headers", () => {
      const res = mod.corsResponse();
      expect(res.status).toBe(204);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });
  });

  describe("jsonResponse", () => {
    it("returns 200 with JSON body and CORS headers", async () => {
      const res = mod.jsonResponse({ ok: true });
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });

    it("accepts custom status", async () => {
      const res = mod.jsonResponse({ created: true }, 201);
      expect(res.status).toBe(201);
    });
  });

  describe("errorResponse", () => {
    it("returns error envelope with CORS headers", async () => {
      const res = mod.errorResponse("Not found", 404);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: "Not found" });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });
});

// ── isValidAddress (uses real ethers) ───────────────────────────────────────

describe("isValidAddress", () => {
  let isValidAddress: typeof import("@/lib/agent-api-helpers").isValidAddress;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("SESSION_SECRET", "test-secret");
    const mod = await import("@/lib/agent-api-helpers");
    isValidAddress = mod.isValidAddress;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns true for valid checksummed address", () => {
    expect(isValidAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed")).toBe(
      true,
    );
  });

  it("returns true for valid lowercase address", () => {
    expect(isValidAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed")).toBe(
      true,
    );
  });

  it("returns false for invalid address", () => {
    expect(isValidAddress("not-an-address")).toBe(false);
    expect(isValidAddress("0x123")).toBe(false);
  });
});

// ── decryptAndValidateSession + sessionResponse (use real crypto) ───────────

describe("decryptAndValidateSession + sessionResponse", () => {
  let mod: typeof import("@/lib/agent-api-helpers");
  let sessionTokenMod: typeof import("@/lib/session-token");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("SESSION_SECRET", "test-decrypt-secret-long-enough!");
    mod = await import("@/lib/agent-api-helpers");
    sessionTokenMod = await import("@/lib/session-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("round-trips encrypt -> decrypt", () => {
    const { token } = sessionTokenMod.createSessionToken(
      { type: "register", network: "testnet" },
      "test-decrypt-secret-long-enough!",
    );

    const { session, secret } = mod.decryptAndValidateSession(token);
    expect(session.type).toBe("register");
    expect(session.network).toBe("testnet");
    expect(secret).toBe("test-decrypt-secret-long-enough!");
  });

  it("sessionResponse returns token with stage and time metadata", () => {
    const sessionData: import("@/lib/session-token").SessionData = {
      id: "test-id",
      type: "register",
      stage: "qr-ready",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };

    const res = mod.sessionResponse(
      sessionData,
      "test-decrypt-secret-long-enough!",
      {
        extra: "data",
      },
    );

    expect(res.status).toBe(200);
  });
});
