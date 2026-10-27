// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests for the registration routes: POST /api/agent/register, its status/export/qr/ed25519-check routes, and GET /api/qr/[qrToken].
 *
 * Session tokens, Ed25519 crypto and QR rendering are real; only the rate
 * limiter and the registry contract (RPC) are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { jsonBody, makeNextRequest } from "./test-utils";
import {
  createQrToken,
  decryptSession,
  encryptSession,
  readQrToken,
  type SessionData,
} from "@/lib/session-token";
import { computeEd25519ChallengeHash } from "@/lib/ed25519";
import { NETWORKS } from "@/lib/network";
import { ERRORS } from "@/lib/agent-api-helpers";
import { REGISTRATION_MODES } from "@/lib/registration-modes";

const SECRET = "test-session-secret-32-chars!!!!";
const HUMAN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const AGENT = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SMALL_ORDER_PUBKEY = "01" + "00".repeat(31);
const TRIVIAL_SIGNATURE = "01" + "00".repeat(63);
const TESTNET = NETWORKS["celo-sepolia"];
const BASE = "https://api.test";

const mockCheckRateLimit = vi.fn();
const registry = {
  ed25519Nonce: vi.fn(),
  isVerifiedAgent: vi.fn(),
  getAgentId: vi.fn(),
  getAgentCredentials: vi.fn(),
};

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/contract-types", () => ({ typedRegistry: () => registry }));

/**
 * Hex-encode bytes without a 0x prefix.
 *
 * @param bytes - Raw bytes.
 * @returns Lowercase hex string.
 */
const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

/**
 * Generate a random Ed25519 keypair.
 *
 * @returns The secret key and the hex public key (no 0x).
 */
function ed25519Keypair() {
  const secretKey = ed25519.utils.randomSecretKey();
  return { secretKey, pubkey: hex(ed25519.getPublicKey(secretKey)) };
}

/**
 * Sign the testnet registration challenge (nonce 0) for a human address.
 *
 * @param secretKey - Ed25519 secret key.
 * @param humanAddress - Address the challenge binds the key to.
 * @returns The hex signature (no 0x).
 */
function signChallenge(secretKey: Uint8Array, humanAddress: string) {
  const challenge = computeEd25519ChallengeHash({
    humanAddress,
    chainId: BigInt(TESTNET.chainId),
    registryAddress: TESTNET.registryAddress,
    nonce: 0n,
  });
  return hex(ed25519.sign(Buffer.from(challenge.slice(2), "hex"), secretKey));
}

/**
 * ISO timestamp in the future.
 *
 * @param ms - Offset from now; defaults to 10 minutes.
 * @returns ISO 8601 string.
 */
function future(ms = 10 * 60_000) {
  return new Date(Date.now() + ms).toISOString();
}

/**
 * ISO timestamp in the past.
 *
 * @param ms - Offset before now; defaults to 1 ms.
 * @returns ISO 8601 string.
 */
