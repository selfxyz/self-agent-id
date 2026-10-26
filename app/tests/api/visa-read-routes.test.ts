// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests for the visa read routes: GET /api/visa/[chainId]/[agentId], /api/visa/[chainId]/batch and /api/visa/agents.
 *
 * Contract bindings, the agent-id scan, tx counts and fetch are mocked.
 */

import { ethers } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";

const WALLET = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const WALLET_ID = BigInt(WALLET).toString();
const VISA_WALLET = "0x82D8DaC3a386dec55a0a44DffBd3113e8A7D139B";

const registry = {
  ownerOf: vi.fn(),
  getAgentId: vi.fn(),
  balanceOf: vi.fn(),
};
const visa = {
  getTier: vi.fn(),
  getMetrics: vi.fn(),
  getTierThresholds: vi.fn(),
  reviewRequestedTier: vi.fn(),
  manualReviewApproved: vi.fn(),
  getVisaWallet: vi.fn(),
  checkTierEligibility: vi.fn(),
  updateMetrics: vi.fn(),
};
const txCount = vi.fn();
const fetchMock = vi.fn();
const mockScan = vi.fn();
let ipCounter = 0;

/**
 * Build the CALL_EXCEPTION ethers throws for an unknown token.
 *
 * @returns The error to reject a contract call with.
 */
function notFound() {
  return ethers.makeError("execution reverted", "CALL_EXCEPTION");
}

beforeEach(() => {
  vi.resetModules();
  vi.doMock("@/lib/contract-types", () => ({
    typedRegistry: () => registry,
    typedVisa: () => visa,
  }));
  vi.doMock("@/lib/agent-read", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/agent-read")>()),
    scanAgentIds: mockScan,
  }));
  vi.spyOn(
    ethers.JsonRpcProvider.prototype,
    "getTransactionCount",
  ).mockImplementation(() => txCount());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/contract-types");
  vi.doUnmock("@/lib/agent-read");
});

/**
 * Build a GET request from a fresh client IP, so per-IP rate limits never trip.
 *
 * @param url - Request URL.
 * @returns The request.
 */
function req(url: string) {
  return makeNextRequest(url, {
    headers: { "x-real-ip": `10.1.0.${++ipCounter}` },
  });
}

