// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests for POST /api/visa/claim, /api/visa/migrate and /api/visa/request-review.
 *
 * Signatures are real EIP-191; the registry and visa contracts and tx counts are mocked.
 */

import { ethers } from "ethers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildVisaRequestMessage, type VisaAction } from "@/lib/visa-auth";
import { jsonBody, makeNextRequest } from "./test-utils";

const CHAIN = "42220";
const ZERO = ethers.ZeroAddress;
const owner = ethers.Wallet.createRandom();
const stranger = ethers.Wallet.createRandom();
const agentKeyWallet = ethers.Wallet.createRandom();

const THRESHOLDS: Record<number, Record<string, unknown>> = {
  1: {
    minTransactions: 1n,
    minVolumeUsd: 0n,
    requiresBoth: true,
    requiresManualReview: false,
  },
  2: {
    minTransactions: 1000n,
    minVolumeUsd: 5_000_000_000n,
    requiresBoth: false,
    requiresManualReview: false,
  },
  3: {
    minTransactions: 10_000n,
    minVolumeUsd: 15_000_000_000n,
    requiresBoth: false,
    requiresManualReview: true,
  },
};

const registry = {
  ownerOf: vi.fn(),
  agentIdToAgentKey: vi.fn(),
  isProofFresh: vi.fn(),
};
const visa = {
  getTier: vi.fn(),
  getVisaWallet: vi.fn(),
  getTierThresholds: vi.fn(),
  manualReviewApproved: vi.fn(),
  reviewRequestedTier: vi.fn(),
  getMetrics: vi.fn(),
  updateMetrics: vi.fn(),
  mintVisa: vi.fn(),
  claimTierUpgrade: vi.fn(),
  requestReview: vi.fn(),
};
const txCount = vi.fn();
/** Runners the routes passed to typedVisa (provider for reads, signer for writes). */
const visaRunners: unknown[] = [];

/**
 * Build a fake sent transaction whose wait() resolves to a receipt at block 7.
 *
 * @param hash - Transaction hash to report.
 * @returns The transaction-like object.
 */
function sentTx(hash: string) {
  return { hash, wait: vi.fn().mockResolvedValue({ hash, blockNumber: 7 }) };
}

/**
 * Build the CALL_EXCEPTION ethers throws for an unknown token.
 *
 * @returns The error to reject a contract call with.
 */
function notFound() {
  return ethers.makeError("execution reverted", "CALL_EXCEPTION");
}

/**
 * Reset contract mocks to the default world.
 *
 * Agent 61 is owned by `owner` and keyed by `agentKeyWallet`, has a fresh
 * proof and no visa; every write succeeds and the visa wallet has 5 txs.
 */
function setDefaults() {
  registry.ownerOf.mockImplementation(async (id: bigint) => {
    if (id === 61n) return owner.address;
    throw notFound();
  });
  registry.agentIdToAgentKey.mockResolvedValue(
    ethers.zeroPadValue(agentKeyWallet.address, 32),
  );
  registry.isProofFresh.mockResolvedValue(true);
  visa.getTier.mockResolvedValue(0n);
  visa.getVisaWallet.mockResolvedValue(ZERO);
  visa.getTierThresholds.mockImplementation(async (t: number) => THRESHOLDS[t]);
  visa.manualReviewApproved.mockResolvedValue(false);
  visa.reviewRequestedTier.mockResolvedValue(0n);
  visa.getMetrics.mockResolvedValue({
    transactionCount: 0n,
    volumeUsd: 0n,
    lastUpdated: 0n,
  });
  visa.updateMetrics.mockResolvedValue(sentTx("0xmetrics"));
  visa.mintVisa.mockResolvedValue(sentTx("0xmint"));
  visa.claimTierUpgrade.mockResolvedValue(sentTx("0xclaim"));
  visa.requestReview.mockResolvedValue(sentTx("0xreview"));
  txCount.mockResolvedValue(5);
}

let ipCounter = 0;
let tsCounter = 0;

