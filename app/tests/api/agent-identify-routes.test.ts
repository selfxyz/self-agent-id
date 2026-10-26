// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for POST /api/agent/identify and GET /api/agent/identify/status. */

import { ethers } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";
import { NETWORKS } from "@/lib/network";

const SECRET = "test-session-secret";
const START_BLOCK = 5_000_000;

const mockCheckRateLimit = vi.fn();
const mockRenderQrBase64 = vi.fn(async (_text: string) => "PNG64");
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
 * Re-import a route module with fresh state and the rate limiter, QR renderer
 * and Self QR SDK mocked.
 *
 * @param path - Module path of the route to import.
 * @returns The imported route module.
 */
async function load<T>(path: string): Promise<T> {
  vi.resetModules();
  vi.doMock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
  vi.doMock("@/lib/render-qr", () => ({
    renderQrBase64: mockRenderQrBase64,
  }));
  vi.doMock("@selfxyz/sdk-common", () => ({
    SelfAppBuilder: MockSelfAppBuilder,
    getUniversalLink: () => "https://redirect.self.xyz/?selfApp=x",
  }));
  return import(path) as Promise<T>;
}
type InitRoute = typeof import("@/app/api/agent/identify/route");
type StatusRoute = typeof import("@/app/api/agent/identify/status/route");

/** Fake NullifierIdentified event + the calldata of the tx that emitted it. */
interface FakeEvent {
  txHash: string;
  nullifier: bigint;
  agentCount: bigint;
  data: string;
  /** Block the event landed in; events without one match every range. */
  block?: number;
}
let events: FakeEvent[] = [];
let latestBlock = START_BLOCK;
let getBlockNumber: ReturnType<typeof vi.fn<() => Promise<number>>>;
let queryFilter: ReturnType<
  typeof vi.fn<ethers.BaseContract["queryFilter"]>
>;

/**
 * Build fake proof-tx calldata whose userContextData is packed the way the
 * Self app does it: destChainId ‖ userId ‖ userDefinedData.
 *
 * @param userId - Hex userId to embed.
 * @returns The calldata hex string.
 */
function proofCalldata(userId: string) {
  return (
    "0x4d8d3d71" + // function selector
    "00".repeat(64) +
    ethers.zeroPadValue("0xa4ec", 32).slice(2) +
    ethers.zeroPadValue(userId, 32).slice(2) +
    "4930"
  );
}

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET;
  builderArgs.length = 0;
  events = [];
  latestBlock = START_BLOCK;
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterMs: 0,
  });
  getBlockNumber = vi.fn(async () => latestBlock);
  vi.spyOn(
    ethers.AbstractProvider.prototype,
    "getBlockNumber",
  ).mockImplementation(getBlockNumber);
  vi.spyOn(
    ethers.AbstractProvider.prototype,
    "getTransaction",
  ).mockImplementation(
    async (hash) =>
      ({ data: events.find((e) => e.txHash === hash)!.data }) as never,
  );
  queryFilter = vi.fn<ethers.BaseContract["queryFilter"]>(
    async (_filter, from, to) =>
      events
        .filter(
          (e) =>
            e.block === undefined ||
            (e.block >= Number(from) && e.block <= Number(to)),
        )
        .map((e) => ({
          transactionHash: e.txHash,
          args: [e.nullifier, e.agentCount],
        })) as never,
  );
  vi.spyOn(ethers.BaseContract.prototype, "queryFilter").mockImplementation(
    queryFilter,
  );
});

/**
 * Build a POST /api/agent/identify request.
 *
 * @param body - JSON body (ignored when `raw` is set).
 * @param raw - Raw body string to send instead of JSON.
 * @returns The request.
 */
function post(body: unknown, raw?: string) {
  return makeNextRequest("http://localhost:3100/api/agent/identify", {
    method: "POST",
    body: raw ?? JSON.stringify(body),
  });
}

/**
 * Build a status request.
 *
 * @param token - Session token sent as a Bearer header.
 * @returns The request.
 */
function status(token: string) {
  return makeNextRequest("http://localhost:3100/api/agent/identify/status", {
    headers: { authorization: `Bearer ${token}` },
  });
}

/**
 * Start a testnet identify session via the real init route.
 *
 * @returns The init response body and the userId the route generated.
 */
