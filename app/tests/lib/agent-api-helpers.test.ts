// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for the shared API route helpers in lib/agent-api-helpers. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
    it("returns SESSION_SECRET when set", () => {
      expect(mod.getSessionSecret()).toBe("test-session-secret-32chars!!");
    });

    it("throws when SESSION_SECRET is missing", async () => {
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
    it("returns instructions for the pending stage", () => {
      const result = mod.humanInstructions("pending");
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns instructions for the qr-ready stage", () => {
      const result = mod.humanInstructions("qr-ready");
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("returns instructions for the completed stage", () => {
      const result = mod.humanInstructions("completed");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns instructions for the failed stage", () => {
      const result = mod.humanInstructions("failed");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns instructions for the expired stage", () => {
      const result = mod.humanInstructions("expired");
      expect(result.length).toBeGreaterThan(0);
    });

    it("returns an empty array for an unknown stage", () => {
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

    it("throws a constant message for unknown or inherited names", () => {
      for (const bad of ["badnet", "constructor", "__proto__"]) {
        expect(() => mod.getNetworkConfig(bad as any)).toThrow(
          /^Unknown network$/,
        );
      }
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

    it("uses a custom status when given", async () => {
      const res = mod.jsonResponse({ created: true }, 201);
      expect(res.status).toBe(201);
    });
  });

  describe("errorResponse", () => {
    it("returns an { error } body with CORS headers", async () => {
      const res = mod.errorResponse("Not found", 404);
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body).toEqual({ error: "Not found" });
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  describe("extractBearerToken", () => {
    it("reads Bearer tokens case-insensitively and nothing else", () => {
      expect(mod.extractBearerToken("Bearer abc")).toBe("abc");
      expect(mod.extractBearerToken("bearer   abc ")).toBe("abc");
      expect(mod.extractBearerToken("Basic abc")).toBeNull();
      expect(mod.extractBearerToken("Bearer ")).toBeNull();
      expect(mod.extractBearerToken(null)).toBeNull();
    });
  });

  describe("parseDisclosures", () => {
    it("defaults to no disclosures", () => {
      const r = mod.parseDisclosures(undefined);
      expect(r).toEqual({
        ok: true,
        disclosures: expect.objectContaining({ minimumAge: 0, ofac: false }),
      });
    });

    it("accepts real booleans and allowed ages", () => {
      const r = mod.parseDisclosures({
        minimumAge: 21,
        ofac: true,
        name: false,
      });
      expect(r.ok && r.disclosures).toMatchObject({
        minimumAge: 21,
        ofac: true,
        name: false,
      });
    });

    it.each([
      [{ ofac: "false" }, "disclosures.ofac must be a boolean"],
      [{ minimumAge: "18" }, "minimumAge must be 0, 18, or 21"],
      [{ minimumAge: 17 }, "minimumAge must be 0, 18, or 21"],
      ["x", "disclosures must be an object"],
      [null, "disclosures must be an object"],
      [[], "disclosures must be an object"],
    ])("rejects %j", (raw, error) => {
      expect(mod.parseDisclosures(raw)).toEqual({ ok: false, error });
    });
  });

  describe("safeErrorDescription", () => {
    it("never includes the error message (it can echo a private key)", () => {
      const err = Object.assign(
        new Error('invalid private key (value="0xdeadbeef")'),
        { code: "INVALID_ARGUMENT" },
      );
      expect(mod.safeErrorDescription(err)).toBe("Error (INVALID_ARGUMENT)");
      expect(mod.safeErrorDescription(new TypeError("0xsecret"))).toBe(
        "TypeError",
      );
      expect(mod.safeErrorDescription("0xsecret")).toBe("string");
    });
  });

  describe("trimTrailingSlashes", () => {
    it("strips any number of trailing slashes and nothing else", () => {
      expect(mod.trimTrailingSlashes("https://a.example///")).toBe(
        "https://a.example",
      );
      expect(mod.trimTrailingSlashes("https://a.example/x")).toBe(
        "https://a.example/x",
      );
      expect(mod.trimTrailingSlashes("///")).toBe("");
    });

    it("stays linear on a pathological input (no ReDoS)", () => {
      const input = "a" + "/".repeat(200_000) + "b";
      const start = performance.now();
      expect(mod.trimTrailingSlashes(input)).toBe(input);
      expect(performance.now() - start).toBeLessThan(50);
    });
  });

  describe("getAppBaseUrl", () => {
    const req = { nextUrl: { origin: "http://evil.example" } };

    it("prefers NEXT_PUBLIC_APP_URL without trailing slash", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agent-api.self.xyz/");
      expect(mod.getAppBaseUrl(req)).toBe("https://agent-api.self.xyz");
    });

    it("never trusts the request origin in production", () => {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
      vi.stubEnv("NODE_ENV", "production");
      expect(mod.getAppBaseUrl(req)).toBe("https://agent-api.self.xyz");
    });
  });

  describe("getClientIp", () => {
    /**
     * Build a minimal request-like object with the given headers.
     *
     * @param h - Header name to value map (lowercase names).
     * @returns An object with a `headers.get` lookup.
     */
    const headers = (h: Record<string, string>) => ({
      headers: { get: (n: string) => h[n] ?? null },
    });

    it("prefers x-real-ip over x-forwarded-for", () => {
      expect(
        mod.getClientIp(
          headers({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }),
        ),
      ).toBe("1.1.1.1");
    });

    it("falls back to the first forwarded hop, then unknown", () => {
      expect(
        mod.getClientIp(headers({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" })),
      ).toBe("2.2.2.2");
      expect(mod.getClientIp(headers({}))).toBe("unknown");
    });
  });

  describe("pngResponse", () => {
    it("is embeddable cross-origin and never cached", async () => {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
      const res = mod.pngResponse(png, "qr.png");
      expect(res.status).toBe(200);
      expect(Object.fromEntries(res.headers)).toMatchObject({
        "access-control-allow-origin": "*",
        "content-type": "image/png",
        "content-length": "4",
        "content-disposition": 'inline; filename="qr.png"',
        "cache-control": "no-store",
        "cross-origin-resource-policy": "cross-origin",
        "x-content-type-options": "nosniff",
      });
      expect(Buffer.from(await res.arrayBuffer())).toEqual(png);
    });
  });

  describe("readJsonObjectBody", () => {
    /**
     * Build a POST request with a raw body.
     *
     * @param body - Raw request body.
     * @param contentLength - Optional declared content-length header.
     * @returns A NextRequest.
     */
    const req = (body: string, contentLength?: string) =>
      new NextRequest("https://example.com/x", {
        method: "POST",
        body,
        headers: contentLength ? { "content-length": contentLength } : {},
      });

    it("parses a JSON object", async () => {
      expect(await mod.readJsonObjectBody(req('{"a":1}'))).toEqual({
        ok: true,
        body: { a: 1 },
      });
    });

    it.each([
      ["{bad", 400],
      ["", 400],
      ["[1]", 400],
      ["null", 400],
      ['"x"', 400],
      [JSON.stringify({ a: "x".repeat(20_000) }), 413],
    ])("rejects %s with %i", async (body, status) => {
      const r = await mod.readJsonObjectBody(req(body));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.response.status).toBe(status);
    });

    it("treats an empty body as {} only with allowEmpty", async () => {
      expect(
        await mod.readJsonObjectBody(req(" "), undefined, { allowEmpty: true }),
      ).toEqual({ ok: true, body: {} });
    });

    it("rejects an oversized declared length without reading the body", async () => {
      const r = req("{}", "999999");
      const result = await mod.readJsonObjectBody(r);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.response.status).toBe(413);
      expect(r.bodyUsed).toBe(false);
    });
  });

  describe("readTextCapped", () => {
    /**
     * Build a pull-based body stream that counts how many chunks were read.
     *
     * @param chunks - Text chunks served one per pull.
     * @returns `{ body, pulled }`: the stream and a pulled-chunk counter.
     */
    function stream(chunks: string[]) {
      let pulled = 0;
      const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull(controller) {
          if (pulled === chunks.length) return controller.close();
          controller.enqueue(new TextEncoder().encode(chunks[pulled++]));
        },
      });
      return { body, pulled: () => pulled };
    }

    it("returns the whole body when it fits", async () => {
      const { body } = stream(["ab", "cd"]);
      expect(await mod.readTextCapped({ body }, 10)).toEqual({
        text: "abcd",
        truncated: false,
      });
    });

    it("stops reading once past the cap", async () => {
      const s = stream(["aaaa", "bbbb", "cccc", "dddd"]);
      expect(await mod.readTextCapped({ body: s.body }, 5)).toEqual({
        text: "aaaab",
        truncated: true,
      });
      expect(s.pulled()).toBe(2);
    });

    it("returns empty text for a missing body", async () => {
      expect(await mod.readTextCapped({ body: null }, 5)).toEqual({
        text: "",
        truncated: false,
      });
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

// ── requireSession + sessionResponse (use real crypto) ──────────────────────

describe("requireSession + sessionResponse", () => {
  const SECRET = "test-decrypt-secret-long-enough!";
  let mod: typeof import("@/lib/agent-api-helpers");
  let sessionTokenMod: typeof import("@/lib/session-token");

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("SESSION_SECRET", SECRET);
    mod = await import("@/lib/agent-api-helpers");
    sessionTokenMod = await import("@/lib/session-token");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * Build a minimal request-like object carrying an Authorization header.
   *
   * @param value - Authorization header value, or null for none.
   * @returns An object with a `headers.get` lookup.
   */
  const withAuth = (value: string | null) => ({
    headers: {
      get: (name: string) => (name === "authorization" ? value : null),
    },
  });
  /**
   * Encrypt a register session token valid for 60s.
   *
   * @param overrides - Session fields to override.
   * @returns The encrypted session token.
   */
  const token = (
    overrides: Partial<import("@/lib/session-token").SessionData>,
  ) =>
    sessionTokenMod.encryptSession(
      {
        id: "s",
        type: "register",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      },
      SECRET,
    );
  /**
   * Assert requireSession returned an error Response and read it.
   *
   * @param result - requireSession's return value.
   * @returns `{ status, body }` of the error response.
   */
  async function failure(result: unknown) {
    expect(result).toBeInstanceOf(Response);
    const res = result as Response;
    return { status: res.status, body: await res.json() };
  }

  it("returns the session and secret for a valid Bearer token", () => {
    const { token: t } = sessionTokenMod.createSessionToken(
      { type: "register", network: "testnet" },
      SECRET,
    );
    const result = mod.requireSession(withAuth(`Bearer ${t}`), "register");
    expect(result).not.toBeInstanceOf(Response);
    const { session, secret } = result as Exclude<typeof result, Response>;
    expect(session).toMatchObject({ type: "register", network: "testnet" });
    expect(secret).toBe(SECRET);
  });

  it("uses options.token when given (export's body token)", () => {
    const result = mod.requireSession(withAuth(null), "register", {
      token: token({}),
    });
    expect(result).not.toBeInstanceOf(Response);
  });

  it("maps each failure to one status and generic message", async () => {
    expect(
      await failure(mod.requireSession(withAuth(null), "register")),
    ).toEqual({
      status: 400,
      body: {
        error:
          "Missing session token. Provide Authorization: Bearer <sessionToken>.",
      },
    });
    expect(
      await failure(mod.requireSession(withAuth("Bearer garbage"), "register")),
    ).toEqual({ status: 401, body: { error: "Invalid session token" } });
    expect(
      await failure(
        mod.requireSession(
          withAuth(`Bearer ${token({ expiresAt: new Date(0).toISOString() })}`),
          "register",
        ),
      ),
    ).toEqual({ status: 410, body: { error: "Session expired" } });
    expect(
      await failure(
        mod.requireSession(withAuth(`Bearer ${token({})}`), "refresh"),
      ),
    ).toEqual({
      status: 400,
      body: { error: "Token is not for a proof refresh session" },
    });
  });

  it("accepts recently expired tokens only with graceMs", () => {
    const expired = `Bearer ${token({
      expiresAt: new Date(Date.now() - 5_000).toISOString(),
    })}`;
    expect(mod.requireSession(withAuth(expired), "register")).toBeInstanceOf(
      Response,
    );
    expect(
      mod.requireSession(withAuth(expired), "register", { graceMs: 60_000 }),
    ).not.toBeInstanceOf(Response);
  });

  it("returns 500, not 401, when SESSION_SECRET is unset", async () => {
    const t = token({});
    vi.stubEnv("SESSION_SECRET", "");
    expect(
      await failure(mod.requireSession(withAuth(`Bearer ${t}`), "register")),
    ).toEqual({ status: 500, body: { error: "Server configuration error" } });
  });

  it("sessionResponse returns a rotated token, stage, expiry and extra fields", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const sessionData: import("@/lib/session-token").SessionData = {
      id: "test-id",
      type: "register",
      stage: "qr-ready",
      expiresAt,
    };

    const res = mod.sessionResponse(sessionData, SECRET, {
      extra: "data",
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ stage: "qr-ready", expiresAt, extra: "data" });
    expect(body.timeRemainingMs).toBeGreaterThan(0);
    expect(body.timeRemainingMs).toBeLessThanOrEqual(60_000);
    expect(
      sessionTokenMod.decryptSession(body.sessionToken, SECRET),
    ).toMatchObject({ id: "test-id", type: "register", stage: "qr-ready" });
  });

  it("sessionResponse clamps timeRemainingMs to 0 for a past expiry", async () => {
    const res = mod.sessionResponse(
      {
        id: "test-id",
        type: "register",
        stage: "expired",
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      },
      SECRET,
    );
    expect((await res.json()).timeRemainingMs).toBe(0);
  });
});

// ── Shared validation (pure; real ethers) ───────────────────────────────────

describe("shared validation", () => {
  let mod: typeof import("@/lib/agent-api-helpers");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("@/lib/agent-api-helpers");
  });

  it.each([
    ["1", 1n],
    ["42", 42n],
    [((1n << 256n) - 1n).toString(), (1n << 256n) - 1n],
  ])("validateAgentId accepts %s", (raw, expected) => {
    expect(mod.validateAgentId(raw)).toBe(expected);
  });

  it.each([
    "0",
    "-1",
    "01",
    "0x1",
    "1e3",
    " 1",
    "",
    "abc",
    (1n << 256n).toString(),
  ])("validateAgentId rejects %j", (raw) => {
    expect(mod.validateAgentId(raw)).toBeNull();
  });

  it("parseAgentIdField accepts safe numbers and decimal strings only", () => {
    expect(mod.parseAgentIdField(7)).toBe(7n);
    expect(mod.parseAgentIdField("9007199254740993")).toBe(9007199254740993n);
    for (const bad of [0, -1, 1.5, 1e80, "0x14", null, undefined, {}]) {
      expect(mod.parseAgentIdField(bad)).toBeNull();
    }
  });

  it("parseAddress rejects malformed or zero addresses and checksums valid ones", () => {
    const lower = "0x5e25ee9d40d32cb17ef2ecd006470831acf8ab95";
    expect(mod.parseAddress(lower)).toBe(
      "0x5E25Ee9d40D32Cb17EF2eCD006470831acF8Ab95",
    );
    for (const bad of [
      lower.slice(2),
      "0x5E25ee9d40D32Cb17EF2eCD006470831acF8Ab95", // bad checksum
      "0x0000000000000000000000000000000000000000",
      "XE65GB6LDNXYOFTX0NSV3FUWKOWIXAMJK36",
      42,
    ]) {
      expect(mod.parseAddress(bad)).toBeNull();
    }
  });

  it("networkForChainId maps supported chains only", () => {
    expect(mod.networkForChainId(42220)).toBe("mainnet");
    expect(mod.networkForChainId("11142220")).toBe("testnet");
    expect(mod.networkForChainId(1)).toBeNull();
  });

  it.each(["0xa4ec", " 42220 ", "42220.0", "042220", "4.222e4", ""])(
    "networkForChainId rejects non-canonical chain ID string %j",
    (raw) => {
      expect(mod.networkForChainId(raw)).toBeNull();
    },
  );
});