function past(ms = 1) {
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Encrypt a registration session token (linked, qr-ready, testnet, unexpired by default).
 *
 * @param overrides - Session fields to replace.
 * @returns The encrypted session token.
 */
function sessionToken(overrides: Partial<SessionData> = {}) {
  return encryptSession(
    {
      id: "s1",
      type: "register",
      mode: "linked",
      stage: "qr-ready",
      network: "testnet",
      agentAddress: AGENT,
      agentPrivateKey: "0xprivkey",
      humanAddress: HUMAN,
      expiresAt: future(),
      ...overrides,
    },
    SECRET,
  );
}

/**
 * Build an Authorization header for a token.
 *
 * @param token - Session or QR token.
 * @returns Headers object with `authorization: Bearer <token>`.
 */
function bearer(token: string) {
  return { authorization: `Bearer ${token}` };
}

/**
 * Build a POST /api/agent/register request.
 *
 * @param body - Request body; strings are sent as-is, anything else is JSON-encoded.
 * @param headers - Extra request headers.
 * @returns The request.
 */
function postRegister(body: unknown, headers: Record<string, string> = {}) {
  return makeNextRequest(`${BASE}/api/agent/register`, {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agent-api.self.xyz");
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterMs: 1000,
  });
  registry.ed25519Nonce.mockResolvedValue(0n);
  registry.isVerifiedAgent.mockResolvedValue(false);
  registry.getAgentId.mockResolvedValue(0n);
  registry.getAgentCredentials.mockResolvedValue({
    nationality: "FR",
    issuingState: "FR",
    olderThan: 21n,
    ofac: [true, false, true],
    dateOfBirth: "",
    gender: "",
    expiryDate: "",
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ── POST /api/agent/register ─────────────────────────────────────────────────

describe("POST /api/agent/register", () => {
  /**
   * Import the register route.
   *
   * @returns The route module.
   */
  async function load() {
    return import("@/app/api/agent/register/route");
  }

  it("returns 429 with Retry-After when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 5000,
    });
    const { POST } = await load();
    const res = await POST(postRegister({ mode: "linked" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("5");
  });

  it("rejects non-object bodies and oversized bodies cleanly", async () => {
    const { POST } = await load();
    for (const body of ["[1,2]", "null", "42", "not json"]) {
      const res = await POST(postRegister(body));
      expect(res.status).toBe(400);
    }
    const big = await POST(
      postRegister({ mode: "wallet-free", pad: "x".repeat(20_000) }),
    );
    expect(big.status).toBe(413);
  });

  it("validates mode and network without echoing input", async () => {
    const { POST } = await load();
    for (const mode of [
      undefined,
      {},
      "self-custody",
      "verified-wallet",
      "constructor",
      "__proto__",
      "toString",
    ]) {
      const res = await POST(postRegister({ mode, network: "testnet" }));
      expect(res.status).toBe(400);
      expect((await jsonBody(res)).error).toBe(
        `Invalid mode. Valid modes: ${REGISTRATION_MODES.join(", ")}`,
      );
    }
    const res = await POST(postRegister({ mode: "wallet-free", network: 1 }));
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ error: ERRORS.invalidNetwork });
  });

  it("rejects a malformed humanAddress in wallet-free modes instead of dropping it", async () => {
    const { POST } = await load();
    for (const mode of ["wallet-free", "ed25519"]) {
      const res = await POST(
        postRegister({ mode, network: "testnet", humanAddress: "garbage" }),
      );
      expect(res.status).toBe(400);
      expect((await jsonBody(res)).error).toMatch(/humanAddress/);
    }
  });

  it.each([
    ["missing", undefined],
    ["zero address", "0x0000000000000000000000000000000000000000"],
    ["no 0x prefix", HUMAN.slice(2)],
    ["ICAP", "XE7338O073KYGTWWZN0F2WZ0R8PX5ZPPZS"],
    ["bad checksum", "0xF39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
    ["non-string", 123],
  ])("rejects humanAddress (%s) for linked mode", async (_label, value) => {
    const { POST } = await load();
    const res = await POST(
      postRegister({ mode: "linked", network: "testnet", humanAddress: value }),
    );
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).error).toMatch(/humanAddress/);
  });

  it("rejects non-boolean disclosures and bad minimumAge", async () => {
    const { POST } = await load();
    const ofac = await POST(
      postRegister({
        mode: "wallet-free",
        network: "testnet",
        disclosures: { ofac: "false" },
      }),
    );
    expect(ofac.status).toBe(400);
    const age = await POST(
      postRegister({
        mode: "wallet-free",
        network: "testnet",
        disclosures: { minimumAge: 30 },
      }),
    );
    expect(age.status).toBe(400);
  });

  it("creates a linked session whose scanUrl holds only a QR token", async () => {
    const { POST } = await load();
    const res = await POST(
      postRegister(
        {
          mode: "linked",
          network: "testnet",
          humanAddress: HUMAN.toLowerCase(),
          disclosures: { minimumAge: 18, ofac: true, nationality: true },
        },
        { "x-forwarded-host": "evil.example", "content-type": "text/plain" },
      ),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<Record<string, any>>(res);

    expect(body).toMatchObject({
      stage: "qr-ready",
      mode: "linked",
      network: "testnet",
      humanInstructions: expect.any(Array),
    });
    expect(
      Buffer.from(body.qrImageBase64, "base64").subarray(1, 4).toString(),
    ).toBe("PNG");
    expect(body.scanUrl).toMatch(/^https:\/\/agent-api\.self\.xyz\/api\/qr\//);

    // The Self app request: this registry, the human as userId, requested
    // disclosures only.
    expect(body.qrData).toMatchObject({
      appName: "Self Agent ID",
      scope: "self-agent-id",
      endpoint: TESTNET.registryAddress,
      endpointType: "staging_celo",
      userIdType: "hex",
      userId: HUMAN.slice(2).toLowerCase(),
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      disclosures: { minimumAge: 18, ofac: true, nationality: true },
    });
    expect(body.qrData.userDefinedData).toMatch(/^K4/);

    // Session token holds the generated key; the QR token holds only the deep link.
    const session = decryptSession(body.sessionToken, SECRET);
    expect(session.agentPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(session.humanAddress).toBe(HUMAN);
    const qrToken = body.scanUrl.split("/api/qr/")[1];
    expect(readQrToken(qrToken, SECRET)).toEqual({
      deepLink: body.deepLink,
      expiresAt: body.expiresAt,
    });
    expect(() => decryptSession(qrToken, SECRET)).toThrow();
  });

  it.each([
    ["walletfree", "wallet-free"],
    ["smart-wallet", "smartwallet"],
    ["privy", "privy"],
  ])("accepts mode %s as %s", async (input, canonical) => {
    const { POST } = await load();
    const res = await POST(
      postRegister({ mode: input, network: "testnet", humanAddress: HUMAN }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.mode).toBe(canonical);
    expect(decryptSession(body.sessionToken as string, SECRET).mode).toBe(
      canonical,
    );
  });

  it("registers ed25519 with a strictly verified signature", async () => {
    const { secretKey, pubkey } = ed25519Keypair();
    const { deriveEd25519Address } = await import("@/lib/ed25519");
    const agentAddress = deriveEd25519Address(pubkey);
    const { POST } = await load();
    const res = await POST(
      postRegister({
        mode: "ed25519",
        network: "testnet",
        ed25519Pubkey: pubkey,
        ed25519Signature: signChallenge(secretKey, agentAddress),
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.agentAddress).toBe(agentAddress);
    const session = decryptSession(body.sessionToken as string, SECRET);
    expect(session.agentPrivateKey).toBeUndefined();
    expect(session.ed25519Pubkey).toBe(pubkey);
  });

  it("registers ed25519-linked with the human as guardian", async () => {
    const { secretKey, pubkey } = ed25519Keypair();
    const { POST } = await load();
    const res = await POST(
      postRegister({
        mode: "ed25519-linked",
        network: "testnet",
        humanAddress: HUMAN,
        ed25519Pubkey: pubkey,
        ed25519Signature: signChallenge(secretKey, HUMAN),
      }),
    );
    expect(res.status).toBe(200);
    const body = await jsonBody<Record<string, any>>(res);
    expect(body.qrData.userDefinedData).toMatch(
      new RegExp(`${HUMAN.slice(2).toLowerCase()}$`),
    );
  });

  it("rejects a signature over the wrong challenge", async () => {
    const { secretKey, pubkey } = ed25519Keypair();
    const { POST } = await load();
    const res = await POST(
      postRegister({
        mode: "ed25519-linked",
        network: "testnet",
        humanAddress: HUMAN,
        ed25519Pubkey: pubkey,
        ed25519Signature: signChallenge(secretKey, AGENT),
      }),
    );
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).error).toBe(
      "Ed25519 signature verification failed",
    );
  });

  it("rejects small-order Ed25519 public keys with trivial signatures", async () => {
    const { POST } = await load();
    for (const mode of ["ed25519", "ed25519-linked"]) {
      const res = await POST(
        postRegister({
          mode,
          network: "testnet",
          humanAddress: HUMAN,
          ed25519Pubkey: SMALL_ORDER_PUBKEY,
          ed25519Signature: TRIVIAL_SIGNATURE,
        }),
      );
      expect(res.status).toBe(400);
      expect((await jsonBody(res)).error).toMatch(/ed25519Pubkey/);
    }
  });

  it("returns 502 when the nonce lookup fails", async () => {
    registry.ed25519Nonce.mockRejectedValue(new Error("rpc down https://x"));
    const { secretKey, pubkey } = ed25519Keypair();
    const { POST } = await load();
    const res = await POST(
      postRegister({
        mode: "ed25519-linked",
        network: "testnet",
        humanAddress: HUMAN,
        ed25519Pubkey: pubkey,
        ed25519Signature: signChallenge(secretKey, HUMAN),
      }),
    );
    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toEqual({ error: "RPC error" });
  });

  it("returns a generic 500 when SESSION_SECRET is missing", async () => {
    vi.stubEnv("SESSION_SECRET", "");
    const { POST } = await load();
    const res = await POST(
      postRegister({ mode: "wallet-free", network: "testnet" }),
    );
    expect(res.status).toBe(500);
    expect(await jsonBody(res)).toEqual({
      error: "Server configuration error",
    });
  });
});

// ── GET /api/agent/register/status ───────────────────────────────────────────

describe("GET /api/agent/register/status", () => {
  /**
   * Call the registration status route.
   *
   * @param headers - Request headers (usually a Bearer token).
   * @param query - Raw query string, including the leading `?`.
   * @returns The route response.
   */
  async function get(headers: Record<string, string> = {}, query = "") {
    const { GET } = await import("@/app/api/agent/register/status/route");
    return GET(
      makeNextRequest(`${BASE}/api/agent/register/status${query}`, {
        headers,
      }),
    );
  }

  it("requires a Bearer token and ignores ?token=", async () => {
    const res = await get({}, `?token=${sessionToken()}`);
    expect(res.status).toBe(400);
  });

  it("returns generic errors for garbage, QR and expired tokens", async () => {
    const garbage = await get(bearer("A".repeat(80)));
    expect(garbage.status).toBe(401);
    expect(await jsonBody(garbage)).toEqual({ error: "Invalid session token" });

    const qrToken = createQrToken("https://x", future(), SECRET);
    expect((await get(bearer(qrToken))).status).toBe(401);

    const expired = await get(
      bearer(sessionToken({ expiresAt: past(), agentPrivateKey: undefined })),
    );
    expect(expired.status).toBe(410);
    expect(await jsonBody(expired)).toEqual({ error: "Session expired" });
  });

  it("returns 500 (not 401) when SESSION_SECRET is missing", async () => {
    const token = sessionToken();
    vi.stubEnv("SESSION_SECRET", "");
    const res = await get(bearer(token));
    expect(res.status).toBe(500);
    expect(await jsonBody(res)).toEqual({
      error: "Server configuration error",
    });
  });

  it("rejects tokens from other flows", async () => {
    const res = await get(bearer(sessionToken({ type: "deregister" })));
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Token is not for a registration session",
    });
  });

  it("returns qr-ready while not yet on-chain (zero-padded address key)", async () => {
    const res = await get(bearer(sessionToken()));
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).stage).toBe("qr-ready");
    expect(registry.isVerifiedAgent).toHaveBeenCalledWith(
      "0x000000000000000000000000" + AGENT.slice(2).toLowerCase(),
    );
  });

  it.each(["ed25519", "ed25519-linked"])(
    "completes %s using the raw pubkey as agentKey",
    async (mode) => {
      const { pubkey } = ed25519Keypair();
      registry.isVerifiedAgent.mockResolvedValue(true);
      registry.getAgentId.mockResolvedValue(9n);
      const res = await get(
        bearer(
          sessionToken({
            mode,
            ed25519Pubkey: pubkey,
            agentPrivateKey: undefined,
          }),
        ),
      );
      const body = await jsonBody(res);
      expect(body.stage).toBe("completed");
      expect(body.agentId).toBe(9);
      expect(registry.isVerifiedAgent).toHaveBeenCalledWith("0x" + pubkey);
    },
  );

  it("extends expiry to a full export window on first completion", async () => {
    registry.isVerifiedAgent.mockResolvedValue(true);
    registry.getAgentId.mockResolvedValue(5n);
    const res = await get(bearer(sessionToken({ expiresAt: future(5_000) })));
    const body = await jsonBody<Record<string, any>>(res);
    expect(body.stage).toBe("completed");
    expect(body.timeRemainingMs).toBeGreaterThan(29 * 60_000);
    const rotated = decryptSession(body.sessionToken, SECRET);
    expect(rotated).toMatchObject({ stage: "completed", agentId: 5 });

    // Completed tokens keep answering from the token, without RPC.
    registry.isVerifiedAgent.mockClear();
    const again = await jsonBody(await get(bearer(body.sessionToken)));
    expect(again).toMatchObject({ stage: "completed", agentId: 5 });
    expect(again.expiresAt).toBe(body.expiresAt);
    expect(registry.isVerifiedAgent).not.toHaveBeenCalled();
  });

  it("returns 502 on RPC failure", async () => {
    registry.isVerifiedAgent.mockRejectedValue(new Error("boom"));
    const res = await get(bearer(sessionToken()));
    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toEqual({ error: "RPC error" });
  });

  it("cleans NUL-padded credentials and nulls undisclosed fields", async () => {
    registry.isVerifiedAgent.mockResolvedValue(true);
    registry.getAgentId.mockResolvedValue(5n);
    registry.getAgentCredentials.mockResolvedValue({
      nationality: "FRA",
      issuingState: "\u0000\u0000\u0000",
      name: [],
      idNumber: "",
      olderThan: 18n,
      ofac: [true, false, false],
      dateOfBirth: "\u0000".repeat(8),
      gender: "M\u0000",
      expiryDate: "",
    });
    const body = await jsonBody<Record<string, any>>(
      await get(bearer(sessionToken())),
    );
    expect(body.credentials).toEqual({
      nationality: "FRA",
      olderThan: 18,
      ofac: [true, false, false],
      issuingState: null,
      dateOfBirth: null,
      gender: "M",
      expiryDate: null,
    });
  });

  it("still completes, without credentials, when the credentials read fails", async () => {
    registry.isVerifiedAgent.mockResolvedValue(true);
    registry.getAgentId.mockResolvedValue(5n);
    registry.getAgentCredentials.mockRejectedValue(new Error("rpc down"));
    const res = await get(bearer(sessionToken()));
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body).toMatchObject({ stage: "completed", agentId: 5 });
    expect(body).not.toHaveProperty("credentials");
  });

  describe("key recovery after expiry", () => {
    it("completes a generated-key session whose scan landed after expiry, with a fresh export window", async () => {
      registry.isVerifiedAgent.mockResolvedValue(true);
      registry.getAgentId.mockResolvedValue(8n);
      const res = await get(
        bearer(sessionToken({ expiresAt: past(60 * 60_000) })),
      );
      expect(res.status).toBe(200);
      const body = await jsonBody<Record<string, any>>(res);
      expect(body).toMatchObject({ stage: "completed", agentId: 8 });
      expect(body.timeRemainingMs).toBeGreaterThan(29 * 60_000);

      // The rotated token unlocks the key export.
      const { POST } = await import("@/app/api/agent/register/export/route");
      const exported = await POST(
        makeNextRequest(`${BASE}/api/agent/register/export`, {
          method: "POST",
          headers: bearer(body.sessionToken),
        }),
      );
      expect(exported.status).toBe(200);
      expect((await jsonBody(exported)).privateKey).toBe("0xprivkey");
    });

    it("stays 410 while the agent is not on-chain", async () => {
      const res = await get(bearer(sessionToken({ expiresAt: past() })));
      expect(res.status).toBe(410);
      expect(registry.isVerifiedAgent).toHaveBeenCalled();
    });

    it("returns 410 past the 24h grace period, without RPC", async () => {
      registry.isVerifiedAgent.mockResolvedValue(true);
      const res = await get(
        bearer(sessionToken({ expiresAt: past(24 * 60 * 60_000 + 1000) })),
      );
      expect(res.status).toBe(410);
      expect(registry.isVerifiedAgent).not.toHaveBeenCalled();
    });

    it.each([
      ["ed25519 sessions (no server-held key)", { agentPrivateKey: undefined }],
      ["expired completed tokens", { stage: "completed", agentId: 3 }],
    ])("does not apply to %s", async (_label, overrides) => {
      registry.isVerifiedAgent.mockResolvedValue(true);
      const res = await get(
        bearer(sessionToken({ expiresAt: past(), ...overrides })),
      );
      expect(res.status).toBe(410);
      expect(registry.isVerifiedAgent).not.toHaveBeenCalled();
    });
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 2000,
    });
    const res = await get(bearer(sessionToken()));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
  });
});

