import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";

const mockCheckRateLimit = vi.fn();
const mockGetClientIp = vi.fn();
const mockValidateAllowedOrigin = vi.fn();
const mockVerifyAaProxyToken = vi.fn();
const mockIssueAaProxyToken = vi.fn();

async function loadRoute(
  routePath: string,
  opts?: { pimlicoApiKey?: string | undefined },
) {
  vi.resetModules();

  if (opts && "pimlicoApiKey" in opts) {
    if (opts.pimlicoApiKey === undefined) {
      vi.stubEnv("PIMLICO_API_KEY", "");
      delete process.env.PIMLICO_API_KEY;
    } else {
      vi.stubEnv("PIMLICO_API_KEY", opts.pimlicoApiKey);
    }
  } else {
    vi.stubEnv("PIMLICO_API_KEY", "pimlico-test-key");
  }

  vi.doMock("@/lib/rateLimit", () => ({
    checkRateLimit: mockCheckRateLimit,
  }));

  vi.doMock("@/lib/aaProxyAuth", () => ({
    getClientIp: mockGetClientIp,
    validateAllowedOrigin: mockValidateAllowedOrigin,
    verifyAaProxyToken: mockVerifyAaProxyToken,
    issueAaProxyToken: mockIssueAaProxyToken,
  }));

  return import(routePath);
}

describe("AA token route", () => {
  beforeEach(() => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 500,
    });
    mockGetClientIp.mockReturnValue("203.0.113.10");
    mockValidateAllowedOrigin.mockReturnValue({ ok: true });
    mockIssueAaProxyToken.mockReturnValue({
      token: "signed.token",
      expiresAt: 123456789,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it("rejects when origin validation fails", async () => {
    mockValidateAllowedOrigin.mockReturnValue({
      ok: false,
      error: "Origin blocked",
    });
    const { POST } = await loadRoute("@/app/api/aa/token/route");

    const res = await POST(
      makeNextRequest("https://example.com/api/aa/token?chainId=42220", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(403);
    expect(await jsonBody(res)).toEqual({ error: "Origin blocked" });
  });

  it("rejects unsupported chain IDs", async () => {
    const { POST } = await loadRoute("@/app/api/aa/token/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/token?chainId=999", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Unsupported or missing chain",
    });
  });

  it("returns 429 when token issuance rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 2000,
    });
    const { POST } = await loadRoute("@/app/api/aa/token/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/token?chainId=42220", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(429);
    expect(await jsonBody(res)).toEqual({
      error: "Rate limit exceeded",
      retryAfterMs: 2000,
    });
  });

  it("returns 503 when token signing fails", async () => {
    mockIssueAaProxyToken.mockReturnValue({ error: "Missing secret" });
    const { POST } = await loadRoute("@/app/api/aa/token/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/token?chainId=42220", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(503);
    expect(await jsonBody(res)).toEqual({ error: "Missing secret" });
  });

  it("issues an AA proxy token for valid requests", async () => {
    const { POST } = await loadRoute("@/app/api/aa/token/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/token?chainId=11142220", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      token: "signed.token",
      expiresAt: 123456789,
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith({
      key: "aa:token:11142220:203.0.113.10",
      limit: expect.any(Number),
      windowMs: 60000,
    });
  });
});

describe("AA bundler route", () => {
  beforeEach(() => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 500,
    });
    mockGetClientIp.mockReturnValue("203.0.113.11");
    mockValidateAllowedOrigin.mockReturnValue({ ok: true });
    mockVerifyAaProxyToken.mockReturnValue({ ok: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"upstream":"ok"}', { status: 201 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("returns 503 when the Pimlico key is not configured", async () => {
    const { POST } = await loadRoute("@/app/api/aa/bundler/route", {
      pimlicoApiKey: undefined,
    });

    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_chainId",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(503);
    expect(await jsonBody(res)).toEqual({ error: "Bundler not configured" });
  });

  it("requires a proxy token header", async () => {
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_chainId",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(401);
    expect(await jsonBody(res)).toEqual({ error: "Missing AA proxy token" });
  });

  it("validates JSON-RPC method allowlist", async () => {
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_blockNumber",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Method not allowed: eth_blockNumber",
    });
  });

  it("proxies valid requests to Pimlico", async () => {
    const fetchMock = vi.mocked(fetch);
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "eth_chainId",
      params: [],
      id: 1,
    });
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=11142220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body,
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.pimlico.io/v2/11142220/rpc?apikey=pimlico-test-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );
    expect(res.status).toBe(201);
    await expect(res.text()).resolves.toBe('{"upstream":"ok"}');
  });

  it("returns 429 when bundler rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 3000,
    });
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_chainId",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(429);
    expect(await jsonBody(res)).toEqual({
      error: "Rate limit exceeded",
      retryAfterMs: 3000,
    });
  });

  // SECURITY_GAP: Finding A2 — body.length uses character count, not byte count.
  // Multi-byte characters can bypass the 200k limit. When hardened to use
  // Buffer.byteLength, this test should fail and be updated.
  it("enforces max body size by character count", async () => {
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body: "x".repeat(200001),
      }),
    );

    expect(res.status).toBe(413);
    expect(await jsonBody(res)).toEqual({ error: "Request too large" });
  });

  it("rejects invalid JSON body", async () => {
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body: "{bad json",
      }),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ error: "Invalid JSON body" });
  });

  it("rejects batch (array) requests", async () => {
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body: JSON.stringify([
          { jsonrpc: "2.0", method: "eth_chainId", params: [] },
        ]),
      }),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Batch requests are not supported",
    });
  });

  it("rejects invalid jsonrpc field", async () => {
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body: JSON.stringify({
          jsonrpc: "1.0",
          method: "eth_chainId",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ error: "Invalid JSON-RPC request" });
  });

  it("rejects non-array params", async () => {
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_chainId",
          params: "bad",
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ error: "Invalid params" });
  });

  it("rejects when origin validation fails", async () => {
    mockValidateAllowedOrigin.mockReturnValue({
      ok: false,
      error: "Origin check failed",
    });
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_chainId",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(403);
    expect(await jsonBody(res)).toEqual({ error: "Origin check failed" });
  });

  it("rejects when token verification fails", async () => {
    mockVerifyAaProxyToken.mockReturnValue({
      ok: false,
      error: "Invalid AA token",
    });
    const { POST } = await loadRoute("@/app/api/aa/bundler/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/bundler?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "bad-token" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_chainId",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(401);
    expect(await jsonBody(res)).toEqual({ error: "Invalid AA token" });
  });
});

