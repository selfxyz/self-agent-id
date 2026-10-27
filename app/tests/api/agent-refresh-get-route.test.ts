// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for GET /api/agent/refresh (the 302 reauth deep-link entry point). */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRegistrationConfigIndex } from "@selfxyz/agent-sdk";
import { makeNextRequest } from "./test-utils";

// A non-zero on-chain configId; the agent's configId must match one of the six
// registered config slots for refresh to resolve a config index.
const CONFIG_ID = "0x" + "ab".repeat(32);
const ZERO_BYTES32 = "0x" + "0".repeat(64);
const AGENT_KEY = "0x" + "00".repeat(12) + "11".repeat(20);
const NFT_OWNER = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const MAINNET_REGISTRY = "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944";

const mockCheckRateLimit = vi.fn();
const registry = {
  agentIdToAgentKey: vi.fn(),
  agentConfigId: vi.fn(),
  configIds: vi.fn(),
  ownerOf: vi.fn(),
  proofExpiresAt: vi.fn(),
};
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
 * Re-import the refresh route with fresh state and the Self QR SDK, rate
 * limiter and registry mocked.
 *
 * @returns The refresh route module.
 */
async function loadRoute() {
  vi.resetModules();
  vi.doMock("@selfxyz/sdk-common", () => ({
    SelfAppBuilder: MockSelfAppBuilder,
    getUniversalLink: () => "self://renew-proof",
  }));
  vi.doMock("@/lib/rate-limit", () => ({ checkRateLimit: mockCheckRateLimit }));
  vi.doMock("@/lib/contract-types", () => ({ typedRegistry: () => registry }));
  return import("@/app/api/agent/refresh/route");
}

/**
 * Build a GET /api/agent/refresh URL.
 *
 * @param query - Query params to set (stringified).
 * @returns The absolute URL.
 */
function refreshUrl(query: Record<string, string | number> = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) sp.set(k, String(v));
  return `https://agent-api.self.xyz/api/agent/refresh?${sp.toString()}`;
}

/**
 * Make `registry.configIds(i)` return CONFIG_ID only at one slot.
 *
 * @param matchIndex - Config slot that matches; -1 for none.
 */
function setMatchingConfigIndex(matchIndex: number) {
  registry.configIds.mockImplementation(async (i: bigint) =>
    Number(i) === matchIndex ? CONFIG_ID : "0x" + "11".repeat(32),
  );
}

