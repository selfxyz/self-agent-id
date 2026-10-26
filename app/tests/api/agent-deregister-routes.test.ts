// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for POST /api/agent/deregister and GET /api/agent/deregister/status. */

import { ethers } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";
import { NETWORKS } from "@/lib/network";

const SECRET = "test-session-secret";
const AGENT = ethers.getAddress("0x551775463d338c0c406b3266c63af6eda8b3e47a");
const OWNER = ethers.getAddress("0x251f3785c30f6953ba78c3a34e2ca48fd1700e8e");
const ADDRESS_KEY = "0x" + "00".repeat(12) + AGENT.slice(2).toLowerCase();
const ED25519_KEY = "0x" + "9f".repeat(32);

const mockCheckRateLimit = vi.fn();
const mockRenderQrBase64 = vi.fn(async (_text: string) => "PNG64");
const registry = {
  isVerifiedAgent: vi.fn(),
  getAgentId: vi.fn(),
  agentIdToAgentKey: vi.fn(),
  ownerOf: vi.fn(),
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
type InitRoute = typeof import("@/app/api/agent/deregister/route");
type StatusRoute = typeof import("@/app/api/agent/deregister/status/route");

/**
 * Build a POST /api/agent/deregister request.
 *
 * @param body - JSON body (ignored when `init.raw` is set).
 * @param init.raw - Raw body string to send instead of JSON.
 * @returns The request.
 */
function post(body: unknown, init: { raw?: string } = {}) {
  return makeNextRequest("http://localhost:3100/api/agent/deregister", {
    method: "POST",
    body: init.raw ?? JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  builderArgs.length = 0;
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterMs: 0,
  });
  registry.isVerifiedAgent.mockResolvedValue(true);
  registry.getAgentId.mockResolvedValue(21n);
  registry.agentIdToAgentKey.mockResolvedValue(ADDRESS_KEY);
  registry.ownerOf.mockResolvedValue(AGENT);
  registry.hasHumanProof.mockResolvedValue(true);
});