// ── POST /api/agent/register/export ──────────────────────────────────────────

describe("POST /api/agent/register/export", () => {
  /**
   * Call the key export route.
   *
   * @param init - Request headers and raw body.
   * @returns The route response.
   */
  async function post(init: {
    headers?: Record<string, string>;
    body?: string;
  }) {
    const { POST } = await import("@/app/api/agent/register/export/route");
    return POST(
      makeNextRequest(`${BASE}/api/agent/register/export`, {
        method: "POST",
        ...init,
      }),
    );
  }

  it("requires a token, including when there is no body at all", async () => {
    for (const init of [{ body: "{}" }, {}, { body: "  " }]) {
      const res = await post(init);
      expect(res.status).toBe(400);
      expect((await jsonBody(res)).error).toMatch(/^Missing session token/);
    }
    expect((await post({ body: "not json" })).status).toBe(400);
  });

  it("rejects expired completed tokens (export is never in grace)", async () => {
    const res = await post({
      headers: bearer(
        sessionToken({ stage: "completed", agentId: 3, expiresAt: past() }),
      ),
    });
    expect(res.status).toBe(410);
  });

  it("rejects an invalid body token like an invalid Bearer token", async () => {
    const res = await post({ body: JSON.stringify({ token: "A".repeat(80) }) });
    expect(res.status).toBe(401);
    expect(await jsonBody(res)).toEqual({ error: "Invalid session token" });
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
    expect((await post({ headers: bearer(sessionToken()) })).status).toBe(429);
  });

  it("returns 409 before completion", async () => {
    const res = await post({ headers: bearer(sessionToken()) });
    expect(res.status).toBe(409);
  });

  it("sends Cache-Control: no-store on error responses too", async () => {
    const responses = [
      await post({ body: "{}" }),
      await post({ headers: bearer("A".repeat(80)) }),
      await post({ headers: bearer(sessionToken()) }),
      await post({
        headers: bearer(
          sessionToken({ stage: "completed", agentId: 3, expiresAt: past() }),
        ),
      }),
    ];
    expect(responses.map((r) => r.status)).toEqual([400, 401, 409, 410]);
    for (const res of responses) {
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
    const limited = await post({ headers: bearer(sessionToken()) });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store");
  });

  it("exports with a Bearer token or a body token", async () => {
    const token = sessionToken({ stage: "completed", agentId: 3 });
    for (const init of [
      { headers: bearer(token) },
      { body: JSON.stringify({ token }) },
    ]) {
      const res = await post(init);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(await jsonBody(res)).toEqual({
        privateKey: "0xprivkey",
        agentAddress: AGENT,
        agentId: 3,
        network: "testnet",
        mode: "linked",
      });
    }
  });

  it("explains that ed25519 modes have no server-held key", async () => {
    const res = await post({
      headers: bearer(
        sessionToken({
          mode: "ed25519",
          stage: "completed",
          agentPrivateKey: undefined,
        }),
      ),
    });
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).error).toMatch(/ed25519/);
  });

  it("rejects QR tokens and other flows", async () => {
    const qr = createQrToken("https://x", future(), SECRET);
    expect((await post({ headers: bearer(qr) })).status).toBe(401);
    expect(
      (await post({ headers: bearer(sessionToken({ type: "refresh" })) }))
        .status,
    ).toBe(400);
  });
});