/**
 * Sign a visa request body the way a client would (EIP-191 over the visa request message).
 *
 * @param action - Visa action being authorized.
 * @param fields - Request fields; chainId, agentId/oldAgentId, newAgentId and targetTier go into the message.
 * @param signer - Wallet that signs; defaults to the agent owner.
 * @param timestamp - Signed timestamp in ms; unique per call by default.
 * @returns The fields plus `signature` and `timestamp`.
 */
async function signedBody(
  action: VisaAction,
  fields: Record<string, string | number> & { chainId: string },
  signer: ethers.Wallet | ethers.HDNodeWallet = owner,
  // Unique per call so identical requests are not treated as replays.
  timestamp = Date.now() + ++tsCounter,
) {
  const signature = await signer.signMessage(
    buildVisaRequestMessage({
      action,
      chainId: fields.chainId,
      agentId: BigInt(fields.oldAgentId ?? fields.agentId),
      newAgentId:
        fields.newAgentId === undefined ? undefined : BigInt(fields.newAgentId),
      targetTier: Number(fields.targetTier ?? 1),
      timestamp,
    }),
  );
  return { ...fields, signature, timestamp };
}

/**
 * POST a JSON body to a visa write route.
 *
 * @param route - Route under /api/visa/.
 * @param body - Request body.
 * @param ip - Client IP; a fresh one per call by default.
 * @returns The response and its parsed JSON body.
 */
async function call(
  route: "claim" | "migrate" | "request-review",
  body: unknown,
  ip = `10.0.0.${++ipCounter}`,
) {
  const { POST } = await import(`@/app/api/visa/${route}/route`);
  const res: Response = await POST(
    makeNextRequest(`https://test.com/api/visa/${route}`, {
      method: "POST",
      headers: { "x-real-ip": ip },
      body: JSON.stringify(body),
    }),
  );
  return { res, body: await jsonBody(res) };
}

beforeEach(() => {
  vi.resetModules();
  // Relayer budgets are per signer too; each test starts with fresh counters.
  (
    globalThis as { __selfMemoryCounters?: Map<string, unknown> }
  ).__selfMemoryCounters?.clear();
  vi.stubEnv("RELAYER_PRIVATE_KEY", "0x" + "ab".repeat(32));
  visaRunners.length = 0;
  vi.doMock("@/lib/contract-types", () => ({
    typedRegistry: () => registry,
    typedVisa: (_address: string, runner: unknown) => {
      visaRunners.push(runner);
      return visa;
    },
  }));
  vi.spyOn(
    ethers.JsonRpcProvider.prototype,
    "getTransactionCount",
  ).mockImplementation(() => txCount());
  setDefaults();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@/lib/contract-types");
});