describe("POST /api/agent/deregister", () => {
  it("returns 429 with Retry-After when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 4500,
    });
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const res = await POST(post({ network: "testnet", agentAddress: AGENT }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("5");
  });

  it("rejects bad bodies, networks, addresses, ids and disclosures with 400", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const cases: [unknown, string?][] = [
      [null, "[]"],
      [null, "not json"],
      [{ network: "bad", agentAddress: AGENT }],
      [{ network: ["testnet"], agentAddress: AGENT }],
      [{ network: "testnet" }],
      [{ network: "testnet", agentAddress: "0xnope" }],
      [{ network: "testnet", agentId: 1e80 }],
      [{ network: "testnet", agentId: "0x14" }],
      [{ network: "testnet", agentId: 0 }],
      [
        {
          network: "testnet",
          agentAddress: AGENT,
          disclosures: { minimumAge: 30 },
        },
      ],
      [
        {
          network: "testnet",
          agentAddress: AGENT,
          disclosures: { ofac: "no" },
        },
      ],
      [{ network: "testnet", agentAddress: AGENT, disclosures: "x" }],
      [{ network: "testnet", agentAddress: AGENT, disclosures: null }],
    ];
    for (const [body, raw] of cases) {
      const res = await POST(post(body, { raw }));
      expect(res.status, JSON.stringify(body ?? raw)).toBe(400);
    }
  });

  it("returns 413 for oversized bodies", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const res = await POST(
      post({
        network: "testnet",
        agentAddress: AGENT,
        pad: "x".repeat(20_000),
      }),
    );
    expect(res.status).toBe(413);
  });

  it("returns 404 Agent not found when the address has no agent", async () => {
    registry.isVerifiedAgent.mockResolvedValue(false);
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const res = await POST(post({ network: "testnet", agentAddress: AGENT }));
    expect(res.status).toBe(404);
    expect(await jsonBody(res)).toEqual({ error: "Agent not found" });
  });

  it("creates a D-action session when the agent owns its NFT", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const res = await POST(
      post({
        network: "testnet",
        agentAddress: AGENT.toLowerCase(),
        disclosures: { minimumAge: 18 },
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining([
        "sessionToken",
        "stage",
        "deepLink",
        "qrImageBase64",
        "scanUrl",
        "expiresAt",
        "timeRemainingMs",
        "humanInstructions",
        "agentAddress",
        "agentId",
        "network",
        "configIndex",
      ]),
    );
    expect(body).toMatchObject({
      stage: "qr-ready",
      qrImageBase64: "PNG64",
      agentAddress: AGENT,
      agentId: 21,
      network: "testnet",
      configIndex: 1,
    });
    expect(body.scanUrl).toMatch(/^http:\/\/localhost:3100\/api\/qr\/.+/);
    // The scan URL must not carry the session token.
    expect(body.scanUrl).not.toContain(body.sessionToken as string);
    expect(builderArgs[0]).toEqual({
      version: 2,
      appName: "Self Agent ID",
      scope: "self-agent-id",
      endpoint: NETWORKS["celo-sepolia"].registryAddress,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      endpointType: "staging_celo",
      userIdType: "hex",
      userId: AGENT.toLowerCase(),
      userDefinedData: "D1",
      disclosures: { minimumAge: 18 },
    });

    const { decryptSession, readQrToken } = await import("@/lib/session-token");
    const session = decryptSession(body.sessionToken as string, SECRET);
    expect(session).toMatchObject({
      type: "deregister",
      stage: "qr-ready",
      agentId: 21,
      agentAddress: AGENT,
    });
    expect(session.mode).toBeUndefined();
    expect(session.qrData).toBeUndefined();
    const qrToken = (body.scanUrl as string).split("/api/qr/")[1];
    expect(readQrToken(qrToken, SECRET).deepLink).toBe(body.deepLink);
  });

  it("creates an X-action session bound to the NFT owner when it differs", async () => {
    registry.ownerOf.mockResolvedValue(OWNER);
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const res = await POST(post({ network: "testnet", agentAddress: AGENT }));
    expect(res.status).toBe(200);
    expect(builderArgs[0]).toMatchObject({
      userId: OWNER.toLowerCase(),
      userDefinedData: "X0" + AGENT.slice(2).toLowerCase(),
    });
  });

  it("accepts agentId instead of agentAddress", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const res = await POST(post({ network: "testnet", agentId: "21" }));
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({ agentAddress: AGENT });
  });

  it("rejects an agentId / agentAddress mismatch and unknown ids", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const mismatch = await POST(
      post({ network: "testnet", agentId: 21, agentAddress: OWNER }),
    );
    expect(mismatch.status).toBe(400);

    registry.agentIdToAgentKey.mockResolvedValue("0x" + "00".repeat(32));
    const missing = await POST(post({ network: "testnet", agentId: 999 }));
    expect(missing.status).toBe(404);

    const huge = await POST(
      post({ network: "testnet", agentId: "9007199254740993" }),
    );
    expect(huge.status).toBe(404);
  });

  it("explains that Ed25519 agents can't be deregistered with a passport scan", async () => {
    registry.agentIdToAgentKey.mockResolvedValue(ED25519_KEY);
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const res = await POST(post({ network: "testnet", agentId: 30 }));
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toMatch(
      /Ed25519.*guardianRevoke/,
    );
  });

  it("returns 500 when the QR cannot be rendered", async () => {
    mockRenderQrBase64.mockRejectedValueOnce(new Error("data too big"));
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const res = await POST(post({ network: "testnet", agentAddress: AGENT }));
    expect(res.status).toBe(500);
    expect(await jsonBody(res)).toEqual({ error: "Failed to render QR code" });
  });

  it("returns a generic 502 when RPC fails", async () => {
    registry.isVerifiedAgent.mockRejectedValue(
      new Error("could not detect network https://secret-rpc"),
    );
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const res = await POST(post({ network: "testnet", agentAddress: AGENT }));
    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toEqual({ error: "RPC error" });
  });
});

