// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for the REST registration / refresh flow (token rotation, errors, expiry). */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import {
  requestRegistration,
  requestProofRefresh,
  getAgentInfo,
  ExpiredSessionError,
  RegistrationError,
  trimTrailingSlashes,
} from "../registration-flow";

const API = "https://api.test";

interface Call {
  url: string;
  init?: RequestInit;
}

const realFetch = globalThis.fetch;
let calls: Call[] = [];

/** Replace fetch with a queue of canned JSON responses. */
function mockFetch(responses: Array<{ status?: number; body: unknown }>): void {
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    assert.ok(next, `unexpected fetch to ${url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
    });
  }) as typeof fetch;
}

/** Read a request header from a recorded fetch call. */
function header(call: Call, name: string): string | undefined {
  return (call.init?.headers as Record<string, string> | undefined)?.[name];
}

const registerInit = {
  sessionToken: "tok-0",
  stage: "qr-ready",
  deepLink: "https://redirect.self.xyz/?x",
  scanUrl: `${API}/api/qr/qr-tok`,
  agentAddress: "0x0000000000000000000000000000000000000001",
  expiresAt: "2030-01-01T00:00:00.000Z",
  timeRemainingMs: 1000,
  humanInstructions: [],
  network: "testnet",
  mode: "wallet-free",
};

describe("registration flow (REST)", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("polls status with a Bearer header and exports with the rotated token", async () => {
    mockFetch([
      { body: registerInit },
      { body: { sessionToken: "tok-1", stage: "qr-ready" } },
      {
        body: {
          sessionToken: "tok-2",
          stage: "completed",
          agentId: 7,
          agentAddress: registerInit.agentAddress,
        },
      },
      { body: { privateKey: "0xabc" } },
    ]);

    const session = await requestRegistration({
      mode: "wallet-free",
      network: "testnet",
      apiBase: API,
    });
    assert.strictEqual(session.scanUrl, registerInit.scanUrl);

    const result = await session.waitForCompletion({ pollIntervalMs: 1 });
    assert.deepStrictEqual(result, {
      agentId: 7,
      agentAddress: registerInit.agentAddress,
      credentials: undefined,
    });

    const [, poll1, poll2] = calls;
    assert.strictEqual(poll1.url, `${API}/api/agent/register/status`);
    assert.strictEqual(header(poll1, "Authorization"), "Bearer tok-0");
    assert.strictEqual(header(poll2, "Authorization"), "Bearer tok-1");

    assert.strictEqual(await session.exportKey(), "0xabc");
    const exportCall = calls[3];
    assert.strictEqual(exportCall.url, `${API}/api/agent/register/export`);
    assert.strictEqual(header(exportCall, "Authorization"), "Bearer tok-2");
  });

  it("sends ed25519 fields and maps 410 to ExpiredSessionError", async () => {
    mockFetch([
      { body: registerInit },
      { status: 410, body: { error: "Session expired" } },
    ]);
    const session = await requestRegistration({
      mode: "ed25519",
      network: "testnet",
      ed25519Pubkey: "aa".repeat(32),
      ed25519Signature: "bb".repeat(64),
      apiBase: API,
    });
    const sent = JSON.parse(calls[0].init?.body as string) as Record<
      string,
      unknown
    >;
    assert.strictEqual(sent.ed25519Pubkey, "aa".repeat(32));
    assert.strictEqual(sent.ed25519Signature, "bb".repeat(64));

    await assert.rejects(
      session.waitForCompletion({ pollIntervalMs: 1 }),
      ExpiredSessionError,
    );
  });

  it("surfaces non-expiry status errors instead of polling until timeout", async () => {
    mockFetch([
      { body: registerInit },
      { status: 401, body: { error: "Invalid session token" } },
    ]);
    const session = await requestRegistration({
      mode: "wallet-free",
      network: "testnet",
      apiBase: API,
    });
    await assert.rejects(
      session.waitForCompletion({ pollIntervalMs: 1 }),
      (err: unknown) =>
        err instanceof RegistrationError &&
        err.status === 401 &&
        err.message === "Invalid session token",
    );
  });

  it("parses ISO proofExpiresAt from refresh status", async () => {
    mockFetch([
      { body: { ...registerInit, agentId: 3 } },
      {
        body: {
          sessionToken: "tok-1",
          stage: "completed",
          proofExpiresAt: "2027-05-01T12:00:00.000Z",
        },
      },
    ]);
    const refresh = await requestProofRefresh({ agentId: 3, apiBase: API });
    const { proofExpiresAt } = await refresh.waitForCompletion({
      pollIntervalMs: 1,
    });
    assert.strictEqual(
      proofExpiresAt?.toISOString(),
      "2027-05-01T12:00:00.000Z",
    );
    assert.strictEqual(header(calls[1], "Authorization"), "Bearer tok-0");
  });

  it("leaves proofExpiresAt unset instead of inventing one", async () => {
    mockFetch([
      { body: { ...registerInit, agentId: 3 } },
      { body: { sessionToken: "tok-1", stage: "completed" } },
    ]);
    const refresh = await requestProofRefresh({ agentId: 3, apiBase: API });
    const result = await refresh.waitForCompletion({ pollIntervalMs: 1 });
    assert.strictEqual(result.proofExpiresAt, undefined);
  });

  it("exposes 404 for nonexistent agents", async () => {
    mockFetch([{ status: 404, body: { error: "Agent not found" } }]);
    await assert.rejects(
      getAgentInfo(999, { network: "testnet", apiBase: API }),
      (err: unknown) => err instanceof RegistrationError && err.status === 404,
    );
  });
});

describe("trimTrailingSlashes", () => {
  it("strips trailing slashes only, in linear time", () => {
    assert.strictEqual(
      trimTrailingSlashes("https://a.example///"),
      "https://a.example",
    );
    assert.strictEqual(
      trimTrailingSlashes("https://a.example/x"),
      "https://a.example/x",
    );
    const input = "a" + "/".repeat(200_000) + "b"; // ReDoS shape for /\/+$/
    const start = Date.now();
    assert.strictEqual(trimTrailingSlashes(input), input);
    assert.ok(Date.now() - start < 50);
  });
});