// ── GET /api/agent/register/qr ───────────────────────────────────────────────

describe("GET /api/agent/register/qr", () => {
  /**
   * Call the registration QR route.
   *
   * @param headers - Request headers (usually a Bearer token).
   * @returns The route response.
   */
  async function get(headers: Record<string, string> = {}) {
    const { GET } = await import("@/app/api/agent/register/qr/route");
    return GET(makeNextRequest(`${BASE}/api/agent/register/qr`, { headers }));
  }

  it("requires a Bearer token and a qr-ready session", async () => {
    expect((await get()).status).toBe(400);
    const done = await get(bearer(sessionToken({ stage: "completed" })));
    expect(done.status).toBe(409);
  });

  it("accepts only registration tokens", async () => {
    const res = await get(bearer(sessionToken({ type: "deregister" })));
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Token is not for a registration session",
    });
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
    expect((await get(bearer(sessionToken()))).status).toBe(429);
  });

  it("returns deep link, qrData and a QR-token scanUrl", async () => {
    const { POST } = await import("@/app/api/agent/register/route");
    const reg = await jsonBody<Record<string, any>>(
      await POST(postRegister({ mode: "wallet-free", network: "testnet" })),
    );
    const res = await get(bearer(reg.sessionToken));
    const body = await jsonBody<Record<string, any>>(res);
    expect(Object.keys(body).sort()).toEqual(["deepLink", "qrData", "scanUrl"]);
    expect(body.deepLink).toBe(reg.deepLink);
    expect(body.qrData).toEqual(reg.qrData);
    const qrToken = body.scanUrl.split("/api/qr/")[1];
    expect(readQrToken(qrToken, SECRET).deepLink).toBe(reg.deepLink);
  });
});