describe("AA paymaster route", () => {
  beforeEach(() => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      retryAfterMs: 500,
    });
    mockGetClientIp.mockReturnValue("203.0.113.12");
    mockValidateAllowedOrigin.mockReturnValue({ ok: true });
    mockVerifyAaProxyToken.mockReturnValue({ ok: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"result":"ok"}', { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("rejects unsupported chains", async () => {
    const { POST } = await loadRoute("@/app/api/aa/paymaster/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/paymaster?chainId=1", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Unsupported or missing chain",
    });
  });

  it("rejects invalid proxy tokens", async () => {
    mockVerifyAaProxyToken.mockReturnValue({ ok: false, error: "bad token" });
    const { POST } = await loadRoute("@/app/api/aa/paymaster/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/paymaster?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "bad" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "pm_getPaymasterData",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(401);
    expect(await jsonBody(res)).toEqual({ error: "bad token" });
  });

  it("enforces max body size", async () => {
    const { POST } = await loadRoute("@/app/api/aa/paymaster/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/paymaster?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body: "x".repeat(200001),
      }),
    );

    expect(res.status).toBe(413);
    expect(await jsonBody(res)).toEqual({ error: "Request too large" });
  });

  it("forwards valid JSON-RPC requests upstream", async () => {
    const fetchMock = vi.mocked(fetch);
    const { POST } = await loadRoute("@/app/api/aa/paymaster/route");
    const body = JSON.stringify({
      jsonrpc: "2.0",
      method: "pm_getPaymasterData",
      params: [],
      id: "abc",
    });

    const res = await POST(
      makeNextRequest("https://example.com/api/aa/paymaster?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body,
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.pimlico.io/v2/42220/rpc?apikey=pimlico-test-key",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('{"result":"ok"}');
  });

  it("returns 503 when Pimlico key is missing", async () => {
    const { POST } = await loadRoute("@/app/api/aa/paymaster/route", {
      pimlicoApiKey: undefined,
    });
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/paymaster?chainId=42220", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(503);
    expect(await jsonBody(res)).toEqual({ error: "Paymaster not configured" });
  });

  it("requires a proxy token header", async () => {
    const { POST } = await loadRoute("@/app/api/aa/paymaster/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/paymaster?chainId=42220", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(401);
    expect(await jsonBody(res)).toEqual({ error: "Missing AA proxy token" });
  });

  it("rejects when origin validation fails", async () => {
    mockValidateAllowedOrigin.mockReturnValue({
      ok: false,
      error: "Origin check failed",
    });
    const { POST } = await loadRoute("@/app/api/aa/paymaster/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/paymaster?chainId=42220", {
        method: "POST",
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "pm_getPaymasterData",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(403);
    expect(await jsonBody(res)).toEqual({ error: "Origin check failed" });
  });

  it("returns 429 when paymaster rate limit is exceeded", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 4000,
    });
    const { POST } = await loadRoute("@/app/api/aa/paymaster/route");
    const res = await POST(
      makeNextRequest("https://example.com/api/aa/paymaster?chainId=42220", {
        method: "POST",
        headers: { "x-aa-proxy-token": "ok-token" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "pm_getPaymasterData",
          params: [],
        }),
      }),
    );

    expect(res.status).toBe(429);
    expect(await jsonBody(res)).toEqual({
      error: "Rate limit exceeded",
      retryAfterMs: 4000,
    });
  });
});
