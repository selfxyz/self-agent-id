// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests for GET /cli/register, the CLI browser handoff that renders a registration QR.
 *
 * SelfAppBuilder, QR rendering and the rate limiter are mocked.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNextRequest } from "./test-utils";
import { NETWORKS } from "@/lib/network";

const mockGetUniversalLink = vi.fn();
const mockRenderQrPng = vi.fn();
const mockCheckRateLimit = vi.fn();
const builderArgs: Record<string, unknown>[] = [];

/** Records the arguments each SelfAppBuilder is constructed with. */
class MockSelfAppBuilder {
  /**
   * Record the builder arguments.
   *
   * @param args - Self app options the route passes in.
   */
  constructor(private readonly args: Record<string, unknown>) {
    builderArgs.push(args);
  }

  /**
   * Build a fake Self app.
   *
   * @returns The recorded arguments tagged with `kind: "self-app"`.
   */
  build() {
    return { kind: "self-app", ...this.args };
  }
}

vi.mock("@selfxyz/qrcode", () => ({
  SelfAppBuilder: MockSelfAppBuilder,
  getUniversalLink: mockGetUniversalLink,
}));
vi.mock("@/lib/render-qr", () => ({ renderQrPng: mockRenderQrPng }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));

const TESTNET = NETWORKS["celo-sepolia"];
const MAINNET = NETWORKS["celo-mainnet"];

/**
 * Call the /cli/register route.
 *
 * @param url - Full request URL, including any payload query.
 * @returns The route response.
 */
async function get(url: string) {
  const { GET } = await import("@/app/cli/register/route");
  return GET(makeNextRequest(url));
}

/**
 * Build a /cli/register URL carrying a base64url-encoded JSON payload.
 *
 * @param payload - Value to JSON-encode into `?payload=`.
 * @returns The request URL.
 */
function payloadUrl(payload: unknown) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `https://example.com/cli/register?payload=${encoded}`;
}

/**
 * Build a valid handoff payload, in the shape the current TypeScript SDK CLI
 * sends (`register open`).
 *
 * @param overrides - Fields to replace or add (set to undefined to drop one).
 * @returns The payload object.
 */
function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    operation: "register",
    mode: "linked",
    chainId: TESTNET.chainId,
    registryAddress: TESTNET.registryAddress,
    endpointType: "staging_celo",
    appName: "Self Agent ID",
    scope: "self-agent-id",
    humanIdentifier: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    userDefinedData: "K3" + "a".repeat(40) + "b".repeat(128) + "1b",
    disclosures: {
      minimumAge: 18,
      ofac: true,
      nationality: false,
      name: false,
      date_of_birth: false,
      gender: false,
      issuing_state: false,
    },
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

/**
 * Assert the route rejects a URL with a JSON error and renders no QR.
 *
 * @param url - Request URL.
 * @param status - Expected HTTP status.
 * @param error - Optional pattern the `error` message must match.
 */
async function expectError(url: string, status: number, error?: RegExp) {
  const res = await get(url);
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type")).toMatch(/json/);
  if (error) expect((await res.json()).error).toMatch(error);
  expect(mockRenderQrPng).not.toHaveBeenCalled();
}