describe("POST /api/visa/claim", () => {
  const base = { chainId: CHAIN, agentId: "61", targetTier: 1 };

  it("rejects bad input with 400 before checking signatures", async () => {
    for (const bad of [
      { ...base, targetTier: "2" },
      { ...base, targetTier: 2.5 },
      { ...base, targetTier: 4 },
      { ...base, agentId: "0x3d" },
      { ...base, agentId: "0" },
      { ...base, chainId: "constructor" },
      { ...base, agentWallet: "0x123" },
      { ...base, agentWallet: "XE65GB6LDNXYOFTX0NSV3FUWKOWIXAMJK36" },
      { ...base, agentWallet: "5e25ee9d40d32cb17ef2ecd006470831acf8ab95" },
      { ...base, agentWallet: "0x0000000000000000000000000000000000000000" },
    ]) {
      expect((await call("claim", bad)).res.status).toBe(400);
    }
  });

  it("returns 401 for missing, expired, tampered and replayed signatures", async () => {
    expect((await call("claim", base)).res.status).toBe(401);

    const stale = await signedBody(
      "claim",
      base,
      owner,
      Date.now() - 6 * 60_000,
    );
    expect((await call("claim", stale)).body.error).toMatch(/expired/);

    const signed = await signedBody("claim", base);
    const tampered = { ...signed, signature: signed.signature.slice(0, -2) };
    expect((await call("claim", tampered)).res.status).toBe(401);

    expect((await call("claim", signed)).res.status).toBe(200);
    const replay = await call("claim", signed);
    expect(replay.res.status).toBe(401);
    expect(replay.body.error).toMatch(/already used/);
  });

  it("returns 403 when the signer is neither owner nor agent key", async () => {
    const { res } = await call(
      "claim",
      await signedBody("claim", base, stranger),
    );
    expect(res.status).toBe(403);
    expect(visa.mintVisa).not.toHaveBeenCalled();
  });

  it("returns 404 for an id that is neither a registry agent nor a visa holder", async () => {
    const missing = await call(
      "claim",
      await signedBody("claim", { ...base, agentId: "62" }),
    );
    expect(missing.res.status).toBe(404);
    expect(missing.body).toEqual({ error: "Agent not found" });

    // Someone else's wallet-based visa exists: forbidden, not missing.
    visa.getTier.mockResolvedValue(1n);
    const walletId = BigInt(owner.address).toString();
    const forbidden = await call(
      "claim",
      await signedBody(
        "claim",
        { ...base, agentId: walletId, targetTier: 2 },
        stranger,
      ),
    );
    expect(forbidden.res.status).toBe(403);
  });

  it("checks auth before the missing-relayer 503", async () => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "");
    const denied = await call(
      "claim",
      await signedBody("claim", base, stranger),
    );
    expect(denied.res.status).toBe(403);
    const allowed = await call("claim", await signedBody("claim", base));
    expect(allowed.res.status).toBe(503);
  });

  it("mints with the signer as wallet, pushing live metrics first", async () => {
    const { res, body } = await call(
      "claim",
      await signedBody("claim", base, agentKeyWallet),
    );
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      agentId: "61",
      previousTier: 0,
      newTier: 1,
      wallet: agentKeyWallet.address,
      txHash: "0xmint",
    });
    expect(visa.updateMetrics).toHaveBeenCalledWith(61n, 5n, 0n);
    expect(visa.mintVisa).toHaveBeenCalledWith(61n, 1, agentKeyWallet.address);
  });

  it("uses the stored visa wallet and skips updateMetrics when already eligible", async () => {
    const stored = ethers.Wallet.createRandom().address;
    visa.getTier.mockResolvedValue(1n);
    visa.getVisaWallet.mockResolvedValue(stored);
    visa.getMetrics.mockResolvedValue({
      transactionCount: 2000n,
      volumeUsd: 0n,
      lastUpdated: 1n,
    });
    const { res, body } = await call(
      "claim",
      await signedBody("claim", { ...base, targetTier: 2 }),
    );
    expect(res.status).toBe(200);
    expect(body.wallet).toBe(stored);
    expect(visa.updateMetrics).not.toHaveBeenCalled();
    expect(visa.claimTierUpgrade).toHaveBeenCalledWith(61n, 2);
  });

  it("returns 403 when agentWallet is not the signer", async () => {
    const { res } = await call(
      "claim",
      await signedBody("claim", {
        ...base,
        agentWallet: stranger.address,
      }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses ineligible claims without sending any transaction", async () => {
    const { res, body } = await call(
      "claim",
      await signedBody("claim", { ...base, targetTier: 2 }),
    );
    expect(res.status).toBe(422);
    expect(body.code).toBe("NOT_ELIGIBLE");
    expect(visa.updateMetrics).not.toHaveBeenCalled();
    expect(visa.mintVisa).not.toHaveBeenCalled();
  });

  it("lets a wallet claim Tourist for its own wallet-based id but not Work", async () => {
    const walletId = BigInt(stranger.address).toString();
    const ok = await call(
      "claim",
      await signedBody("claim", { ...base, agentId: walletId }, stranger),
    );
    expect(ok.res.status).toBe(200);
    expect(visa.mintVisa).toHaveBeenCalledWith(
      BigInt(walletId),
      1,
      stranger.address,
    );

    txCount.mockResolvedValue(5000);
    const work = await call(
      "claim",
      await signedBody(
        "claim",
        { ...base, agentId: walletId, targetTier: 2 },
        stranger,
      ),
    );
    expect(work.res.status).toBe(422);
    expect(visa.mintVisa).toHaveBeenCalledTimes(1);
  });

  it("reserves relayer budget atomically before sending, per IP", async () => {
    // Distinct signers (each claiming its own wallet-based id), one IP.
    const bodies = await Promise.all(
      Array.from({ length: 8 }, () => {
        const wallet = ethers.Wallet.createRandom();
        return signedBody(
          "claim",
          { ...base, agentId: BigInt(wallet.address).toString() },
          wallet,
        );
      }),
    );
    const results = await Promise.all(
      bodies.map((b) => call("claim", b, "10.9.9.9")),
    );
    const statuses = results.map((r) => r.res.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
    expect(visa.mintVisa).toHaveBeenCalledTimes(5);
    const limited = results.find((r) => r.res.status === 429)!;
    expect(limited.res.headers.get("Retry-After")).toBeTruthy();
  });

  it("caps relayed transactions per signer across IPs", async () => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await call("claim", await signedBody("claim", base)));
    }
    expect(results.map((r) => r.res.status)).toEqual([200, 200, 429]);
    expect(results[2].body.error).toMatch(/per signer/);
    expect(results[2].res.headers.get("Retry-After")).toBeTruthy();
    expect(visa.mintVisa).toHaveBeenCalledTimes(2);
  });

  it("returns a generic 502 on RPC failure", async () => {
    visa.getTier.mockRejectedValue(new Error("secret rpc url https://x"));
    const { res, body } = await call("claim", await signedBody("claim", base));
    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "RPC error" });
  });

  it("includes the broadcast txHash in the 502 when confirmation fails", async () => {
    visa.mintVisa.mockResolvedValue({
      hash: "0xmint",
      wait: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const minted = await call("claim", await signedBody("claim", base));
    expect(minted.res.status).toBe(502);
    expect(minted.body).toEqual({ error: "RPC error", txHash: "0xmint" });

    // The metrics update fails to confirm: its hash is the last one sent.
    visa.updateMetrics.mockResolvedValue({
      hash: "0xmetrics",
      wait: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const metrics = await call(
      "claim",
      await signedBody("claim", base, agentKeyWallet),
    );
    expect(metrics.res.status).toBe(502);
    expect(metrics.body).toEqual({ error: "RPC error", txHash: "0xmetrics" });
  });

  it("applies the per-IP attempt limit before consuming the signature", async () => {
    const ip = "10.8.8.8";
    for (let i = 0; i < 20; i++) {
      expect((await call("claim", base, ip)).res.status).toBe(401);
    }
    const signed = await signedBody("claim", base);
    const limited = await call("claim", signed, ip);
    expect(limited.res.status).toBe(429);
    expect(limited.res.headers.get("Retry-After")).toBeTruthy();
    // The 429 did not use the signature up: it still works from elsewhere.
    expect((await call("claim", signed)).res.status).toBe(200);
  });
});

describe("POST /api/visa/migrate", () => {
  // The signer's wallet-based visa moves to registry agent 61, which it owns.
  const oldAgentId = BigInt(owner.address).toString();
  const base = {
    chainId: CHAIN,
    oldAgentId,
    newAgentId: "61",
    connectedWallet: owner.address,
  };

  beforeEach(() => {
    visa.getTier.mockImplementation(async (id: bigint) =>
      id === BigInt(oldAgentId) ? 1n : 0n,
    );
    visa.getVisaWallet.mockResolvedValue(owner.address);
  });

  it("mints the new visa with the old visa's wallet", async () => {
    const { res, body } = await call(
      "migrate",
      await signedBody("migrate", base),
    );
    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      oldAgentId,
      newAgentId: "61",
      migratedWallet: owner.address,
      migratedTxCount: 5,
      newTier: 1,
      txHash: "0xmint",
    });
    expect(visa.updateMetrics).toHaveBeenCalledWith(61n, 5n, 0n);
    expect(visa.mintVisa).toHaveBeenCalledWith(61n, 1, owner.address);
  });

  it("returns 403 when connectedWallet or oldAgentId is not the signer's", async () => {
    const other = ethers.Wallet.createRandom();
    expect(
      (
        await call(
          "migrate",
          await signedBody("migrate", {
            ...base,
            connectedWallet: other.address,
          }),
        )
      ).res.status,
    ).toBe(403);
    expect(
      (
        await call(
          "migrate",
          await signedBody("migrate", {
            ...base,
            oldAgentId: BigInt(other.address).toString(),
          }),
        )
      ).res.status,
    ).toBe(403);
  });

  it("returns 403 when the signer does not control newAgentId, and 404 when it does not exist", async () => {
    const strangerOld = BigInt(stranger.address).toString();
    const notOwner = await call(
      "migrate",
      await signedBody(
        "migrate",
        { ...base, oldAgentId: strangerOld, connectedWallet: stranger.address },
        stranger,
      ),
    );
    expect(notOwner.res.status).toBe(403);

    const missing = await call(
      "migrate",
      await signedBody("migrate", { ...base, newAgentId: "62" }),
    );
    expect(missing.res.status).toBe(404);
    expect(visa.mintVisa).not.toHaveBeenCalled();
  });

  it("answers a manual-review tier with REVIEW_REQUIRED, like claim", async () => {
    txCount.mockResolvedValue(20_000);
    const { res, body } = await call(
      "migrate",
      await signedBody("migrate", { ...base, targetTier: 3 }),
    );
    expect(res.status).toBe(422);
    expect(body).toEqual({
      error: "Manual review required for this tier",
      code: "REVIEW_REQUIRED",
      reviewRequested: false,
    });
    expect(visa.updateMetrics).not.toHaveBeenCalled();
    expect(visa.mintVisa).not.toHaveBeenCalled();
  });

  it("includes the broadcast txHash in the 502 when the mint does not confirm", async () => {
    visa.mintVisa.mockResolvedValue({
      hash: "0xmint",
      wait: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const { res, body } = await call(
      "migrate",
      await signedBody("migrate", base),
    );
    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "RPC error", txHash: "0xmint" });
  });
});

