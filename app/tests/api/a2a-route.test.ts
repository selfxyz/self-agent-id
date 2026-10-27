// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests for POST /api/a2a (A2A JSON-RPC agent endpoint).
 *
 * Contracts and the lifecycle routes it calls in-process are faked; session
 * tokens are real.
 */

import { NextResponse, type NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionToken } from "@/lib/session-token";
import { jsonBody, makeNextRequest } from "./test-utils";

const SECRET = "a2a-test-session-secret";

/**
 * Mint a real, decryptable session token for a flow.
 *
 * @param type - Session flow the token belongs to.
 * @param mode - Registration mode stored in the session, if any.
 * @returns The encrypted session token string.
 */
function sessionToken(
  type: "register" | "deregister" | "refresh",
  mode?: string,
): string {
  return createSessionToken({ type, mode, network: "testnet" }, SECRET).token;
}

const registry: Record<string, ReturnType<typeof vi.fn>> = {};
const provider = { verificationStrength: vi.fn(), providerName: vi.fn() };
const routes = {
  registerPOST: vi.fn(),
  registerStatusGET: vi.fn(),
  deregisterPOST: vi.fn(),
  deregisterStatusGET: vi.fn(),
  refreshPOST: vi.fn(),
  refreshStatusGET: vi.fn(),
};

const KEY =
  "0x00000000000000000000000059489da9e1eb1f162b0d8eeeadc0314f49ad759a";
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Stub every registry read with a live, verified agent's on-chain state.
 *
 * @param overrides - Registry method name to resolved value, replacing defaults.
 */
function agentState(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    agentIdToAgentKey: KEY,
    hasHumanProof: true,
    isProofFresh: true,
    proofExpiresAt: 1803752935n,
    getProofProvider: "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
    agentRegisteredAt: 60316177n,
    getAgentCredentials: {
      issuingState: "\u0000\u0000\u0000",
      name: [],
      idNumber: "",
      nationality: "\u0000\u0000\u0000",
      dateOfBirth: "",
      gender: "",
      expiryDate: "",
      olderThan: 0n,
      ofac: [false, false, false],
    },
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    registry[name] = vi.fn().mockResolvedValue(value);
  }
}

/**
 * Re-import the A2A route with fresh module state and mocked dependencies.
 *
 * @param options.realRegister - Keep POST /api/agent/register real (contracts
 *   stay faked) instead of the `routes.registerPOST` mock.
 * @returns The A2A route module.
 */
async function loadRoute({ realRegister = false } = {}) {
  vi.resetModules();
  vi.doMock("@/lib/contract-types", () => ({
    typedRegistry: () => registry,
    typedProvider: () => provider,
  }));
  if (realRegister) vi.doUnmock("@/app/api/agent/register/route");
  else {
    vi.doMock("@/app/api/agent/register/route", () => ({
      POST: routes.registerPOST,
    }));
  }
  vi.doMock("@/app/api/agent/register/status/route", () => ({
    GET: routes.registerStatusGET,
  }));
  vi.doMock("@/app/api/agent/deregister/route", () => ({
    POST: routes.deregisterPOST,
  }));
  vi.doMock("@/app/api/agent/deregister/status/route", () => ({
    GET: routes.deregisterStatusGET,
  }));
  vi.doMock("@/app/api/agent/refresh/route", () => ({
    POST: routes.refreshPOST,
  }));
  vi.doMock("@/app/api/agent/refresh/status/route", () => ({
    GET: routes.refreshStatusGET,
  }));
  return import("@/app/api/a2a/route");
}

type RpcBody = {
  id: unknown;
  result?: {
    kind: string;
    id: string;
    contextId: string;
    status: {
      state: string;
      message: { kind: string; role: string; parts: Record<string, unknown>[] };
    };
    history: { parts: Record<string, unknown>[] }[];
  };
  error?: { code: number; message: string; data?: unknown };
};

let POST: (req: NextRequest) => Promise<Response>;

