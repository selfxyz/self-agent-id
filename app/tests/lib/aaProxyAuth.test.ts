import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

function makeReq(
  url: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(url, { headers });
}

// ── getClientIp ─────────────────────────────────────────────────────────────

describe("getClientIp", () => {
  let getClientIp: typeof import("@/lib/aaProxyAuth").getClientIp;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("AA_PROXY_TOKEN_SECRET", "test-secret");
    const mod = await import("@/lib/aaProxyAuth");
    getClientIp = mod.getClientIp;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("extracts first IP from x-forwarded-for with multiple entries", () => {
    const req = makeReq("https://example.com", {
      "x-forwarded-for": "1.2.3.4, 5.6.7.8",
    });
    expect(getClientIp(req)).toBe("1.2.3.4");
  });

  it("extracts single IP from x-forwarded-for", () => {
    const req = makeReq("https://example.com", {
      "x-forwarded-for": "10.0.0.1",
    });
    expect(getClientIp(req)).toBe("10.0.0.1");
  });

  it("falls back to x-real-ip", () => {
    const req = makeReq("https://example.com", {
      "x-real-ip": "192.168.1.1",
    });
    expect(getClientIp(req)).toBe("192.168.1.1");
  });

  it("returns 'unknown' when no IP headers are present", () => {
    const req = makeReq("https://example.com");
    expect(getClientIp(req)).toBe("unknown");
  });
});

// ── validateAllowedOrigin ───────────────────────────────────────────────────

describe("validateAllowedOrigin (enforce off)", () => {
  let validateAllowedOrigin: typeof import("@/lib/aaProxyAuth").validateAllowedOrigin;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("AA_PROXY_TOKEN_SECRET", "test-secret");
    vi.stubEnv("AA_PROXY_ENFORCE_ORIGIN", "false");
    const mod = await import("@/lib/aaProxyAuth");
    validateAllowedOrigin = mod.validateAllowedOrigin;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows any origin when enforcement is off", () => {
    const req = makeReq("https://example.com");
    expect(validateAllowedOrigin(req)).toEqual({ ok: true });
  });
});

describe("validateAllowedOrigin (enforce on, allowlist)", () => {
  let validateAllowedOrigin: typeof import("@/lib/aaProxyAuth").validateAllowedOrigin;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("AA_PROXY_TOKEN_SECRET", "test-secret");
    vi.stubEnv("AA_PROXY_ENFORCE_ORIGIN", "true");
    vi.stubEnv(
      "AA_PROXY_ALLOWED_ORIGINS",
      "https://app.example.com,https://other.example.com",
    );
    const mod = await import("@/lib/aaProxyAuth");
    validateAllowedOrigin = mod.validateAllowedOrigin;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows origin on the allowlist", () => {
    const req = makeReq("https://example.com", {
      origin: "https://app.example.com",
    });
    expect(validateAllowedOrigin(req)).toEqual({ ok: true });
  });

  it("rejects origin not on the allowlist", () => {
    const req = makeReq("https://example.com", {
      origin: "https://evil.com",
    });
    const result = validateAllowedOrigin(req);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Origin not allowed");
  });
});

describe("validateAllowedOrigin (enforce on, no allowlist — host match)", () => {
  let validateAllowedOrigin: typeof import("@/lib/aaProxyAuth").validateAllowedOrigin;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("AA_PROXY_TOKEN_SECRET", "test-secret");
    vi.stubEnv("AA_PROXY_ENFORCE_ORIGIN", "true");
    vi.stubEnv("AA_PROXY_ALLOWED_ORIGINS", "");
    const mod = await import("@/lib/aaProxyAuth");
    validateAllowedOrigin = mod.validateAllowedOrigin;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows when origin host matches request host", () => {
    const req = makeReq("https://example.com/api", {
      origin: "https://example.com",
      host: "example.com",
    });
    expect(validateAllowedOrigin(req)).toEqual({ ok: true });
  });

  it("rejects cross-origin when hosts differ", () => {
    const req = makeReq("https://example.com/api", {
      origin: "https://evil.com",
      host: "example.com",
    });
    const result = validateAllowedOrigin(req);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Cross-origin request blocked");
  });

  it("rejects when origin/referer is missing", () => {
    const req = makeReq("https://example.com/api", {
      host: "example.com",
    });
    const result = validateAllowedOrigin(req);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Missing origin/referer");
  });

  it("rejects malformed URL in origin", () => {
    const req = makeReq("https://example.com/api", {
      origin: "not-a-url",
      host: "example.com",
    });
    const result = validateAllowedOrigin(req);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid origin/referer");
  });
});

