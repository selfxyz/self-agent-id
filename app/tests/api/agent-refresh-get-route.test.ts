import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRegistrationConfigIndex } from "@selfxyz/agent-sdk";
import { makeNextRequest } from "./test-utils";

// A non-zero on-chain configId; the agent's configId must match one of the six
// registered config slots for refresh to resolve a config index.
const CONFIG_ID = "0x" + "ab".repeat(32);
const ZERO_BYTES32 = "0x" + "0".repeat(64);
const NFT_OWNER = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";

const mockGetUniversalLink = vi.fn();
const mockErrorResponse = vi.fn();
const mockCorsResponse = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockGetNetworkConfig = vi.fn();
const mockIsValidNetwork = vi.fn();
const mockTypedRegistry = vi.fn();

const mockAgentConfigId = vi.fn();
const mockHasHumanProof = vi.fn();
const mockConfigIds = vi.fn();
const mockOwnerOf = vi.fn();

const builderArgs: Record<string, unknown>[] = [];

class MockSelfAppBuilder {
  private readonly args: Record<string, unknown>;
  constructor(args: Record<string, unknown>) {
    this.args = args;
    builderArgs.push(args);
  }
  build() {
    return { kind: "self-app", ...this.args };
  }
}

function installMocks() {
  vi.doMock("@selfxyz/qrcode", () => ({
    SelfAppBuilder: MockSelfAppBuilder,
    getUniversalLink: mockGetUniversalLink,
  }));

  vi.doMock("@/lib/agent-api-helpers", () => ({
    getNetworkConfig: mockGetNetworkConfig,
    isValidNetwork: mockIsValidNetwork,
    errorResponse: mockErrorResponse,
    corsResponse: mockCorsResponse,
    // Provided so the route's module-level import binding resolves; unused by GET.
    getSessionSecret: vi.fn(),
    jsonResponse: vi.fn(),
  }));

  vi.doMock("@/lib/rateLimit", () => ({
    checkRateLimit: mockCheckRateLimit,
  }));

  vi.doMock("@/lib/contract-types", () => ({
    typedRegistry: mockTypedRegistry,
  }));
}

async function loadRoute() {
  vi.resetModules();
  installMocks();
  return import("@/app/api/agent/refresh/route");
}

function refreshUrl(query: Record<string, string | number> = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) sp.set(k, String(v));
  return `https://agent-api.self.xyz/api/agent/refresh?${sp.toString()}`;
}

/** Make registry.configIds(i) match CONFIG_ID only at `matchIndex` (-1 = never). */
function setMatchingConfigIndex(matchIndex: number) {
  mockConfigIds.mockImplementation(async (i: bigint) =>
    Number(i) === matchIndex ? CONFIG_ID : "0x" + "11".repeat(32),
  );
}

describe("agent refresh reauth entry point (GET /api/agent/refresh)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    builderArgs.length = 0;

    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 19,
      retryAfterMs: 0,
    });
    mockIsValidNetwork.mockImplementation(
      (v: string) => v === "mainnet" || v === "testnet",
    );
    mockGetNetworkConfig.mockReturnValue({
      rpcUrl: "https://rpc.example.org",
      registryAddress: "0xRegistry",
      selfEndpointType: "staging_celo",
    });
    mockGetUniversalLink.mockReturnValue("self://renew-proof");
    mockErrorResponse.mockImplementation((message: string, status: number) =>
      Response.json({ error: message }, { status }),
    );
    mockCorsResponse.mockReturnValue(new Response(null, { status: 204 }));

    mockTypedRegistry.mockReturnValue({
      agentConfigId: mockAgentConfigId,
      hasHumanProof: mockHasHumanProof,
      configIds: mockConfigIds,
      ownerOf: mockOwnerOf,
    });
    mockAgentConfigId.mockResolvedValue(CONFIG_ID);
    mockHasHumanProof.mockResolvedValue(true);
    mockOwnerOf.mockResolvedValue(NFT_OWNER);
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
    // The deep link's session is bound to the agent's NFT owner.
    expect(builderArgs[0]).toMatchObject({
      version: 2,
      endpoint: "0xRegistry",
      userId: NFT_OWNER.toLowerCase(),
      endpointType: "staging_celo",
      userIdType: "hex",
    });
  });

  it("maps chainId 42220 → mainnet and 11142220 → testnet", async () => {
    const { GET } = await loadRoute();

    await GET(makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })));
    expect(mockGetNetworkConfig).toHaveBeenLastCalledWith("mainnet");

    await GET(makeNextRequest(refreshUrl({ agentId: 1, chainId: 11142220 })));
    expect(mockGetNetworkConfig).toHaveBeenLastCalledWith("testnet");
  });

  it("accepts an explicit ?network= param", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, network: "testnet" })),
    );
    expect(res.status).toBe(302);
    expect(mockGetNetworkConfig).toHaveBeenCalledWith("testnet");
  });

  it("accepts a ?registry= that matches the chain's configured registry", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(
        refreshUrl({ agentId: 7, chainId: 42220, registry: "0xRegistry" }),
      ),
    );
    expect(res.status).toBe(302);
  });

  it("accepts a ?registry= that matches case-insensitively", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(
        refreshUrl({ agentId: 7, chainId: 42220, registry: "0xREGISTRY" }),
      ),
    );
    expect(res.status).toBe(302);
  });

  it("returns 400 when ?registry= does not match the configured registry", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(
        refreshUrl({
          agentId: 7,
          chainId: 42220,
          registry: "0xDeadBeef",
        }),
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/does not match/i),
    });
    // Must reject before any on-chain read against the wrong contract.
    expect(mockAgentConfigId).not.toHaveBeenCalled();
  });

  it("returns 429 when rate limited", async () => {
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
  });

  it("returns 400 for a missing or non-positive agentId", async () => {
    const { GET } = await loadRoute();
    for (const q of [
      { chainId: 42220 },
      { agentId: 0, chainId: 42220 },
      { agentId: -3, chainId: 42220 },
    ]) {
      const res = await GET(makeNextRequest(refreshUrl(q)));
      expect(res.status).toBe(400);
    }
  });

  it("returns 400 when neither a valid network nor a known chainId is given", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, chainId: 999 })),
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 when the agent has a zero configId (refresh unsupported)", async () => {
    mockAgentConfigId.mockResolvedValue(ZERO_BYTES32);
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/does not support proof refresh/i),
    });
  });

  it("returns 400 when the agent has no current human proof", async () => {
    mockHasHumanProof.mockResolvedValue(false);
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringMatching(/re-register instead/i),
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

  it("returns 500 when an on-chain read throws", async () => {
    mockAgentConfigId.mockRejectedValue(new Error("rpc down"));
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(refreshUrl({ agentId: 1, chainId: 42220 })),
    );
    expect(res.status).toBe(500);
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
        minimumAge?: number;
        ofac?: boolean;
      };
      expect(
        getRegistrationConfigIndex(disclosures),
        `route disclosures for slot ${index} round-trip to a different index`,
      ).toBe(index);
    }
  });

  it("returns the shared CORS preflight response", async () => {
    const { OPTIONS } = await loadRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
    expect(mockCorsResponse).toHaveBeenCalled();
  });
});
