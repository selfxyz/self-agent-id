// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for POST /api/agent/register/ed25519-challenge and the lib/ed25519 signature checks. */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ed25519 } from "@noble/curves/ed25519.js";
import { jsonBody, makeNextRequest } from "./test-utils";
import {
  computeEd25519ChallengeHash,
  deriveEd25519Address,
  isValidEd25519PubkeyHex,
  verifyEd25519Signature,
} from "@/lib/ed25519";
import { NETWORKS } from "@/lib/network";
import { ERRORS } from "@/lib/agent-api-helpers";

const mockCheckRateLimit = vi.fn();
const mockEd25519Nonce = vi.fn();

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
vi.mock("@/lib/contract-types", () => ({
  typedRegistry: () => ({ ed25519Nonce: mockEd25519Nonce }),
}));

const VALID_PUBKEY =
  "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";
const HUMAN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TESTNET = NETWORKS["celo-sepolia"];

/**
 * Compute the expected testnet challenge hash for a human address (nonce 1).
 *
 * @param humanAddress - Address the challenge binds the Ed25519 key to.
 * @returns The 0x-prefixed challenge hash.
 */
function challengeFor(humanAddress: string) {
  return computeEd25519ChallengeHash({
    humanAddress,
    chainId: BigInt(TESTNET.chainId),
    registryAddress: TESTNET.registryAddress,
    nonce: 1n,
  });
}

/**
 * Call the ed25519-challenge route with a JSON (or raw string) body.
 *
 * @param body - Request body; strings are sent as-is, anything else is JSON-encoded.
 * @returns The route response.
 */
async function post(body: unknown) {
  const { POST } =
    await import("@/app/api/agent/register/ed25519-challenge/route");
  return POST(
    makeNextRequest(
      "https://example.com/api/agent/register/ed25519-challenge",
      {
        method: "POST",
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
    ),
  );
}

describe("POST /api/agent/register/ed25519-challenge", () => {
  beforeEach(() => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 9,
      retryAfterMs: 1000,
    });
    mockEd25519Nonce.mockResolvedValue(1n);
  });

  it("derives humanAddress from pubkey when humanAddress is omitted", async () => {
    const res = await post({ pubkey: VALID_PUBKEY, network: "testnet" });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      challengeHash: challengeFor(deriveEd25519Address(VALID_PUBKEY)),
      nonce: "1",
    });
  });

  it("uses a provided humanAddress, normalised to checksum", async () => {
    const res = await post({
      pubkey: VALID_PUBKEY,
      network: "testnet",
      humanAddress: HUMAN.toLowerCase(),
    });
    expect(res.status).toBe(200);
    expect((await jsonBody(res)).challengeHash).toBe(challengeFor(HUMAN));
  });

  it.each([
    "0x0000000000000000000000000000000000000000",
    HUMAN.slice(2),
    "XE7338O073KYGTWWZN0F2WZ0R8PX5ZPPZS",
    42,
  ])("rejects invalid humanAddress %s", async (humanAddress) => {
    const res = await post({
      pubkey: VALID_PUBKEY,
      network: "testnet",
      humanAddress,
    });
    expect(res.status).toBe(400);
  });

  it("rejects small-order public keys", async () => {
    const res = await post({
      pubkey: "01" + "00".repeat(31),
      network: "testnet",
    });
    expect(res.status).toBe(400);
  });

  it("rejects an unknown network with the shared message", async () => {
    const res = await post({ pubkey: VALID_PUBKEY, network: "goerli" });
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ error: ERRORS.invalidNetwork });
  });

  it("rejects non-object bodies", async () => {
    expect((await post("[]")).status).toBe(400);
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 3000,
    });
    const res = await post({ pubkey: VALID_PUBKEY, network: "testnet" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("3");
  });

  it("returns a generic 502 on RPC failure", async () => {
    mockEd25519Nonce.mockRejectedValue(new Error("https://secret-rpc down"));
    const res = await post({ pubkey: VALID_PUBKEY, network: "testnet" });
    expect(res.status).toBe(502);
    expect(await jsonBody(res)).toEqual({ error: "RPC error" });
  });
});

describe("Ed25519 signature checks (lib/ed25519)", () => {
  const SMALL_ORDER = [
    "01" + "00".repeat(31), // identity
    "00".repeat(32), // order 4
    "ec" + "ff".repeat(30) + "7f", // order 2 (y = -1)
  ];
  const message = challengeFor(HUMAN);
  const secretKey = ed25519.utils.randomSecretKey();
  const pubkey = Buffer.from(ed25519.getPublicKey(secretKey)).toString("hex");
  const signature = Buffer.from(
    ed25519.sign(Buffer.from(message.slice(2), "hex"), secretKey),
  ).toString("hex");

  it("accepts a valid signature, in either hex case", () => {
    expect(verifyEd25519Signature(signature, message, pubkey)).toBe(true);
    expect(
      verifyEd25519Signature(
        signature.toUpperCase(),
        message,
        pubkey.toUpperCase(),
      ),
    ).toBe(true);
  });

  it("rejects wrong messages, keys and malformed input without throwing", () => {
    const otherHuman = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
    const other = Buffer.from(
      ed25519.getPublicKey(ed25519.utils.randomSecretKey()),
    ).toString("hex");
    expect(
      verifyEd25519Signature(signature, challengeFor(otherHuman), pubkey),
    ).toBe(false);
    expect(verifyEd25519Signature(signature, message, other)).toBe(false);
    expect(verifyEd25519Signature(signature.slice(2), message, pubkey)).toBe(
      false,
    );
    expect(verifyEd25519Signature("zz".repeat(64), message, pubkey)).toBe(
      false,
    );
    expect(verifyEd25519Signature(signature, message, "zz".repeat(32))).toBe(
      false,
    );
  });

  it("rejects small-order public keys, whose trivial signatures verify for any message", () => {
    const trivialSignature = "01" + "00".repeat(63);
    for (const key of SMALL_ORDER) {
      expect(isValidEd25519PubkeyHex(key)).toBe(false);
      expect(verifyEd25519Signature(trivialSignature, message, key)).toBe(
        false,
      );
    }
    expect(isValidEd25519PubkeyHex(pubkey)).toBe(true);
  });
});
