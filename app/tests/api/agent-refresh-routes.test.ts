// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for POST /api/agent/refresh and GET /api/agent/refresh/status. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";
import { NETWORKS } from "@/lib/network";

const SECRET = "test-session-secret";
const CONFIG_ID = "0x" + "ab".repeat(32);
const ZERO_BYTES32 = "0x" + "0".repeat(64);
const AGENT_KEY = "0x" + "00".repeat(12) + "11".repeat(20);
const NFT_OWNER = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const ORIGINAL_EXPIRY = 1_900_000_000n;

const mockCheckRateLimit = vi.fn();
const mockRenderQrBase64 = vi.fn(async (_text: string) => "PNG64");
const registry = {
  agentIdToAgentKey: vi.fn(),
  agentConfigId: vi.fn(),
  configIds: vi.fn(),
  ownerOf: vi.fn(),
  proofExpiresAt: vi.fn(),
  hasHumanProof: vi.fn(),
};
const builderArgs: Record<string, unknown>[] = [];

/** Stand-in for SelfAppBuilder that records its constructor args. */
class MockSelfAppBuilder {
  /**
   * Record the builder args for later assertions.
   *
   * @param args - Options the route passed to SelfAppBuilder.
   */
  constructor(private readonly args: Record<string, unknown>) {
    builderArgs.push(args);
  }
  /**
   * Build a fake Self app.
   *
   * @returns The recorded args tagged with `kind: "self-app"`.
   */
  build() {
    return { kind: "self-app", ...this.args };
  }
}

/**
 * Re-import a route module with fresh state and the rate limiter, registry,
 * QR renderer and Self QR SDK mocked.
 *
 * @param path - Module path of the route to import.
 * @returns The imported route module.
 */
async function load<T>(path: string): Promise<T> {
  vi.resetModules();
  vi.doMock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
  vi.doMock("@/lib/contract-types", () => ({ typedRegistry: () => registry }));
  vi.doMock("@/lib/render-qr", () => ({
    renderQrBase64: mockRenderQrBase64,
  }));
  vi.doMock("@selfxyz/sdk-common", () => ({
    SelfAppBuilder: MockSelfAppBuilder,
    getUniversalLink: () => "https://redirect.self.xyz/?selfApp=x",
  }));
  return import(path) as Promise<T>;
}
type InitRoute = typeof import("@/app/api/agent/refresh/route");
type StatusRoute = typeof import("@/app/api/agent/refresh/status/route");

/**
 * Build a POST /api/agent/refresh request.
 *
 * @param body - JSON body (ignored when `raw` is set).
 * @param raw - Raw body string to send instead of JSON.
 * @returns The request.
 */
function post(body: unknown, raw?: string) {
  return makeNextRequest("http://localhost:3100/api/agent/refresh", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  });
}

/**
 * Make `registry.configIds(i)` return the agent's CONFIG_ID only at one slot.
 *
 * @param index - Config slot that matches.
 */
function setConfigIndex(index: number) {
  registry.configIds.mockImplementation(async (i: bigint) =>
    Number(i) === index ? CONFIG_ID : "0x" + "22".repeat(32),
  );
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  builderArgs.length = 0;
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterMs: 0,
  });
  registry.agentIdToAgentKey.mockResolvedValue(AGENT_KEY);
  registry.agentConfigId.mockResolvedValue(CONFIG_ID);
  registry.ownerOf.mockResolvedValue(NFT_OWNER);
  registry.proofExpiresAt.mockResolvedValue(ORIGINAL_EXPIRY);
  registry.hasHumanProof.mockResolvedValue(true);
  setConfigIndex(0);
});