async function startSession() {
  const { POST } = await load<InitRoute>("@/app/api/agent/identify/route");
  const body = await jsonBody<Record<string, string>>(
    await POST(post({ network: "testnet" })),
  );
  return { body, userId: builderArgs[0].userId as string };
}

describe("POST /api/agent/identify", () => {
  it("starts a session with a random per-session userId and a safe scanUrl", async () => {
    const { body, userId } = await startSession();
    expect(body).toMatchObject({
      stage: "qr-ready",
      deepLink: "https://redirect.self.xyz/?selfApp=x",
      qrImageBase64: "PNG64",
      network: "testnet",
    });
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining([
        "sessionToken",
        "scanUrl",
        "expiresAt",
        "timeRemainingMs",
        "humanInstructions",
      ]),
    );
    expect(body.scanUrl).toMatch(/^http:\/\/localhost:3100\/api\/qr\/.+/);
    expect(body.scanUrl).not.toContain(body.sessionToken);

    expect(userId).toMatch(/^0x[0-9a-f]{40}$/);
    expect(userId).not.toBe(ethers.ZeroAddress);
    expect(builderArgs[0]).toEqual({
      version: 2,
      appName: "Self Agent ID",
      scope: "self-agent-id",
      endpoint: NETWORKS["celo-sepolia"].registryAddress,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      endpointType: "staging_celo",
      userIdType: "hex",
      userId,
      userDefinedData: "I0",
      disclosures: {},
    });

    const { decryptSession } = await import("@/lib/session-token");
    expect(decryptSession(body.sessionToken, SECRET)).toMatchObject({
      type: "identify",
      identifyUserId: userId,
      startBlock: START_BLOCK,
    });

    // A second session gets a different userId.
    await startSession();
    expect(builderArgs[1].userId).not.toBe(userId);
  });

  it("ignores X-Forwarded-Host when building scanUrl", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/identify/route");
    const res = await POST(
      makeNextRequest("http://localhost:3100/api/agent/identify", {
        method: "POST",
        body: JSON.stringify({ network: "testnet" }),
        headers: { "x-forwarded-host": "evil.example" },
      }),
    );
    expect((await jsonBody(res)).scanUrl).not.toContain("evil.example");
  });

  it("returns 400/413 for bad bodies and 429 when rate limited", async () => {
    const { POST } = await load<InitRoute>("@/app/api/agent/identify/route");
    for (const [body, raw] of [
      [null, "[]"],
      [null, "nope"],
      [{ network: "bad" }],
      [{}],
    ] as [unknown, string?][]) {
      const res = await POST(post(body, raw));
      expect(res.status).toBe(400);
      expect((await jsonBody<{ error: string }>(res)).error).not.toMatch(
        /undefined/,
      );
    }
    expect(
      (await POST(post({ network: "testnet", pad: "x".repeat(20_000) })))
        .status,
    ).toBe(413);

    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1500,
    });
    const limited = await POST(post({ network: "testnet" }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("2");
  });

  it("returns 500 when the QR cannot be rendered", async () => {
    mockRenderQrBase64.mockRejectedValueOnce(new Error("data too big"));
    const { POST } = await load<InitRoute>("@/app/api/agent/identify/route");
    const res = await POST(post({ network: "testnet" }));
    expect(res.status).toBe(500);
    expect(await jsonBody(res)).toEqual({ error: "Failed to render QR code" });
  });

  it("returns a generic 502 when RPC fails", async () => {
    getBlockNumber.mockRejectedValue(new Error("rpc https://secret down"));
    const { POST } = await load<InitRoute>("@/app/api/agent/identify/route");
    const res = await POST(post({ network: "testnet" }));
    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toEqual({ error: "RPC error" });
  });
});