// ── GET /api/qr/[qrToken] ────────────────────────────────────────────────────

describe("GET /api/qr/[qrToken]", () => {
  /**
   * Call the public QR image route.
   *
   * @param token - QR token path segment.
   * @returns The route response.
   */
  async function get(token: string) {
    const { GET } = await import("@/app/api/qr/[qrToken]/route");
    return GET(makeNextRequest(`${BASE}/api/qr/${token}`), {
      params: Promise.resolve({ qrToken: token }),
    });
  }

  it("renders a PNG for a QR token", async () => {
    const res = await get(
      createQrToken("https://redirect.self.xyz?x=1", future(), SECRET),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const png = Buffer.from(await res.arrayBuffer());
    expect(png.subarray(1, 4).toString()).toBe("PNG");
  });

  it("rejects session tokens with 401", async () => {
    const res = await get(sessionToken());
    expect(res.status).toBe(401);
  });

  it("returns 500 (not 401) when SESSION_SECRET is missing", async () => {
    const token = createQrToken("https://x", future(), SECRET);
    vi.stubEnv("SESSION_SECRET", "");
    const res = await get(token);
    expect(res.status).toBe(500);
    expect(await jsonBody(res)).toEqual({
      error: "Server configuration error",
    });
  });

  it("returns 410 for expired QR tokens", async () => {
    const res = await get(
      createQrToken(
        "https://x",
        new Date(Date.now() - 1).toISOString(),
        SECRET,
      ),
    );
    expect(res.status).toBe(410);
  });

  it("returns 429 when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
    expect((await get("x")).status).toBe(429);
  });
});