describe("POST /api/agent/refresh", () => {
  it("starts a session with the standard session-start shape", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/refresh/route");
    const res = await POST(post({ agentId: 20, network: "testnet" }));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body).toMatchObject({
      stage: "qr-ready",
      deepLink: "https://redirect.self.xyz/?selfApp=x",
      qrImageBase64: "PNG64",
      agentId: 20,
      network: "testnet",
      configIndex: 0,
      humanInstructions: expect.arrayContaining([
        "Open the Self app on your phone.",
      ]),
    });
    expect(typeof body.expiresAt).toBe("string");
    expect(typeof body.timeRemainingMs).toBe("number");
    expect(body.scanUrl).toMatch(/^http:\/\/localhost:3100\/api\/qr\/.+/);
    expect(body.scanUrl).not.toContain(body.sessionToken as string);
    expect(builderArgs[0]).toEqual({
      version: 2,
      appName: "Self Agent ID",
      scope: "self-agent-id",
      endpoint: NETWORKS["celo-sepolia"].registryAddress,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      endpointType: "staging_celo",
      userIdType: "hex",
      userId: NFT_OWNER.toLowerCase(),
      userDefinedData: "F0" + "\0".repeat(31) + "\x14",
      disclosures: {},
    });

    const { decryptSession, readQrToken } = await import("@/lib/session-token");
    expect(decryptSession(body.sessionToken as string, SECRET)).toMatchObject({
      type: "refresh",
      stage: "qr-ready",
      agentId: 20,
      originalProofExpiry: ORIGINAL_EXPIRY.toString(),
    });
    const qrToken = (body.scanUrl as string).split("/api/qr/")[1];
    expect(readQrToken(qrToken, SECRET).deepLink).toBe(body.deepLink);
  });

  it("derives the on-chain config when disclosures are omitted", async () => {
    setConfigIndex(5);
    const { POST } = await load<InitRoute>("@/app/api/agent/refresh/route");
    const res = await POST(post({ agentId: "20", network: "testnet" }));
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).configIndex).toBe(5);
    expect(builderArgs[0]).toMatchObject({
      userDefinedData: "F5" + "\0".repeat(31) + "\x14",
      disclosures: { minimumAge: 21, ofac: true },
    });
  });

  it("accepts matching disclosures and rejects conflicting ones", async () => {
    setConfigIndex(4);
    const { POST } = await load<InitRoute>("@/app/api/agent/refresh/route");
    const ok = await POST(
      post({
        agentId: 20,
        network: "testnet",
        disclosures: { minimumAge: 18, ofac: true, nationality: true },
      }),
    );
    expect(ok.status).toBe(200);
    expect(builderArgs[0].disclosures).toEqual({
      minimumAge: 18,
      ofac: true,
      nationality: true,
    });

    const mismatch = await POST(
      post({ agentId: 20, network: "testnet", disclosures: {} }),
    );
    expect(mismatch.status).toBe(400);
    expect((await jsonBody<{ error: string }>(mismatch)).error).toMatch(
      /Disclosure mismatch/,
    );
  });

  it("returns 422 for agent IDs the deployed contract would decode differently", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/refresh/route");
    for (const [agentId, status] of [
      [127, 200],
      [128, 422],
      [256, 200],
      [384, 422],
    ] as const) {
      const res = await POST(post({ agentId, network: "testnet" }));
      expect(res.status, `agent ${agentId}`).toBe(status);
      if (status === 422) {
        expect((await jsonBody<{ error: string }>(res)).error).toMatch(
          /registry is upgraded.*deregister it and register again/s,
        );
      }
    }
  });

  it("rejects malformed input with 400 and oversized bodies with 413", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/refresh/route");
    const bad: [unknown, string?][] = [
      [null, "[]"],
      [null, "{"],
      [{ agentId: 1e80, network: "testnet" }],
      [{ agentId: 2 ** 53, network: "testnet" }],
      [{ agentId: 1.5, network: "testnet" }],
      [{ agentId: "0x14", network: "testnet" }],
      [{ agentId: "1e1", network: "testnet" }],
      [{ agentId: true, network: "testnet" }],
      [{ agentId: 20 }],
      [{ agentId: 20, network: { a: 1 } }],
      [{ agentId: 20, network: "testnet", disclosures: { ofac: "no" } }],
      [{ agentId: 20, network: "testnet", disclosures: { minimumAge: 30 } }],
      [{ agentId: 20, network: "testnet", disclosures: null }],
      [{ agentId: 20, network: "testnet", disclosures: "x" }],
    ];
    for (const [body, raw] of bad) {
      const res = await POST(post(body, raw));
      expect(res.status, JSON.stringify(body ?? raw)).toBe(400);
    }
    const big = await POST(
      post({ agentId: 20, network: "testnet", pad: "x".repeat(20_000) }),
    );
    expect(big.status).toBe(413);
  });

  it("returns 404 for agents that don't exist and 400 for unrefreshable ones", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/refresh/route");
    expect(
      (
        await POST(
          post({ agentId: "99999999999999999999", network: "testnet" }),
        )
      ).status,
    ).toBe(404);

    registry.agentIdToAgentKey.mockResolvedValue(ZERO_BYTES32);
    const missing = await POST(post({ agentId: 9999, network: "testnet" }));
    expect(missing.status).toBe(404);
    expect(await jsonBody(missing)).toEqual({ error: "Agent not found" });

    registry.agentIdToAgentKey.mockResolvedValue(AGENT_KEY);
    registry.agentConfigId.mockResolvedValue(ZERO_BYTES32);
    const noConfig = await POST(post({ agentId: 20, network: "testnet" }));
    expect(noConfig.status).toBe(400);
    expect((await jsonBody(noConfig)).error).toMatch(
      /^This agent has no stored verification config/,
    );
  });

  it("returns 500 when the QR cannot be rendered", async () => {
    mockRenderQrBase64.mockRejectedValueOnce(new Error("data too big"));
    const { POST } = await load<InitRoute>("@/app/api/agent/refresh/route");
    const res = await POST(post({ agentId: 20, network: "testnet" }));
    expect(res.status).toBe(500);
    expect(await jsonBody(res)).toEqual({ error: "Failed to render QR code" });
  });

  it("returns a generic 502 on RPC failure and 429 with Retry-After when rate limited", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/refresh/route");
    registry.agentIdToAgentKey.mockRejectedValue(
      new Error('value out-of-bounds (argument="tokenId")'),
    );
    const rpc = await POST(post({ agentId: 20, network: "testnet" }));
    expect(rpc.status).toBe(502);
    expect(await jsonBody(rpc)).toEqual({ error: "RPC error" });

    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 30_000,
    });
    const limited = await POST(post({ agentId: 20, network: "testnet" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("30");
  });
});

