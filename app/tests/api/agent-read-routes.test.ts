// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests for the agent read routes: info, verify, verify-status, reputation,
 * cards, agents-by-address and agents-by-nullifier.
 *
 * Real ethers, helpers and chain config; only the contract bindings and the
 * agent-ID scan are faked.
 */

import { ethers } from "ethers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";

const registry: Record<string, ReturnType<typeof vi.fn>> = {};
const provider = {
  verificationStrength: vi.fn(),
  providerName: vi.fn(),
};
const mockScan = vi.fn();

const PROVIDER = "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d";
const KEY_5 =
  "0x00000000000000000000000059489da9e1eb1f162b0d8eeeadc0314f49ad759a";
const ADDR_5 = "0x59489DA9E1EB1f162b0d8eeeaDC0314f49Ad759A";
const ZERO_KEY = "0x" + "0".repeat(64);
const NUL3 = "\u0000\u0000\u0000";
const EXPIRY = 1803752935n; // 2027-02-27T18:28:55Z

/**
 * Stub every registry read with one live, verified agent (mainnet agent 5 shape).
 *
 * @param overrides - Registry method name to resolved value, replacing defaults.
 */
function liveAgent(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    agentIdToAgentKey: KEY_5,
    hasHumanProof: true,
    isProofFresh: true,
    proofExpiresAt: EXPIRY,
    getProofProvider: PROVIDER,
    agentRegisteredAt: 60316177n,
    getAgentCredentials: {
      issuingState: NUL3,
      name: ["", "\u0000\u0000"],
      idNumber: NUL3,
      nationality: "IND",
      dateOfBirth: "\u0000\u0000-\u0000\u0000-\u0000\u0000",
      gender: "\u0000",
      expiryDate: "UNAVAILABLE",
      olderThan: 18n,
      ofac: [true, false, false],
    },
    getAgentMetadata: "",
    getHumanNullifier: 99n,
    selfProofProvider: PROVIDER,
    getAgentCountForHuman: 3n,
    balanceOf: 0n,
    getAgentId: 0n,
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    registry[name] = vi.fn().mockResolvedValue(value);
  }
}

/** Stub the registry with a burned (or never-minted) agent: zero key, no proof. */
function burnedAgent() {
  liveAgent({
    agentIdToAgentKey: ZERO_KEY,
    hasHumanProof: false,
    isProofFresh: false,
    proofExpiresAt: 0n,
    getProofProvider: "0x0000000000000000000000000000000000000000",
  });
}

/** Stub a live agent whose first registry read fails with an RPC error. */
function rpcDown() {
  liveAgent();
  registry.agentIdToAgentKey = vi
    .fn()
    .mockRejectedValue(new Error("could not coalesce error (https://rpc)"));
}

/**
 * Re-import a route module with fresh state, faked contract bindings and a
 * mocked `scanAgentIds`.
 *
 * @param path - Module path of the route to import.
 * @returns The imported route module.
 */
async function load<T>(path: string): Promise<T> {
  vi.resetModules();
  vi.doMock("@/lib/contract-types", () => ({
    typedRegistry: () => registry,
    typedProvider: () => provider,
  }));
  vi.doMock("@/lib/agent-read", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/agent-read")>()),
    scanAgentIds: mockScan,
  }));
  return (await import(path)) as T;
}