/**
 * POST a raw JSON-RPC body to the A2A route.
 *
 * @param body - Request body; strings are sent verbatim, anything else as JSON.
 * @param headers - Extra request headers.
 * @returns The route's response.
 */
function rpc(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    makeNextRequest("https://evil.example/api/a2a", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

/**
 * Send a `message/send` call carrying one text or data part.
 *
 * @param data - Text (becomes a text part) or an object (becomes a data part).
 * @param headers - Extra request headers.
 * @param partKey - Part discriminator key: "kind" (v0.3.0) or legacy "type".
 * @returns The response and its parsed JSON-RPC body.
 */
async function send(
  data: Record<string, unknown> | string,
  headers = {},
  partKey = "kind",
) {
  const part =
    typeof data === "string"
      ? { [partKey]: "text", text: data }
      : { [partKey]: "data", data };
  const res = await rpc(
    {
      jsonrpc: "2.0",
      id: 7,
      method: "message/send",
      params: {
        message: {
          kind: "message",
          messageId: "m1",
          role: "user",
          parts: [part],
        },
      },
    },
    headers,
  );
  return { res, body: await jsonBody<RpcBody>(res) };
}

/**
 * Join the text parts of a task's status message.
 *
 * @param body - JSON-RPC response body holding a task.
 * @returns The text parts joined by newlines.
 */
function textOf(body: RpcBody): string {
  return body
    .result!.status.message.parts.filter((p) => p.kind === "text")
    .map((p) => p.text)
    .join("\n");
}

/**
 * Extract the data part of a task's status message.
 *
 * @param body - JSON-RPC response body holding a task.
 * @returns The data part's payload, or undefined if there is none.
 */
function dataOf(body: RpcBody) {
  return body.result!.status.message.parts.find((p) => p.kind === "data")
    ?.data as Record<string, unknown>;
}

const sessionStart = {
  sessionToken: "tok-1",
  stage: "qr-ready",
  deepLink: "https://redirect.self.xyz?x",
  scanUrl: "https://agent-api.self.xyz/api/qr/abc",
  qrImageBase64: "iVBORw0KGgo=",
  expiresAt: "2030-01-01T00:00:00.000Z",
  timeRemainingMs: 1000,
  agentAddress: "0x59489DA9E1EB1f162b0d8eeeaDC0314f49Ad759A",
  network: "testnet",
  mode: "wallet-free",
};

beforeEach(async () => {
  vi.clearAllMocks();
  (
    globalThis as { __selfMemoryCounters?: Map<string, unknown> }
  ).__selfMemoryCounters?.clear();
  vi.stubEnv("SESSION_SECRET", SECRET);
  for (const key of Object.keys(registry)) delete registry[key];
  provider.verificationStrength.mockResolvedValue(100);
  provider.providerName.mockResolvedValue("self");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agent-api.self.xyz");
  vi.spyOn(console, "error").mockImplementation(() => {});
  ({ POST } = await loadRoute());
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("A2A wire format", () => {
  it("emits v0.3.0 tasks and messages with kind discriminators", async () => {
    agentState();
    const { body } = await send({
      intent: "lookup",
      agentId: 5,
      chainId: 42220,
    });
    const task = body.result!;
    expect(body.id).toBe(7);
    expect(task.kind).toBe("task");
    expect(task.id).toMatch(UUID);
    expect(task.contextId).toMatch(UUID);
    expect(task.status.state).toBe("completed");
    expect(task.status.message.kind).toBe("message");
    for (const part of task.status.message.parts) {
      expect(part.kind).toMatch(/^(text|data|file)$/);
      expect(part).not.toHaveProperty("type");
    }
  });

  it("accepts legacy `type` parts as well as `kind`", async () => {
    agentState();
    const { body } = await send("look up agent 5 on mainnet", {}, "type");
    expect(dataOf(body)).toMatchObject({ agentId: 5, chainId: 42220 });
    expect(body.result!.history[0].parts[0].kind).toBe("text");
  });
});

describe("lookup and verify intents", () => {
  it("reports registeredAtBlock (not a date) and cleans NUL credentials", async () => {
    agentState();
    const { body } = await send({
      intent: "lookup",
      agentId: 5,
      chainId: 42220,
    });
    const data = dataOf(body);
    expect(data).toMatchObject({
      registeredAtBlock: 60316177,
      isVerified: true,
      proofExpiresAt: "2027-02-27T18:28:55.000Z",
      credentials: { nationality: null },
    });
    expect(data).not.toHaveProperty("registeredAt");
    const text = body
      .result!.status.message.parts.map((p) => p.text)
      .join("\n");
    expect(text).toContain("Registered at block: 60316177");
    expect(text).toContain("Nationality: Not disclosed");
  });

  it("treats an expired proof as not verified", async () => {
    agentState({ isProofFresh: false });
    const { body } = await send({
      intent: "verify",
      agentId: 5,
      chainId: 42220,
    });
    expect(dataOf(body)).toMatchObject({
      isVerified: false,
      hasHumanProof: true,
    });
  });

  it("answers not found for burned agents", async () => {
    agentState({ agentIdToAgentKey: "0x" + "0".repeat(64) });
    const { body } = await send({
      intent: "verify",
      agentId: 4,
      chainId: 42220,
    });
    expect(body.result!.status.state).toBe("completed");
    expect(dataOf(body)).toMatchObject({
      agentId: 4,
      error: "Agent not found",
    });
  });

  it("fails the task without leaking RPC error details", async () => {
    agentState();
    registry.agentIdToAgentKey.mockRejectedValue(
      new Error("secret rpc https://key@rpc"),
    );
    const { body } = await send({ intent: "lookup", agentId: 5 });
    expect(body.result!.status.state).toBe("failed");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});

describe("input validation → INVALID_PARAMS", () => {
  it.each([
    ["string", { intent: "verify", agentId: "abc" }],
    ["negative", { intent: "verify", agentId: -1 }],
    ["float", { intent: "verify", agentId: 1.5 }],
    ["missing", { intent: "lookup" }],
    ["leading zero", { intent: "lookup", agentId: "01" }],
    ["unsafe", { intent: "lookup", agentId: 2 ** 53 }],
    ["chainId 0", { intent: "verify", agentId: 1, chainId: 0 }],
    ["unknown chain", { intent: "verify", agentId: 1, chainId: "constructor" }],
    ["bad network", { intent: "register", network: "devnet" }],
    ["status without id", { intent: "status" }],
  ])("%s", async (_name, data) => {
    const { res, body } = await send(data);
    expect(res.status).toBe(400);
    expect(body.error?.code).toBe(-32602);
    expect(registry.agentIdToAgentKey).toBeUndefined();
  });

  it("maps a 400 from the register route to INVALID_PARAMS", async () => {
    routes.registerPOST.mockResolvedValue(
      NextResponse.json({ error: "Invalid mode" }, { status: 400 }),
    );
    const { body } = await send({
      intent: "register",
      mode: "bogus",
      network: "testnet",
    });
    expect(body.error).toEqual({ code: -32602, message: "Invalid mode" });
  });
});

describe("default network", () => {
  it("registers on DEFAULT_NETWORK when no network is named, like agent queries", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEFAULT_NETWORK", "celo-sepolia");
    ({ POST } = await loadRoute());
    routes.registerPOST.mockResolvedValue(NextResponse.json(sessionStart));

    await send({ intent: "register", mode: "wallet-free" });
    await send("register a wallet-free agent");
    await send("register a wallet-free agent on mainnet");
    const networks = await Promise.all(
      routes.registerPOST.mock.calls.map(
        async (c) => (await (c[0] as NextRequest).json()).network,
      ),
    );
    expect(networks).toEqual(["testnet", "testnet", "mainnet"]);

    const help = await send({ intent: "help" });
    expect(textOf(help.body)).toContain("Agent queries default to testnet");
  });

  it("defaults registration to mainnet when DEFAULT_NETWORK is unset", async () => {
    routes.registerPOST.mockResolvedValue(NextResponse.json(sessionStart));
    await send({ intent: "register", mode: "wallet-free" });
    const req = routes.registerPOST.mock.calls[0][0] as NextRequest;
    expect((await req.json()).network).toBe("mainnet");
  });
});

describe("register → status flow", () => {
  it("calls the register handler in-process with the configured base URL and caller IP", async () => {
    const tok1 = sessionToken("register", "wallet-free");
    routes.registerPOST.mockResolvedValue(
      NextResponse.json({ ...sessionStart, sessionToken: tok1 }),
    );
    const { body } = await send(
      { intent: "register", network: "testnet" },
      {
        host: "evil.example",
        "x-forwarded-host": "evil.example",
        "x-real-ip": "1.2.3.4",
      },
    );
    const req = routes.registerPOST.mock.calls[0][0] as NextRequest;
    expect(req.url).toBe("https://agent-api.self.xyz/api/agent/register");
    expect(req.headers.get("x-real-ip")).toBe("1.2.3.4");
    const forwarded = await req.json();
    expect(forwarded).toEqual({ mode: "wallet-free", network: "testnet" });

    const task = body.result!;
    expect(task.status.state).toBe("input-required");
    const file = task.status.message.parts.find((p) => p.kind === "file");
    expect(file).toMatchObject({
      file: { mimeType: "image/png", bytes: "iVBORw0KGgo=" },
    });
    expect(dataOf(body)).toMatchObject({
      sessionToken: tok1,
      scanUrl: sessionStart.scanUrl,
      pollHint: { intent: "status", sessionToken: tok1 },
    });
    expect(JSON.stringify(body)).not.toContain("evil.example");
    expect(dataOf(body)).not.toHaveProperty("taskId");

    // Poll by sessionToken (works on any instance): the token goes out as a
    // Bearer header, rotates, and the completed task hands back the latest
    // token for key export.
    const tok2 = sessionToken("register", "wallet-free");
    const tok3 = sessionToken("register", "wallet-free");
    routes.registerStatusGET
      .mockResolvedValueOnce(
        NextResponse.json({ sessionToken: tok2, stage: "qr-ready" }),
      )
      .mockResolvedValueOnce(
        NextResponse.json({
          sessionToken: tok3,
          stage: "completed",
          agentId: 12,
        }),
      );
    const poll1 = await send({ intent: "status", sessionToken: tok1 });
    expect(poll1.body.result!.status.state).toBe("working");
    expect(dataOf(poll1.body)).toMatchObject({
      sessionToken: tok2,
      pollHint: { intent: "status", sessionToken: tok2 },
    });
    const poll2 = await send({ intent: "status", sessionToken: tok2 });
    expect(poll2.body.result!.status.state).toBe("completed");
    expect(dataOf(poll2.body)).toMatchObject({
      agentId: 12,
      sessionToken: tok3,
    });
    expect(textOf(poll2.body)).toContain("/api/agent/register/export");
    const bearers = routes.registerStatusGET.mock.calls.map((c) =>
      (c[0] as NextRequest).headers.get("authorization"),
    );
    expect(bearers).toEqual([`Bearer ${tok1}`, `Bearer ${tok2}`]);
  });

  it("still polls by taskId on the same instance, and points unknown taskIds at sessionToken", async () => {
    routes.registerPOST.mockResolvedValue(
      NextResponse.json({ ...sessionStart, sessionToken: "tok-1" }),
    );
    const { body } = await send({ intent: "register", network: "testnet" });
    routes.registerStatusGET.mockResolvedValue(
      NextResponse.json({ sessionToken: "tok-2", stage: "qr-ready" }),
    );
    const poll = await send({ intent: "status", taskId: body.result!.id });
    expect(poll.body.result!.status.state).toBe("working");

    const unknown = await send({ intent: "status", taskId: "elsewhere" });
    expect(unknown.res.status).toBe(400);
    expect(unknown.body.error?.code).toBe(-32602);
    expect(unknown.body.error?.message).toContain("sessionToken");
  });

  it("offers key export only for server-generated keys", async () => {
    routes.registerStatusGET.mockImplementation(async () =>
      NextResponse.json({
        sessionToken: "rotated",
        stage: "completed",
        agentId: 3,
      }),
    );
    const ed = await send({
      intent: "status",
      sessionToken: sessionToken("register", "ed25519"),
    });
    expect(ed.body.result!.status.state).toBe("completed");
    expect(textOf(ed.body)).not.toContain("export");
    const linked = await send({
      intent: "status",
      sessionToken: sessionToken("register", "smart-wallet"),
    });
    expect(textOf(linked.body)).toContain("/api/agent/register/export");
  });

  it("keeps concurrent requests apart (no shared request state)", async () => {
    routes.registerPOST.mockImplementation(async (req: NextRequest) => {
      await new Promise((r) =>
        setTimeout(r, req.headers.get("x-real-ip") === "1.1.1.1" ? 20 : 0),
      );
      return NextResponse.json({
        ...sessionStart,
        agentAddress: req.headers.get("x-real-ip"),
      });
    });
    const [a, b] = await Promise.all([
      send(
        { intent: "register", network: "testnet" },
        { "x-real-ip": "1.1.1.1" },
      ),
      send(
        { intent: "register", network: "testnet" },
        { "x-real-ip": "2.2.2.2" },
      ),
    ]);
    expect(dataOf(a.body).agentAddress).toBe("1.1.1.1");
    expect(dataOf(b.body).agentAddress).toBe("2.2.2.2");
  });

  it("asks for humanAddress when the mode (or its alias) needs one", async () => {
    for (const mode of ["linked", "smart-wallet", "smartwallet"]) {
      const { body } = await send({
        intent: "register",
        mode,
        network: "testnet",
      });
      expect(body.result!.status.state, mode).toBe("input-required");
    }
    expect(routes.registerPOST).not.toHaveBeenCalled();

    routes.registerPOST.mockResolvedValue(NextResponse.json(sessionStart));
    await send({ intent: "register", mode: "walletfree", network: "testnet" });
    expect(routes.registerPOST).toHaveBeenCalledTimes(1);
  });

  it("turns a rate-limited register call into a JSON-RPC error with retry info", async () => {
    routes.registerPOST.mockResolvedValue(
      NextResponse.json(
        { error: "Rate limit exceeded. Try again later.", retryAfterMs: 4000 },
        { status: 429 },
      ),
    );
    const { res, body } = await send({
      intent: "register",
      network: "testnet",
    });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("4");
    expect(body.result).toBeUndefined();
    expect(body.error).toEqual({
      code: -32000,
      message: "Rate limit exceeded. Try again later.",
      data: { retryAfterMs: 4000 },
    });
  });
});

describe("in-process register route (real handler, faked contracts)", () => {
  beforeEach(async () => {
    ({ POST } = await loadRoute({ realRegister: true }));
  });

  it("starts a real session the client can poll by sessionToken", async () => {
    const { body } = await send(
      { intent: "register", mode: "wallet-free", network: "testnet" },
      { "x-real-ip": "5.5.5.5" },
    );
    expect(body.result!.status.state).toBe("input-required");
    const data = dataOf(body);
    expect(data.scanUrl).toMatch(/^https:\/\/agent-api\.self\.xyz\/api\/qr\//);
    expect(data.mode).toBe("wallet-free");
    expect(
      body.result!.status.message.parts.some((p) => p.kind === "file"),
    ).toBe(true);

    routes.registerStatusGET.mockResolvedValue(
      NextResponse.json({ sessionToken: "next", stage: "qr-ready" }),
    );
    await send({ intent: "status", sessionToken: data.sessionToken });
    const req = routes.registerStatusGET.mock.calls[0][0] as NextRequest;
    expect(req.headers.get("authorization")).toBe(
      `Bearer ${String(data.sessionToken)}`,
    );
  });

  it("applies the register route's per-IP limit to the A2A caller", async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) {
      const { res } = await send(
        { intent: "register", network: "testnet" },
        { "x-real-ip": "6.6.6.6" },
      );
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
    // Another caller is unaffected.
    const other = await send(
      { intent: "register", network: "testnet" },
      { "x-real-ip": "6.6.6.7" },
    );
    expect(other.res.status).toBe(200);
  }, 30_000);
});

describe("lifecycle intents", () => {
  it("deregisters by agentId and polls the deregister status route by sessionToken", async () => {
    agentState();
    const tok = sessionToken("deregister");
    routes.deregisterPOST.mockResolvedValue(
      NextResponse.json({ ...sessionStart, sessionToken: tok }),
    );
    await send({ intent: "deregister", agentId: 10, network: "testnet" });
    const req = routes.deregisterPOST.mock.calls[0][0] as NextRequest;
    expect(await req.json()).toEqual({ agentId: 10, network: "testnet" });

    routes.deregisterStatusGET.mockResolvedValue(
      NextResponse.json({ error: "Session expired" }, { status: 410 }),
    );
    const poll = await send({ intent: "status", sessionToken: tok });
    expect(routes.deregisterStatusGET).toHaveBeenCalled();
    expect(routes.registerStatusGET).not.toHaveBeenCalled();
    expect(poll.body.result!.status.state).toBe("failed");
  });

  it("starts a refresh and reports a failed refresh", async () => {
    const tok = sessionToken("refresh");
    routes.refreshPOST.mockResolvedValue(
      NextResponse.json({ ...sessionStart, sessionToken: tok }),
    );
    await send({ intent: "refresh-proof", agentId: 10, chainId: 11142220 });
    const req = routes.refreshPOST.mock.calls[0][0] as NextRequest;
    expect(await req.json()).toEqual({ agentId: 10, network: "testnet" });
    routes.refreshStatusGET.mockResolvedValue(
      NextResponse.json({ sessionToken: "t", stage: "failed" }),
    );
    const poll = await send({ intent: "status", sessionToken: tok });
    expect(routes.refreshStatusGET).toHaveBeenCalled();
    expect(poll.body.result!.status.state).toBe("failed");
  });

  it("polls an expired deregister token on its own flow's status route", async () => {
    const expired = createSessionToken(
      { type: "deregister", network: "testnet", ttlMs: -60_000 },
      SECRET,
    ).token;
    routes.deregisterStatusGET.mockResolvedValue(
      NextResponse.json({ error: "Session expired" }, { status: 410 }),
    );
    const { res, body } = await send({
      intent: "status",
      sessionToken: expired,
    });
    expect(res.status).toBe(200);
    expect(routes.deregisterStatusGET).toHaveBeenCalled();
    expect(routes.registerStatusGET).not.toHaveBeenCalled();
    expect(body.result!.status.state).toBe("failed");
    expect(textOf(body)).toMatch(/session has expired/);
    expect(dataOf(body)).toEqual({ stage: "expired" });
  });

  it("reports a refresh of a missing agent as not found", async () => {
    routes.refreshPOST.mockResolvedValue(
      NextResponse.json({ error: "Agent not found" }, { status: 404 }),
    );
    const { body } = await send({
      intent: "refresh-proof",
      agentId: 99999,
      chainId: 11142220,
    });
    expect(body.result!.status.state).toBe("completed");
    expect(dataOf(body)).toMatchObject({ error: "Agent not found" });
  });

  it("answers not found for ids above 2^53 without an RPC call", async () => {
    agentState();
    for (const intent of ["lookup", "deregister", "refresh-proof"]) {
      const { body } = await send({
        intent,
        agentId: "9007199254740993",
        chainId: 42220,
      });
      expect(body.result!.status.state, intent).toBe("completed");
      expect(dataOf(body), intent).toMatchObject({
        agentId: "9007199254740993",
        error: "Agent not found",
      });
    }
    expect(registry.agentIdToAgentKey).not.toHaveBeenCalled();
    expect(routes.deregisterPOST).not.toHaveBeenCalled();
    expect(routes.refreshPOST).not.toHaveBeenCalled();
  });
});

describe("JSON-RPC envelope", () => {
  it("rejects non-JSON content types, bad JSON and unknown methods", async () => {
    const plain = await POST(
      makeNextRequest("https://x/api/a2a", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    );
    expect(plain.status).toBe(415);
    expect((await rpc("{nope")).status).toBe(400);
    expect((await jsonBody<RpcBody>(await rpc("{nope"))).error?.code).toBe(
      -32700,
    );
    const unknown = await rpc({ jsonrpc: "2.0", id: 1, method: "nope" });
    expect(unknown.status).toBe(404);
    const stream = await jsonBody<RpcBody>(
      await rpc({
        jsonrpc: "2.0",
        id: 1,
        method: "message/stream",
        params: {},
      }),
    );
    expect(stream.error?.code).toBe(-32004);
  });

  it("supports tasks/get (with historyLength) and tasks/cancel", async () => {
    const { body } = await send({ intent: "help" });
    const id = body.result!.id;
    const got = await jsonBody<RpcBody>(
      await rpc({
        jsonrpc: "2.0",
        id: 2,
        method: "tasks/get",
        params: { id, historyLength: 0 },
      }),
    );
    expect(got.result!.history).toEqual([]);
    const cancel = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tasks/cancel",
      params: { id },
    });
    expect(cancel.status).toBe(409);
    const missing = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tasks/get",
      params: { id: "nope" },
    });
    expect(missing.status).toBe(404);
  });

  it("throttles message/send per IP with a JSON-RPC rate-limit error", async () => {
    const ip = { "x-real-ip": "8.8.8.8" };
    for (let i = 0; i < 60; i++) {
      expect((await send({ intent: "help" }, ip)).res.status).toBe(200);
    }
    const { res, body } = await send({ intent: "help" }, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    expect(body.error).toMatchObject({
      code: -32000,
      data: { retryAfterMs: expect.any(Number) },
    });
    expect(
      (await send({ intent: "help" }, { "x-real-ip": "8.8.8.9" })).res.status,
    ).toBe(200);
  });

  it("rejects X-Agent-Id callers with a stale proof or malformed ID", async () => {
    agentState({ isProofFresh: false });
    const res = await rpc(
      { jsonrpc: "2.0", id: 1, method: "tasks/get", params: { id: "x" } },
      { "x-agent-id": "5" },
    );
    expect(res.status).toBe(403);
    const bad = await rpc(
      { jsonrpc: "2.0", id: 1, method: "tasks/get", params: { id: "x" } },
      { "x-agent-id": "0x5" },
    );
    expect(bad.status).toBe(403);
  });

  it("rejects an unregistered X-Agent-Id with an Agent not found error", async () => {
    agentState({
      hasHumanProof: false,
      agentIdToAgentKey: "0x" + "0".repeat(64),
    });
    const res = await rpc(
      { jsonrpc: "2.0", id: 1, method: "tasks/get", params: { id: "x" } },
      { "x-agent-id": "99999" },
    );
    expect(res.status).toBe(403);
    expect((await jsonBody<RpcBody>(res)).error!.message).toContain(
      "Agent not found",
    );
  });

  it("rate-limits X-Agent-Id checks before reading the chain", async () => {
    agentState();
    /**
     * Send one X-Agent-Id tasks/get from a fixed IP.
     *
     * @returns The route's response.
     */
    const call = () =>
      rpc(
        { jsonrpc: "2.0", id: 1, method: "tasks/get", params: { id: "x" } },
        { "x-agent-id": "5", "x-real-ip": "9.9.9.9" },
      );
    let last: Response | undefined;
    for (let i = 0; i < 121; i++) last = await call();
    expect(last!.status).toBe(429);
    expect(last!.headers.get("retry-after")).toBeTruthy();
    expect(registry.hasHumanProof).toHaveBeenCalledTimes(120);
  });
});