// ── GET /api/agent/register/ed25519-check ────────────────────────────────────

describe("GET /api/agent/register/ed25519-check", () => {
  /**
   * Call the ed25519-check route.
   *
   * @param pubkey - Hex Ed25519 public key.
   * @param network - Raw `&network=` suffix (empty to omit it).
   * @returns The route response.
   */
  async function get(pubkey: string, network = "&network=testnet") {
    const { GET } =
      await import("@/app/api/agent/register/ed25519-check/route");
    return GET(
      makeNextRequest(
        `${BASE}/api/agent/register/ed25519-check?pubkey=${pubkey}${network}`,
      ),
    );
  }

  it("requires a valid network", async () => {
    for (const network of ["", "&network=goerli"]) {
      const res = await get(ed25519Keypair().pubkey, network);
      expect(res.status).toBe(400);
      expect(await jsonBody(res)).toEqual({ error: ERRORS.invalidNetwork });
    }
  });

  it("returns a numeric agentId for registered keys", async () => {
    registry.isVerifiedAgent.mockResolvedValue(true);
    registry.getAgentId.mockResolvedValue(12n);
    const { pubkey } = ed25519Keypair();
    const body = await jsonBody(await get(pubkey));
    expect(body).toMatchObject({ registered: true, agentId: 12 });
  });

  it("rejects small-order pubkeys and hides RPC errors", async () => {
    expect((await get(SMALL_ORDER_PUBKEY)).status).toBe(400);
    registry.isVerifiedAgent.mockRejectedValue(new Error("secret rpc url"));
    const res = await get(ed25519Keypair().pubkey);
    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toEqual({ error: "RPC error" });
  });
});