describe("GET /api/agent/refresh/status", () => {
  /**
   * Start a testnet refresh session for agent 20 via the real init route.
   *
   * @returns The new session token.
   */
  async function startSession() {
    const { POST } = await load<InitRoute>("@/app/api/agent/refresh/route");
    const body = await jsonBody<{ sessionToken: string }>(
      await POST(post({ agentId: 20, network: "testnet" })),
    );
    return body.sessionToken;
  }
  /**
   * Build a status request.
   *
   * @param token - Session token sent as a Bearer header.
   * @returns The request.
   */
  function status(token: string) {
    return makeNextRequest("http://localhost:3100/api/agent/refresh/status", {
      headers: { authorization: `Bearer ${token}` },
    });
  }

  it("stays qr-ready until the expiry moves, then completes with an ISO proofExpiresAt", async () => {
    const token = await startSession();
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/refresh/status/route",
    );
    const pending = await jsonBody(await GET(status(token)));
    expect(pending).toMatchObject({ stage: "qr-ready", agentId: 20 });
    expect(pending.proofExpiresAt).toBeUndefined();

    registry.proofExpiresAt.mockResolvedValue(ORIGINAL_EXPIRY + 100n);
    const done = await jsonBody(
      await GET(status(pending.sessionToken as string)),
    );
    expect(done).toMatchObject({
      stage: "completed",
      agentId: 20,
      proofExpiresAt: new Date(
        Number(ORIGINAL_EXPIRY + 100n) * 1000,
      ).toISOString(),
      humanInstructions: [
        "Refresh complete. Your agent's human proof has been renewed.",
      ],
    });

    // Completed sessions answer from the token without touching the chain.
    registry.proofExpiresAt.mockClear();
    const again = await jsonBody(
      await GET(status(done.sessionToken as string)),
    );
    expect(again.stage).toBe("completed");
    expect(registry.proofExpiresAt).not.toHaveBeenCalled();
  });

  it("reports failed when the agent is burned before the refresh lands", async () => {
    const token = await startSession();
    registry.hasHumanProof.mockResolvedValue(false);
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/refresh/status/route",
    );
    const body = await jsonBody(await GET(status(token)));
    expect(body).toMatchObject({
      stage: "failed",
      error: expect.stringMatching(/deregistered/),
      humanInstructions: ["Refresh failed. Start a new session and try again."],
    });
  });

  it("returns a generic 401 for garbage tokens and 429 when rate limited", async () => {
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/refresh/status/route",
    );
    const garbage = await GET(status("A".repeat(80)));
    expect(garbage.status).toBe(401);
    expect(await jsonBody(garbage)).toEqual({ error: "Invalid session token" });

    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 2000,
    });
    const limited = await GET(status("x"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("2");
  });

  it("returns a generic 502 when RPC fails", async () => {
    const token = await startSession();
    registry.proofExpiresAt.mockRejectedValue(new Error("rpc https://x"));
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/refresh/status/route",
    );
    const res = await GET(status(token));
    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toEqual({ error: "RPC error" });
  });
});