describe("POST /api/visa/request-review", () => {
  const base = { chainId: CHAIN, agentId: "61", targetTier: 3 };

  it("files a review for an authorized visa holder", async () => {
    visa.getTier.mockResolvedValue(2n);
    const { res, body } = await call(
      "request-review",
      await signedBody("request-review", base),
    );
    expect(res.status).toBe(200);
    expect(body).toEqual({
      success: true,
      agentId: "61",
      targetTier: 3,
      txHash: "0xreview",
    });
    expect(visa.requestReview).toHaveBeenCalledWith(61n, 3);
    // Writes go through a NonceManager, as in claim and migrate.
    expect(visaRunners.at(-1)).toBeInstanceOf(ethers.NonceManager);
  });

  it("includes the broadcast txHash in the 502 when confirmation fails", async () => {
    visa.getTier.mockResolvedValue(2n);
    visa.requestReview.mockResolvedValue({
      hash: "0xreview",
      wait: vi.fn().mockRejectedValue(new Error("timeout")),
    });
    const { res, body } = await call(
      "request-review",
      await signedBody("request-review", base),
    );
    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "RPC error", txHash: "0xreview" });
  });

  it("rejects unauthorized, visa-less, non-higher and duplicate requests", async () => {
    visa.getTier.mockResolvedValue(2n);
    expect(
      (
        await call(
          "request-review",
          await signedBody("request-review", base, stranger),
        )
      ).res.status,
    ).toBe(403);

    visa.reviewRequestedTier.mockResolvedValue(3n);
    expect(
      (await call("request-review", await signedBody("request-review", base)))
        .res.status,
    ).toBe(409);

    visa.getTier.mockResolvedValue(3n);
    expect(
      (await call("request-review", await signedBody("request-review", base)))
        .res.status,
    ).toBe(409);

    visa.getTier.mockResolvedValue(0n);
    expect(
      (await call("request-review", await signedBody("request-review", base)))
        .res.status,
    ).toBe(422);

    const walletId = BigInt(stranger.address).toString();
    expect(
      (
        await call(
          "request-review",
          await signedBody(
            "request-review",
            { ...base, agentId: walletId },
            stranger,
          ),
        )
      ).res.status,
    ).toBe(404);

    expect(visa.requestReview).not.toHaveBeenCalled();
  });

  it("rejects targetTier 1 with 400", async () => {
    const { res } = await call(
      "request-review",
      await signedBody("request-review", { ...base, targetTier: 1 }),
    );
    expect(res.status).toBe(400);
  });
});