describe("GET /api/agent/deregister/status", () => {
  /**
   * Start a deregister session for AGENT via the real init route.
   *
   * @returns The new session token.
   */
  async function startSession() {
    const { POST } = await load<InitRoute>("@/app/api/agent/deregister/route");
    const body = await jsonBody<{ sessionToken: string }>(
      await POST(post({ network: "testnet", agentAddress: AGENT })),
    );
    return body.sessionToken;
  }
  /**
   * Build a status request.
   *
   * @param token - Session token sent as a Bearer header; omitted if empty.
   * @returns The request.
   */
  function status(token?: string) {
    return makeNextRequest(
      "http://localhost:3100/api/agent/deregister/status",
      token ? { headers: { authorization: `Bearer ${token}` } } : {},
    );
  }

  it("stays qr-ready while the agent still has its proof", async () => {
    const token = await startSession();
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/deregister/status/route",
    );
    const res = await GET(status(token));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body).toMatchObject({ stage: "qr-ready", agentId: 21 });
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining([
        "sessionToken",
        "expiresAt",
        "timeRemainingMs",
        "humanInstructions",
      ]),
    );
    expect(registry.hasHumanProof).toHaveBeenCalledWith(21n);
  });

  it("completes once the agent is burned, with deregistration wording", async () => {
    const token = await startSession();
    registry.hasHumanProof.mockResolvedValue(false);
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/deregister/status/route",
    );
    const body = await jsonBody(await GET(status(token)));
    expect(body.stage).toBe("completed");
    expect(body.humanInstructions).toEqual([
      "Deregistration complete. Your agent has been removed.",
    ]);
  });

  it("ignores a stale 'failed' stage and re-reads the chain", async () => {
    const { encryptSession } = await import("@/lib/session-token");
    const token = encryptSession(
      {
        id: "s",
        type: "deregister",
        stage: "failed",
        network: "testnet",
        agentAddress: AGENT,
        agentId: 21,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      SECRET,
    );
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/deregister/status/route",
    );
    const body = await jsonBody(await GET(status(token)));
    expect(body.stage).toBe("qr-ready");
  });

  it("rejects missing, garbage, wrong-type and expired tokens without leaking details", async () => {
    const { encryptSession } = await import("@/lib/session-token");
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/deregister/status/route",
    );
    expect((await GET(status())).status).toBe(400);

    const garbage = await GET(status("garbage-token"));
    expect(garbage.status).toBe(401);
    expect(await jsonBody(garbage)).toEqual({ error: "Invalid session token" });

    const wrongType = encryptSession(
      { id: "s", type: "refresh", expiresAt: "2099-01-01T00:00:00Z" },
      SECRET,
    );
    expect((await GET(status(wrongType))).status).toBe(400);

    const expired = encryptSession(
      { id: "s", type: "deregister", expiresAt: "2000-01-01T00:00:00Z" },
      SECRET,
    );
    expect((await GET(status(expired))).status).toBe(410);
  });

  it("returns 429 with Retry-After when polling is rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/deregister/status/route",
    );
    const res = await GET(status("t"));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1");
  });

  it("returns a generic 502 when RPC fails", async () => {
    const token = await startSession();
    registry.hasHumanProof.mockRejectedValue(new Error("boom at rpc url"));
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/deregister/status/route",
    );
    const res = await GET(status(token));
    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toEqual({ error: "RPC error" });
  });

  it("returns 204 for OPTIONS", async () => {
    const { OPTIONS } = await load<StatusRoute>(
      "@/app/api/agent/deregister/status/route",
    );
    expect(OPTIONS().status).toBe(204);
  });
});
