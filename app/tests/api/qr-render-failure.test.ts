// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests that a QR render failure is 500 {error: "Failed to render QR code"} on
 * POST /api/agent/register, GET /api/qr/[qrToken] and GET /cli/register.
 *
 * Only the rate limiter is mocked; QRCode.toBuffer is made to throw.
 */

import QRCode from "qrcode";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";
import { createQrToken } from "@/lib/session-token";
import { NETWORKS } from "@/lib/network";

const SECRET = "test-session-secret-32-chars!!!!";
const HUMAN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TESTNET = NETWORKS["celo-sepolia"];

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: async () => ({
    allowed: true,
    remaining: 9,
    retryAfterMs: 0,
  }),
}));

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  vi.spyOn(QRCode, "toBuffer").mockRejectedValue(
    new Error("The amount of data is too big"),
  );
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

/**
 * Assert the shared QR render failure response.
 *
 * @param res - Route response.
 */
async function expectRenderFailure(res: Response) {
  expect(res.status).toBe(500);
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(await jsonBody(res)).toEqual({ error: "Failed to render QR code" });
}

describe("QR render failures", () => {
  it("POST /api/agent/register returns 500", async () => {
    const { POST } = await import("@/app/api/agent/register/route");
    const res = await POST(
      makeNextRequest("https://api.test/api/agent/register", {
        method: "POST",
        body: JSON.stringify({
          mode: "linked",
          network: "testnet",
          humanAddress: HUMAN,
        }),
      }),
    );
    await expectRenderFailure(res);
  });

  it("GET /api/qr/[qrToken] returns 500", async () => {
    const token = createQrToken(
      "https://redirect.self.xyz?x=1",
      new Date(Date.now() + 60_000).toISOString(),
      SECRET,
    );
    const { GET } = await import("@/app/api/qr/[qrToken]/route");
    const res = await GET(makeNextRequest(`https://api.test/api/qr/${token}`), {
      params: Promise.resolve({ qrToken: token }),
    });
    await expectRenderFailure(res);
  });

  it("GET /cli/register returns 500 (not 400) when only rendering fails", async () => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        operation: "register",
        mode: "linked",
        chainId: TESTNET.chainId,
        registryAddress: TESTNET.registryAddress,
        endpointType: "staging_celo",
        appName: "Self Agent ID",
        scope: "self-agent-id",
        humanIdentifier: HUMAN,
        userDefinedData: "K3" + "a".repeat(40) + "b".repeat(128) + "1b",
        expiresAt: Date.now() + 60_000,
      }),
    ).toString("base64url");
    const { GET } = await import("@/app/cli/register/route");
    const res = await GET(
      makeNextRequest(`https://api.test/cli/register?payload=${payload}`),
    );
    await expectRenderFailure(res);
  });
});