// ── Token issue/verify round-trip ───────────────────────────────────────────

describe("issueAaProxyToken + verifyAaProxyToken", () => {
  let issueAaProxyToken: typeof import("@/lib/aaProxyAuth").issueAaProxyToken;
  let verifyAaProxyToken: typeof import("@/lib/aaProxyAuth").verifyAaProxyToken;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("AA_PROXY_TOKEN_SECRET", "test-secret-32chars-long-enough!");
    vi.stubEnv("AA_PROXY_ENFORCE_ORIGIN", "false");
    const mod = await import("@/lib/aaProxyAuth");
    issueAaProxyToken = mod.issueAaProxyToken;
    verifyAaProxyToken = mod.verifyAaProxyToken;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("round-trips successfully with matching request", () => {
    const req = makeReq("https://example.com/api", {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "TestAgent/1.0",
    });
    const { token, expiresAt } = issueAaProxyToken(req, "42220");
    expect(token).toBeTruthy();
    expect(expiresAt).toBeGreaterThan(Date.now());

    const result = verifyAaProxyToken(req, token!, "42220");
    expect(result).toEqual({ ok: true });
  });

  it("rejects expired tokens", () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.setSystemTime(now);

    const req = makeReq("https://example.com/api", {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "TestAgent/1.0",
    });
    const { token } = issueAaProxyToken(req, "42220");
    expect(token).toBeTruthy();

    // Advance past TTL (default 90s + 10s minimum)
    vi.setSystemTime(now + 200_000);

    const result = verifyAaProxyToken(req, token!, "42220");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("AA token expired");
  });

  it("rejects when chainId does not match", () => {
    const req = makeReq("https://example.com/api", {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "TestAgent/1.0",
    });
    const { token } = issueAaProxyToken(req, "42220");

    const result = verifyAaProxyToken(req, token!, "11142220");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("AA token chain mismatch");
  });

  it("rejects when client IP changes", () => {
    const issueReq = makeReq("https://example.com/api", {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "TestAgent/1.0",
    });
    const { token } = issueAaProxyToken(issueReq, "42220");

    const verifyReq = makeReq("https://example.com/api", {
      "x-forwarded-for": "9.8.7.6",
      "user-agent": "TestAgent/1.0",
    });
    const result = verifyAaProxyToken(verifyReq, token!, "42220");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("AA token IP mismatch");
  });

  it("rejects when user-agent changes", () => {
    const issueReq = makeReq("https://example.com/api", {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "TestAgent/1.0",
    });
    const { token } = issueAaProxyToken(issueReq, "42220");

    const verifyReq = makeReq("https://example.com/api", {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "DifferentAgent/2.0",
    });
    const result = verifyAaProxyToken(verifyReq, token!, "42220");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("AA token client mismatch");
  });

  it("rejects malformed tokens", () => {
    const req = makeReq("https://example.com/api");
    const result = verifyAaProxyToken(req, "not-a-valid-token", "42220");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Malformed AA token");
  });

  it("rejects tampered signature", () => {
    const req = makeReq("https://example.com/api", {
      "x-forwarded-for": "1.2.3.4",
      "user-agent": "TestAgent/1.0",
    });
    const { token } = issueAaProxyToken(req, "42220");
    const [payloadB64] = token!.split(".");
    const tampered = `${payloadB64}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

    const result = verifyAaProxyToken(req, tampered, "42220");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Invalid AA token signature");
  });
});

// ── Missing secret ──────────────────────────────────────────────────────────
// SECURITY_GAP: Finding #12 — missing secret returns error instead of blocking startup

describe("missing AA_PROXY_TOKEN_SECRET", () => {
  let issueAaProxyToken: typeof import("@/lib/aaProxyAuth").issueAaProxyToken;
  let verifyAaProxyToken: typeof import("@/lib/aaProxyAuth").verifyAaProxyToken;

  beforeEach(async () => {
    vi.resetModules();
    vi.stubEnv("AA_PROXY_TOKEN_SECRET", "");
    const mod = await import("@/lib/aaProxyAuth");
    issueAaProxyToken = mod.issueAaProxyToken;
    verifyAaProxyToken = mod.verifyAaProxyToken;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("issueAaProxyToken returns an error", () => {
    const req = makeReq("https://example.com/api");
    const result = issueAaProxyToken(req, "42220");
    expect(result.error).toBe("AA proxy token secret is not configured");
    expect(result.token).toBeUndefined();
  });

  it("verifyAaProxyToken returns an error", () => {
    const req = makeReq("https://example.com/api");
    const result = verifyAaProxyToken(req, "some.token", "42220");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("AA proxy token secret is not configured");
  });
});