describe("agent refresh reauth entry point (GET /api/agent/refresh)", () => {
  beforeEach(() => {
    builderArgs.length = 0;
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      retryAfterMs: 0,
    });
    registry.agentIdToAgentKey.mockResolvedValue(AGENT_KEY);
    registry.agentConfigId.mockResolvedValue(CONFIG_ID);
    registry.ownerOf.mockResolvedValue(NFT_OWNER);
    registry.proofExpiresAt.mockResolvedValue(1_900_000_000n);
    setMatchingConfigIndex(1); // age>=18, no OFAC by default
  });

  it("302-redirects to the Self deep link for a valid agent", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 7, chainId: 42220 })),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("self://renew-proof");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    // The deep link's session is bound to the agent's NFT owner.
    expect(builderArgs[0]).toMatchObject({
      version: 2,
      endpoint: MAINNET_REGISTRY,
      userId: NFT_OWNER.toLowerCase(),
      endpointType: "celo",
      userIdType: "hex",
      userDefinedData: "F1" + "\0".repeat(31) + "\x07",
    });
  });

  it("maps chainId 42220 → mainnet and 11142220 → testnet", async () => {
    const { GET } = await loadRoute();

    await GET(makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })));
    expect(builderArgs[0].endpointType).toBe("celo");

    await GET(makeNextRequest(refreshUrl({ agentId: 1, chainId: 11142220 })));
    expect(builderArgs[1].endpointType).toBe("staging_celo");
  });

  it("accepts an explicit ?network= param", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, network: "testnet" })),
    );
    expect(res.status).toBe(302);
    expect(builderArgs[0].endpointType).toBe("staging_celo");
  });

  it("returns 400 when ?network= and ?chainId= disagree", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(
        refreshUrl({ agentId: 1, chainId: 42220, network: "testnet" }),
      ),
    );
    expect(res.status).toBe(400);
    expect(registry.agentIdToAgentKey).not.toHaveBeenCalled();
  });

  it("accepts a ?registry= that matches the chain's registry case-insensitively", async () => {
    const { GET } = await loadRoute();
    for (const registryParam of [
      MAINNET_REGISTRY,
      MAINNET_REGISTRY.toUpperCase().replace("0X", "0x"),
    ]) {
      const res = await GET(
        makeNextRequest(
          refreshUrl({ agentId: 7, chainId: 42220, registry: registryParam }),
        ),
      );
      expect(res.status).toBe(302);
    }
  });

  it("returns 400 when ?registry= does not match the configured registry", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(
        refreshUrl({ agentId: 7, chainId: 42220, registry: "0xDeadBeef" }),
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/does not match/i),
    });
    // Must reject before any on-chain read against the wrong contract.
    expect(registry.agentIdToAgentKey).not.toHaveBeenCalled();
  });

  it("returns 429 with Retry-After when rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1");
  });

  it("returns 400 for a missing or non-canonical agentId", async () => {
    const { GET } = await loadRoute();
    for (const agentId of [undefined, 0, -3, "1e1", "0x14", "01", "1.0"]) {
      const res = await GET(
        makeNextRequest(
          refreshUrl(
            agentId === undefined
              ? { chainId: 42220 }
              : { agentId, chainId: 42220 },
          ),
        ),
      );
      expect(res.status, String(agentId)).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid agent ID" });
    }
  });

  it("returns 400 when neither a valid network nor a known chainId is given", async () => {
    const { GET } = await loadRoute();
    for (const q of [{ chainId: 999 }, { network: "devnet" }, {}] as Record<
      string,
      string | number
    >[]) {
      const res = await GET(makeNextRequest(refreshUrl({ agentId: 1, ...q })));
      expect(res.status).toBe(400);
    }
  });

  it("returns 404 for an agent that doesn't exist", async () => {
    registry.agentIdToAgentKey.mockResolvedValue(ZERO_BYTES32);
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 5000, chainId: 42220 })),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Agent not found" });

    const huge = await GET(
      makeNextRequest(
        refreshUrl({ agentId: "99999999999999999999", chainId: 42220 }),
      ),
    );
    expect(huge.status).toBe(404);
  });

  it("returns 400 when the agent has a zero configId (refresh unsupported)", async () => {
    registry.agentConfigId.mockResolvedValue(ZERO_BYTES32);
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(
        /no stored verification config.*Deregister it and register again/,
      ),
    });
  });

  it("returns 400 when the configId matches none of the registered slots", async () => {
    setMatchingConfigIndex(-1);
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/could not resolve/i),
    });
  });

  it("returns 422 for agent IDs the deployed contract would decode differently", async () => {
    const { GET } = await loadRoute();
    for (const [agentId, status] of [
      [127, 302],
      [128, 422],
      [256, 302],
      [384, 422],
    ] as const) {
      const res = await GET(
        makeNextRequest(refreshUrl({ agentId, chainId: 42220 })),
      );
      expect(res.status, `agent ${agentId}`).toBe(status);
      if (status === 422) {
        expect((await res.json()).error).toMatch(
          /deregister it and register again/,
        );
      }
    }
  });

  it("returns a generic 502 when an on-chain read throws", async () => {
    registry.agentIdToAgentKey.mockRejectedValue(new Error("rpc down at url"));
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })),
    );
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "RPC error" });
  });

  // Drift guard: the route's private INDEX_TO_DISCLOSURES is the inverse of the
  // SDK's config-index mapping. For every config slot, the disclosures the route
  // derives must map back to the same index via the SDK's forward function — or
  // the two have silently diverged.
  it("derives disclosures that round-trip through the SDK's getRegistrationConfigIndex for all 6 slots", async () => {
    for (let index = 0; index < 6; index++) {
      builderArgs.length = 0;
      setMatchingConfigIndex(index);
      const { GET } = await loadRoute();

      const res = await GET(
        makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })),
      );
      expect(res.status, `slot ${index} should redirect`).toBe(302);

      const disclosures = builderArgs[0].disclosures as {
        minimumAge?: 0 | 18 | 21;
        ofac?: boolean;
      };
      expect(
        getRegistrationConfigIndex(disclosures),
        `route disclosures for slot ${index} round-trip to a different index`,
      ).toBe(index);
    }
  });

  it("returns 204 with CORS headers for OPTIONS", async () => {
    const { OPTIONS } = await loadRoute();
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