describe("CLI browser handoff route (GET /cli/register)", () => {
  beforeEach(() => {
    builderArgs.length = 0;
    mockGetUniversalLink.mockReturnValue("self://deep-link");
    mockRenderQrPng.mockResolvedValue(Buffer.from("png-bytes"));
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfterMs: 1000,
    });
  });

  it("returns a PNG QR for a valid CLI handoff payload", async () => {
    const res = await get(payloadUrl(validPayload()));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(Buffer.from(await res.arrayBuffer()).toString("utf8")).toBe(
      "png-bytes",
    );
    expect(mockRenderQrPng).toHaveBeenCalledWith("self://deep-link");
    expect(builderArgs[0]).toEqual({
      version: 2,
      appName: "Self Agent ID",
      scope: "self-agent-id",
      endpoint: TESTNET.registryAddress,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      userId: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      endpointType: "staging_celo",
      userIdType: "hex",
      userDefinedData: validPayload().userDefinedData,
      disclosures: { minimumAge: 18, ofac: true },
    });
  });

  it.each([
    ["self-custody register", { mode: "self-custody", userDefinedData: "R0" }],
    ["deregister", { operation: "deregister", userDefinedData: "D0" }],
    [
      "smartwallet deregister",
      { operation: "deregister", mode: "smartwallet", userDefinedData: "D0" },
    ],
    [
      "mainnet",
      {
        chainId: MAINNET.chainId,
        endpointType: "celo",
        registryAddress: MAINNET.registryAddress.toLowerCase(),
      },
    ],
    [
      "unknown camelCase disclosure keys (ignored)",
      { disclosures: { minimumAge: 0, ofac: false, dateOfBirth: true } },
    ],
  ])("accepts %s", async (_label, overrides) => {
    const res = await get(payloadUrl(validPayload(overrides)));
    expect(res.status).toBe(200);
  });

  it("ignores the legacy fields 0.2.x CLIs still send (callbackUrl, stateToken, sessionId)", async () => {
    const res = await get(
      payloadUrl(
        validPayload({
          sessionId: "abc",
          stateToken: "def",
          callbackUrl: "http://127.0.0.1:37811/callback",
          expectedAgentAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          smartWalletTemplate: null,
        }),
      ),
    );
    expect(res.status).toBe(200);
    // The QR request is built from the current fields only.
    expect(JSON.stringify(builderArgs[0])).not.toMatch(
      /callback|stateToken|sessionId|abc|def/,
    );
  });

  it("returns 400 when the payload query parameter is missing", async () => {
    await expectError(
      "https://example.com/cli/register",
      400,
      /Missing payload/,
    );
  });

  it("returns 400 when the payload is not valid base64url JSON", async () => {
    await expectError(
      "https://example.com/cli/register?payload=not-json",
      400,
      /Invalid payload encoding/,
    );
  });

  it.each([null, [], 7, "str"])(
    "returns 400 for non-object payload %j",
    async (p) => {
      await expectError(payloadUrl(p), 400, /JSON object/);
    },
  );

  it("returns 410 for expired sessions", async () => {
    await expectError(
      payloadUrl(validPayload({ expiresAt: Date.now() - 1 })),
      410,
      /Session expired/,
    );
  });

  it.each([
    [
      "foreign registry",
      { registryAddress: "0x000000000000000000000000000000000000dEaD" },
      /registryAddress/,
    ],
    [
      "mainnet registry on testnet",
      { registryAddress: MAINNET.registryAddress },
      /registryAddress/,
    ],
    ["unknown endpointType", { endpointType: "https" }, /endpointType/],
    ["mismatched chainId", { chainId: 1 }, /chainId/],
    ["foreign appName", { appName: "Binance KYC" }, /appName and scope/],
    ["foreign scope", { scope: "other-app" }, /appName and scope/],
    ["unknown operation", { operation: "disclose" }, /operation/],
    ["unknown mode", { mode: "privy" }, /mode must be/],
    ["ed25519 mode", { mode: "ed25519" }, /ed25519 modes/],
    [
      "bad humanIdentifier",
      { humanIdentifier: "f39Fd6e51aad88F6F4ce6aB8827279cffFb92266" },
      /humanIdentifier/,
    ],
    [
      "zero humanIdentifier",
      { humanIdentifier: "0x" + "0".repeat(40) },
      /humanIdentifier/,
    ],
    [
      "oversized userDefinedData",
      { userDefinedData: "A".repeat(4000) },
      /userDefinedData/,
    ],
    [
      "non-alphanumeric userDefinedData",
      { userDefinedData: "K3<script>" },
      /userDefinedData/,
    ],
    ["string boolean disclosure", { disclosures: { ofac: "false" } }, /ofac/],
    ["missing expiresAt", { expiresAt: undefined }, /expiresAt/],
    ["bad version", { version: 2 }, /version/],
  ])("rejects %s", async (_label, overrides, error) => {
    await expectError(payloadUrl(validPayload(overrides)), 400, error);
  });

  it("rejects smartwallet registration and points at POST /api/agent/register", async () => {
    await expectError(
      payloadUrl(validPayload({ mode: "smartwallet" })),
      400,
      /smartwallet registration is not supported by the CLI handoff; use POST \/api\/agent\/register/,
    );
  });

  it("returns 400 when userDefinedData is missing", async () => {
    await expectError(
      payloadUrl(validPayload({ userDefinedData: undefined })),
      400,
      /Missing userDefinedData/,
    );
  });

  it("returns JSON 400 when the Self request cannot be built", async () => {
    mockGetUniversalLink.mockImplementationOnce(() => {
      throw new Error("bad request");
    });
    const res = await get(payloadUrl(validPayload()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Failed to build verification request",
    });
    expect(mockRenderQrPng).not.toHaveBeenCalled();
  });

  it("returns JSON 500 when QR rendering fails", async () => {
    mockRenderQrPng.mockRejectedValue(new Error("data too big"));
    const res = await get(payloadUrl(validPayload()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to render QR code" });
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 4000,
    });
    const res = await get(payloadUrl(validPayload()));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("4");
  });

  it("answers OPTIONS with a 204 CORS preflight", async () => {
    const { OPTIONS } = await import("@/app/cli/register/route");
    expect(OPTIONS().status).toBe(204);
  });
});