describe("visa read route (GET /api/visa/[chainId]/[agentId])", () => {
  beforeEach(() => {
    visa.getTier.mockResolvedValue(1n);
    visa.getMetrics.mockResolvedValue({
      transactionCount: 12n,
      volumeUsd: 2_500_000n,
      lastUpdated: 123n,
    });
    visa.getTierThresholds
      .mockResolvedValueOnce({
        minTransactions: 1n,
        minVolumeUsd: 0n,
        requiresBoth: false,
        requiresManualReview: false,
      })
      .mockResolvedValueOnce({
        minTransactions: 10n,
        minVolumeUsd: 0n,
        requiresBoth: false,
        requiresManualReview: false,
      })
      .mockResolvedValueOnce({
        minTransactions: 50n,
        minVolumeUsd: 0n,
        requiresBoth: false,
        requiresManualReview: true,
      });
    visa.reviewRequestedTier.mockResolvedValue(0n);
    visa.manualReviewApproved.mockResolvedValue(false);
    visa.getVisaWallet.mockResolvedValue(ethers.ZeroAddress);
    registry.ownerOf.mockResolvedValue(WALLET);
    txCount.mockResolvedValue(0);
  });

  /**
   * Call the single-agent visa route.
   *
   * @param agentId - Agent ID path segment.
   * @param chainId - Chain ID path segment.
   * @returns The response and its parsed JSON body.
   */
  async function get(agentId: string, chainId = "42220") {
    const { GET } = await import("@/app/api/visa/[chainId]/[agentId]/route");
    const res = await GET(req("https://test.com"), {
      params: Promise.resolve({ chainId, agentId }),
    });
    return { res, body: await jsonBody(res) };
  }

  it("derives eligibility from live metrics without an on-chain eligibility call", async () => {
    const { res, body } = await get("123");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      agentId: "123",
      tier: 1,
      metrics: {
        transactionCount: 12,
        volumeUsd: 2.5,
        lastUpdated: 123,
      },
      eligibility: {
        1: true,
        2: true,
        3: false,
      },
    });
    expect(visa.checkTierEligibility).not.toHaveBeenCalled();
  });

  it("honors minVolumeUsd and requiresBoth when deriving eligibility", async () => {
    // tier 1: tx-only, met. tier 2: requiresBoth tx+volume, volume short.
    // tier 3: either-axis, volume clears even though tx does not.
    visa.getTierThresholds.mockReset();
    visa.getTierThresholds
      .mockResolvedValueOnce({
        minTransactions: 1n,
        minVolumeUsd: 0n,
        requiresBoth: false,
        requiresManualReview: false,
      })
      .mockResolvedValueOnce({
        minTransactions: 10n,
        minVolumeUsd: 5_000_000n, // $5 — metrics only have $2.5
        requiresBoth: true,
        requiresManualReview: false,
      })
      .mockResolvedValueOnce({
        minTransactions: 50n, // not met (12 tx)
        minVolumeUsd: 1_000_000n, // $1 — met by $2.5
        requiresBoth: false,
        requiresManualReview: false,
      });

    const { res, body } = await get("123");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      eligibility: {
        1: true,
        2: false, // requiresBoth but volume short
        3: true, // either-axis: volume clears
      },
    });
  });

  it("reads the visa wallet's live tx count but never writes, even with a relayer key", async () => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "0x" + "ab".repeat(32));
    visa.getVisaWallet.mockResolvedValue(VISA_WALLET);
    txCount.mockResolvedValue(60);
    const { res, body } = await get("123");
    expect(res.status).toBe(200);
    expect(body.metrics).toMatchObject({ transactionCount: 60 });
    expect(visa.updateMetrics).not.toHaveBeenCalled();
  });

  it("returns 160-bit wallet-based ids as decimal strings", async () => {
    registry.ownerOf.mockRejectedValue(notFound());
    const { res, body } = await get(WALLET_ID);
    expect(res.status).toBe(200);
    expect(body.agentId).toBe(WALLET_ID);
  });

  it("returns 404 when the id has no visa and is not in the registry", async () => {
    visa.getTier.mockResolvedValue(0n);
    registry.ownerOf.mockRejectedValue(notFound());
    expect((await get(WALLET_ID)).res.status).toBe(404);
    expect((await get("999999")).body).toEqual({ error: "Agent not found" });
  });

  it("returns tier 0 for a registry agent without a visa", async () => {
    visa.getTier.mockResolvedValue(0n);
    const { res, body } = await get("5");
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ agentId: "5", tier: 0 });
  });

  it("returns 400 for bad ids and chains, and 502 on RPC errors", async () => {
    expect((await get("0x7b")).res.status).toBe(400);
    expect((await get("1" + "0".repeat(78))).res.status).toBe(400);
    expect((await get("123", "constructor")).res.status).toBe(400);
    visa.getTier.mockRejectedValue(new Error("boom https://rpc"));
    expect((await get("123")).body).toEqual({ error: "RPC error" });
  });
});

describe("visa batch route (GET /api/visa/[chainId]/batch)", () => {
  /**
   * Call the batch visa route on Celo mainnet.
   *
   * @param agents - Raw comma-separated `agents` query value.
   * @param ip - Fixed client IP; a fresh IP per call when omitted.
   * @returns The response and its parsed JSON body.
   */
  async function batch(agents: string, ip?: string) {
    const { GET } = await import("@/app/api/visa/[chainId]/batch/route");
    const url = `https://test.com/api/visa/42220/batch?agents=${encodeURIComponent(agents)}`;
    const res = await GET(
      ip ? makeNextRequest(url, { headers: { "x-real-ip": ip } }) : req(url),
      { params: Promise.resolve({ chainId: "42220" }) },
    );
    return { res, body: await jsonBody(res) };
  }

  beforeEach(() => {
    visa.getTier.mockImplementation(async (id: bigint) =>
      id === 7n ? 2n : 0n,
    );
  });

  it("dedupes ids and returns them as strings", async () => {
    const { res, body } = await batch(`7, 1,7,${WALLET_ID}`);
    expect(res.status).toBe(200);
    expect(body).toEqual({
      agents: [
        { agentId: "7", tier: 2, tierName: "Work Visa" },
        { agentId: "1", tier: 0, tierName: "None" },
        { agentId: WALLET_ID, tier: 0, tierName: "None" },
      ],
    });
    expect(visa.getTier).toHaveBeenCalledTimes(3);
  });

  it("returns 400 naming any invalid id instead of dropping it", async () => {
    for (const bad of ["0x7", "", "2.5", "-1", "0"]) {
      const { res, body } = await batch(`7,${bad}`);
      expect(res.status).toBe(400);
      expect(body.error).toBe(`Invalid agent ID: ${bad}`);
    }
  });

  it("caps the raw list at 100 entries, before dedupe", async () => {
    expect((await batch(Array(101).fill("7").join(","))).res.status).toBe(400);
    expect((await batch(Array(100).fill("7").join(","))).res.status).toBe(200);
  });

  it("rate limits per IP", async () => {
    let last = 0;
    for (let i = 0; i < 61; i++)
      last = (await batch("7", "10.2.2.2")).res.status;
    expect(last).toBe(429);
  });
});