describe("GET /api/agent/identify/status", () => {
  it("returns only the event whose tx carries this session's userId", async () => {
    const { body, userId } = await startSession();
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/identify/status/route",
    );

    // Another human's identify lands first: not ours.
    events.push({
      txHash: "0x01",
      nullifier: 111n,
      agentCount: 9n,
      data: proofCalldata(ethers.hexlify(ethers.randomBytes(20))),
    });
    latestBlock = START_BLOCK + 40;
    const pending = await jsonBody(await GET(status(body.sessionToken)));
    expect(pending.stage).toBe("qr-ready");
    expect(pending.nullifier).toBeUndefined();
    expect(queryFilter).toHaveBeenLastCalledWith(
      expect.anything(),
      START_BLOCK - 5,
      START_BLOCK + 40,
    );

    events.push({
      txHash: "0x02",
      nullifier: 222n,
      agentCount: 2n,
      data: proofCalldata(userId),
    });
    // ...and a newer, unrelated one after ours.
    events.push({
      txHash: "0x03",
      nullifier: 333n,
      agentCount: 1n,
      data: proofCalldata(ethers.hexlify(ethers.randomBytes(20))),
    });
    const done = await jsonBody(
      await GET(status(pending.sessionToken as string)),
    );
    expect(done).toMatchObject({
      stage: "completed",
      nullifier: "222",
      agentCount: 2,
      humanInstructions: ["Identification complete."],
    });
  });

  it("chunks log queries to Forno's 5000-block getLogs limit", async () => {
    const { body } = await startSession();
    latestBlock = START_BLOCK + 7_000;
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/identify/status/route",
    );
    await GET(status(body.sessionToken));
    expect(queryFilter.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [START_BLOCK - 5, START_BLOCK + 4_994],
      [START_BLOCK + 4_995, START_BLOCK + 7_000],
    ]);
  });

  it("scans only blocks added since the previous poll's token", async () => {
    const { body, userId } = await startSession();
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/identify/status/route",
    );
    const getTransaction = vi.mocked(
      ethers.AbstractProvider.prototype.getTransaction,
    );
    events.push({
      txHash: "0x01",
      nullifier: 111n,
      agentCount: 9n,
      data: proofCalldata(ethers.hexlify(ethers.randomBytes(20))),
      block: START_BLOCK + 10,
    });
    latestBlock = START_BLOCK + 40;
    const first = await jsonBody(await GET(status(body.sessionToken)));
    expect(first.stage).toBe("qr-ready");
    const { decryptSession } = await import("@/lib/session-token");
    expect(
      decryptSession(first.sessionToken as string, SECRET).scannedToBlock,
    ).toBe(START_BLOCK + 40);
    expect(getTransaction).toHaveBeenCalledTimes(1);

    // Next poll: only the new blocks plus a 5-block overlap, so the old
    // unrelated event is not fetched again.
    latestBlock = START_BLOCK + 60;
    queryFilter.mockClear();
    getTransaction.mockClear();
    const second = await jsonBody(
      await GET(status(first.sessionToken as string)),
    );
    expect(queryFilter.mock.calls.map((c) => [c[1], c[2]])).toEqual([
      [START_BLOCK + 36, START_BLOCK + 60],
    ]);
    expect(getTransaction).not.toHaveBeenCalled();

    // Our event lands in the overlap window and is still found.
    events.push({
      txHash: "0x02",
      nullifier: 222n,
      agentCount: 2n,
      data: proofCalldata(userId),
      block: START_BLOCK + 58,
    });
    latestBlock = START_BLOCK + 61;
    const done = await jsonBody(
      await GET(status(second.sessionToken as string)),
    );
    expect(done).toMatchObject({ stage: "completed", nullifier: "222" });
    expect(queryFilter).toHaveBeenLastCalledWith(
      expect.anything(),
      START_BLOCK + 56,
      START_BLOCK + 61,
    );
  });

  it("returns 401 for garbage tokens, 400 for sessions missing identify state, and 429 when rate limited", async () => {
    const { encryptSession } = await import("@/lib/session-token");
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/identify/status/route",
    );
    const garbage = await GET(status("A".repeat(80)));
    expect(garbage.status).toBe(401);
    expect(await jsonBody(garbage)).toEqual({ error: "Invalid session token" });

    const legacy = encryptSession(
      {
        id: "s",
        type: "identify",
        stage: "qr-ready",
        network: "testnet",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      SECRET,
    );
    expect((await GET(status(legacy))).status).toBe(400);

    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
    expect((await GET(status("x"))).status).toBe(429);
  });

  it("returns a generic 502 when RPC fails", async () => {
    const { body } = await startSession();
    queryFilter.mockRejectedValue(new Error("query returned more than 10000"));
    const { GET } = await load<StatusRoute>(
      "@/app/api/agent/identify/status/route",
    );
    const res = await GET(status(body.sessionToken));
    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toEqual({ error: "RPC error" });
  });
});