type Handler = (
  req: ReturnType<typeof makeNextRequest>,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

const PER_AGENT_ROUTES = {
  info: "@/app/api/agent/info/[chainId]/[agentId]/route",
  verify: "@/app/api/agent/verify/[chainId]/[agentId]/route",
  verifyStatus: "@/app/api/verify-status/[chainId]/[agentId]/route",
  reputation: "@/app/api/reputation/[chainId]/[agentId]/route",
  cards: "@/app/api/cards/[chainId]/[agentId]/route",
};

/**
 * Call a dynamic read route's GET handler with the given path params.
 *
 * @param route - Module path of the route.
 * @param params - Dynamic route params (e.g. chainId, agentId).
 * @returns The route's response.
 */
async function get(route: string, params: Record<string, string>) {
  const { GET } = await load<{ GET: Handler }>(route);
  return GET(makeNextRequest("http://localhost:3100/x"), {
    params: Promise.resolve(params),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (
    globalThis as { __selfMemoryCounters?: Map<string, unknown> }
  ).__selfMemoryCounters?.clear();
  for (const key of Object.keys(registry)) delete registry[key];
  provider.verificationStrength.mockResolvedValue(100);
  provider.providerName.mockResolvedValue("self");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe.each(Object.entries(PER_AGENT_ROUTES))(
  "%s route: shared status contract",
  (_name, route) => {
    it("rejects unsupported chains and non-canonical ids with 400", async () => {
      liveAgent();
      for (const [chainId, agentId] of [
        ["999", "1"],
        ["constructor", "1"],
        ["__proto__", "1"],
        ["42220", "0"],
        ["42220", "0x1"],
        ["42220", "01"],
        ["42220", " 1 "],
        ["42220", "-1"],
        ["42220", "1.5"],
      ]) {
        const res = await get(route, { chainId, agentId });
        expect(res.status, `${chainId}/${agentId}`).toBe(400);
      }
      expect(registry.agentIdToAgentKey).not.toHaveBeenCalled();
    });

    it("returns 404 without an RPC call for ids above MAX_SAFE_INTEGER", async () => {
      liveAgent();
      const res = await get(route, {
        chainId: "42220",
        agentId: "9007199254740992",
      });
      expect(res.status).toBe(404);
      expect(await jsonBody(res)).toEqual({ error: "Agent not found" });
      expect(registry.agentIdToAgentKey).not.toHaveBeenCalled();
    });

    it("returns 404 for never-minted or burned agents", async () => {
      burnedAgent();
      const res = await get(route, { chainId: "42220", agentId: "4" });
      expect(res.status).toBe(404);
      expect(await jsonBody(res)).toEqual({ error: "Agent not found" });
      expect(res.headers.get("cache-control")).toBeNull();
    });

    it("maps RPC failures to a generic 502", async () => {
      rpcDown();
      const res = await get(route, { chainId: "42220", agentId: "5" });
      expect(res.status).toBe(502);
      expect(await jsonBody(res)).toEqual({ error: "RPC error" });
    });
  },
);

describe("per-agent routes: verified = hasHumanProof && isProofFresh", () => {
  it("reports an expired proof as not verified everywhere", async () => {
    for (const route of Object.values(PER_AGENT_ROUTES)) {
      liveAgent({ isProofFresh: false });
      const body = await jsonBody<Record<string, unknown>>(
        await get(route, { chainId: "42220", agentId: "5" }),
      );
      const verified =
        (body.selfProtocol as Record<string, unknown> | undefined)
          ?.isVerified ??
        body.isVerified ??
        body.verified;
      expect(verified, route).toBe(false);
    }
  });
});

describe("agent info route", () => {
  it("returns verification, block number and cleaned credentials", async () => {
    liveAgent({
      getAgentCredentials: {
        issuingState: NUL3,
        name: [],
        idNumber: "",
        nationality: NUL3,
        dateOfBirth: "",
        gender: "",
        expiryDate: "",
        olderThan: 0n,
        ofac: [false, false, false],
      },
    });
    const res = await get(PER_AGENT_ROUTES.info, {
      chainId: "42220",
      agentId: "5",
    });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      agentId: 5,
      chainId: 42220,
      agentKey: KEY_5,
      agentAddress: ADDR_5,
      isVerified: true,
      hasHumanProof: true,
      isProofFresh: true,
      proofExpiresAt: "2027-02-27T18:28:55.000Z",
      proofProvider: PROVIDER,
      registeredAtBlock: 60316177,
      verificationStrength: 100,
      strengthLabel: "passport",
      credentials: {
        nationality: null,
        olderThan: 0,
        ofac: [false, false, false],
      },
      network: "mainnet",
    });
  });
});

describe("agent verify route", () => {
  it("returns provider, freshness and human count", async () => {
    liveAgent();
    const res = await get(PER_AGENT_ROUTES.verify, {
      chainId: "42220",
      agentId: "5",
    });
    expect(await jsonBody(res)).toEqual({
      agentId: 5,
      chainId: 42220,
      isVerified: true,
      hasHumanProof: true,
      isProofFresh: true,
      proofExpiresAt: "2027-02-27T18:28:55.000Z",
      proofProvider: PROVIDER,
      isSelfProvider: true,
      verificationStrength: 100,
      strengthLabel: "passport",
      humanNullifier: "99",
      agentCountForHuman: 3,
    });
  });
});

describe("verify-status route", () => {
  it("returns registeredAtBlock as a number", async () => {
    liveAgent();
    const res = await get(PER_AGENT_ROUTES.verifyStatus, {
      chainId: "42220",
      agentId: "5",
    });
    expect(await jsonBody(res)).toEqual({
      verified: true,
      hasHumanProof: true,
      isProofFresh: true,
      proofExpiresAt: "2027-02-27T18:28:55.000Z",
      proofType: "passport",
      registeredAtBlock: 60316177,
      providerAddress: PROVIDER,
    });
  });
});

describe("reputation route", () => {
  it("returns score and proof details", async () => {
    liveAgent();
    const res = await get(PER_AGENT_ROUTES.reputation, {
      chainId: "42220",
      agentId: "5",
    });
    expect(await jsonBody(res)).toEqual({
      score: 100,
      hasProof: true,
      isVerified: true,
      isProofFresh: true,
      proofExpiresAt: "2027-02-27T18:28:55.000Z",
      providerName: "self",
      proofType: "passport",
    });
  });
});

describe("cards route", () => {
  it("builds a card from contract state when the agent has no metadata", async () => {
    liveAgent();
    const res = await get(PER_AGENT_ROUTES.cards, {
      chainId: "42220",
      agentId: "5",
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=60");
    const card = await jsonBody<Record<string, unknown>>(res);
    expect(card.name).toBe("Agent #5");
    expect(card).not.toHaveProperty("image");
    expect(card).not.toHaveProperty("url");
    expect(card.services).toEqual([
      expect.objectContaining({
        name: "registry-a2a",
        endpoint: "http://localhost:3100/api/a2a",
      }),
    ]);
    expect(card.selfProtocol).toMatchObject({
      agentId: 5,
      chainId: 42220,
      isVerified: true,
      registeredAtBlock: 60316177,
      credentials: {
        nationality: "IND",
        issuingState: null,
        olderThan: 18,
        ofacClean: true,
        hasName: false,
        hasDateOfBirth: false,
        hasGender: false,
        documentExpiry: null,
      },
    });
  });

  it("keeps agent-declared fields but replaces stale selfProtocol data", async () => {
    liveAgent({
      getAgentMetadata: JSON.stringify({
        name: "Agent Alpha",
        url: "https://alpha.example/a2a",
        services: [{ name: "A2A", endpoint: "https://alpha.example/a2a" }],
        selfProtocol: {
          verificationStrength: 999,
          credentials: { issuingState: NUL3 },
        },
      }),
    });
    const card = await jsonBody<Record<string, unknown>>(
      await get(PER_AGENT_ROUTES.cards, { chainId: "42220", agentId: "5" }),
    );
    expect(card.name).toBe("Agent Alpha");
    expect(card.url).toBe("https://alpha.example/a2a");
    expect((card.services as unknown[]).length).toBe(2);
    expect(card.selfProtocol).toMatchObject({
      verificationStrength: 100,
      credentials: { issuingState: null },
    });
  });
});

describe("agents-by-address route", () => {
  const route = "@/app/api/agent/agents/[chainId]/[address]/route";
  const OWNER = "0x2da338827F94a835107451192Abfa702a1c50259";

  it("returns 400 for unsupported chains and invalid addresses", async () => {
    liveAgent();
    expect((await get(route, { chainId: "999", address: OWNER })).status).toBe(
      400,
    );
    // Zero address (balanceOf(0) reverts on-chain), un-prefixed and ICAP
    // forms are bad input, not an RPC error.
    for (const address of [
      "0xabc",
      ethers.ZeroAddress,
      OWNER.slice(2),
      ethers.getIcapAddress(OWNER),
    ]) {
      const res = await get(route, { chainId: "42220", address });
      expect(res.status, address).toBe(400);
      expect(await jsonBody(res)).toEqual({ error: "Invalid address" });
    }
    expect(registry.balanceOf).not.toHaveBeenCalled();
  });

  it("lists every agent the wallet owns plus its own agent key", async () => {
    liveAgent({ balanceOf: 2n, getAgentId: 9n });
    mockScan.mockResolvedValue([7n, 5n]);
    const res = await get(route, {
      chainId: "42220",
      address: OWNER.toLowerCase(),
    });
    const body = await jsonBody<{
      humanAddress: string;
      agents: { agentId: number; isOwner: boolean; isAgentKey: boolean }[];
      totalCount: number;
      ownedCount: number;
      complete: boolean;
    }>(res);
    expect(mockScan).toHaveBeenCalledWith(
      expect.anything(),
      "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
      "ownerOf",
      OWNER,
      2,
    );
    expect(body.humanAddress).toBe(OWNER);
    expect(
      body.agents.map((a) => [a.agentId, a.isOwner, a.isAgentKey]),
    ).toEqual([
      [5, true, false],
      [7, true, false],
      [9, false, true],
    ]);
    expect(body.totalCount).toBe(3);
    expect(body.ownedCount).toBe(2);
    expect(body.complete).toBe(true);
  });

  it("flags an incomplete scan instead of presenting it as complete", async () => {
    liveAgent({ balanceOf: 3n });
    mockScan.mockResolvedValue([5n]);
    const body = await jsonBody<{ complete: boolean; totalCount: number }>(
      await get(route, { chainId: "42220", address: OWNER }),
    );
    expect(body).toMatchObject({ complete: false, totalCount: 1 });
  });

  it("skips the scan for wallets that own nothing", async () => {
    liveAgent();
    const body = await jsonBody(
      await get(route, { chainId: "42220", address: OWNER }),
    );
    expect(body).toMatchObject({
      agents: [],
      totalCount: 0,
      ownedCount: 0,
      complete: true,
    });
    expect(mockScan).not.toHaveBeenCalled();
  });
});

describe("agents-by-nullifier route", () => {
  const route =
    "@/app/api/agent/agents-by-nullifier/[chainId]/[nullifier]/route";

  it("rejects malformed nullifiers with 400", async () => {
    liveAgent();
    for (const nullifier of [
      "-1",
      " ",
      "0",
      "0x10",
      "01",
      "1e3",
      "abc",
      "2".repeat(80),
    ]) {
      const res = await get(route, { chainId: "42220", nullifier });
      expect(res.status, nullifier).toBe(400);
    }
  });

  it("uses the paginated index when it matches the on-chain count", async () => {
    liveAgent({ getAgentCountForHuman: 1n, getAgentsForNullifier: [5n] });
    const body = await jsonBody(
      await get(route, { chainId: "42220", nullifier: "99" }),
    );
    expect(registry.getAgentsForNullifier).toHaveBeenCalledWith(99n, 0n, 100n);
    expect(mockScan).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      nullifier: "99",
      totalCount: 1,
      activeAgentCount: 1,
      complete: true,
      agents: [
        {
          agentId: 5,
          isVerified: true,
          proofExpiresAt: "2027-02-27T18:28:55.000Z",
        },
      ],
    });
  });

  it("falls back to an id scan when the index misses older agents", async () => {
    liveAgent({ getAgentCountForHuman: 3n, getAgentsForNullifier: [26n] });
    mockScan.mockResolvedValue([5n, 7n, 26n]);
    const body = await jsonBody<{
      agents: { agentId: number }[];
      complete: boolean;
    }>(await get(route, { chainId: "42220", nullifier: "99" }));
    expect(mockScan).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      "getHumanNullifier",
      99n,
      3,
    );
    expect(body.agents.map((a) => a.agentId)).toEqual([5, 7, 26]);
    expect(body.complete).toBe(true);
  });

  it("reports complete=false when even the scan cannot account for all agents", async () => {
    liveAgent({ getAgentCountForHuman: 3n, getAgentsForNullifier: [26n] });
    mockScan.mockResolvedValue([26n]);
    const body = await jsonBody(
      await get(route, { chainId: "42220", nullifier: "99" }),
    );
    expect(body).toMatchObject({
      totalCount: 1,
      activeAgentCount: 3,
      complete: false,
    });
  });
});

describe("per-IP read limits", () => {
  /**
   * Call a route's GET handler `n` times from one fixed IP.
   *
   * @param route - Module path of the route.
   * @param params - Dynamic route params.
   * @param n - Number of calls.
   * @returns The last response.
   */
  async function hammer(
    route: string,
    params: Record<string, string>,
    n: number,
  ) {
    const { GET } = await load<{ GET: Handler }>(route);
    let res: Response | undefined;
    for (let i = 0; i < n; i++) {
      res = await GET(
        makeNextRequest("http://localhost:3100/x", {
          headers: { "x-real-ip": "10.7.7.7" },
        }),
        { params: Promise.resolve(params) },
      );
    }
    return res!;
  }

  it("allows 120 single-agent reads per minute, shared across routes", async () => {
    liveAgent();
    expect(
      (
        await hammer(
          PER_AGENT_ROUTES.info,
          { chainId: "42220", agentId: "5" },
          120,
        )
      ).status,
    ).toBe(200);
    const limited = await hammer(
      PER_AGENT_ROUTES.verify,
      { chainId: "42220", agentId: "5" },
      1,
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
  });

  it("allows 20 agents-by-address scans per minute, then returns 429", async () => {
    liveAgent();
    const route = "@/app/api/agent/agents/[chainId]/[address]/route";
    const params = {
      chainId: "42220",
      address: "0x2da338827F94a835107451192Abfa702a1c50259",
    };
    expect((await hammer(route, params, 20)).status).toBe(200);
    expect((await hammer(route, params, 1)).status).toBe(429);
  });
});

describe("OPTIONS preflight", () => {
  it("returns 204 on every read route", async () => {
    for (const route of [
      ...Object.values(PER_AGENT_ROUTES),
      "@/app/api/agent/agents/[chainId]/[address]/route",
      "@/app/api/agent/agents-by-nullifier/[chainId]/[nullifier]/route",
    ]) {
      const { OPTIONS } = await load<{ OPTIONS: () => Response }>(route);
      expect(OPTIONS().status).toBe(204);
    }
  });
});