describe("visa agents route (GET /api/visa/agents)", () => {
  beforeEach(() => {
    registry.getAgentId.mockResolvedValue(0n);
    registry.balanceOf.mockResolvedValue(0n);
    visa.getTier.mockResolvedValue(0n);
    mockScan.mockReset();
  });

  /**
   * Call the visa agents-by-wallet route.
   *
   * @param wallet - `wallet` query value.
   * @param chainId - `chainId` query value.
   * @returns The response and its parsed JSON body.
   */
  async function agents(wallet = WALLET, chainId = "42220") {
    const { GET } = await import("@/app/api/visa/agents/route");
    const res = await GET(
      req(
        `https://test.com/api/visa/agents?wallet=${wallet}&chainId=${chainId}`,
      ),
    );
    return { res, body: await jsonBody(res) };
  }

  it("returns the agent whose key is the wallet without scanning", async () => {
    registry.getAgentId.mockResolvedValue(123n);

    const { res, body } = await agents();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      agents: [{ agentId: "123", chainId: 42220 }],
      complete: true,
    });
    expect(registry.getAgentId).toHaveBeenCalledWith(
      ethers.zeroPadValue(WALLET, 32),
    );
    expect(mockScan).not.toHaveBeenCalled();
  });

  it("finds owned agents with the on-chain id walk (no third-party indexer)", async () => {
    registry.balanceOf.mockResolvedValue(2n);
    mockScan.mockResolvedValue([456n, 40n]);

    const { res, body } = await agents();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      agents: [
        { agentId: "40", chainId: 42220 },
        { agentId: "456", chainId: 42220 },
      ],
      complete: true,
    });
    expect(mockScan).toHaveBeenCalledWith(
      expect.anything(),
      "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
      "ownerOf",
      WALLET,
      2,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("flags the result incomplete when the walk finds fewer agents than balanceOf", async () => {
    registry.balanceOf.mockResolvedValue(3n);
    mockScan.mockResolvedValue([40n]);
    expect((await agents()).body).toMatchObject({ complete: false });
  });

  it("includes wallet-based visa agents when the wallet has a visa tier", async () => {
    visa.getTier.mockResolvedValue(1n);

    const { res, body } = await agents();
    expect(res.status).toBe(200);
    expect(body).toEqual({
      agents: [{ agentId: WALLET_ID, chainId: 42220, isWalletBased: true }],
      complete: true,
    });
    expect(visa.getTier).toHaveBeenCalledWith(BigInt(WALLET_ID));
  });

  it("returns 400 for non-canonical or zero wallets and bad chains, and 502 when lookups fail", async () => {
    for (const bad of [
      "0x123",
      WALLET.toLowerCase().slice(0, 41) + "B", // bad checksum
      WALLET.slice(2), // no 0x
      ethers.getIcapAddress(WALLET),
      ethers.ZeroAddress,
    ]) {
      const { res, body } = await agents(bad);
      expect(res.status, bad).toBe(400);
      expect(body).toEqual({ error: "Invalid address" });
    }
    expect((await agents(WALLET, "1")).body).toEqual({
      error: "Unsupported chain",
    });

    registry.balanceOf.mockResolvedValue(3n);
    mockScan.mockRejectedValue(new Error("rpc down https://secret"));
    const failed = await agents();
    expect(failed.res.status).toBe(502);
    expect(failed.body).toEqual({ error: "RPC error" });
  });
});
