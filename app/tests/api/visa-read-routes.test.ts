import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";

const WALLET = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const WALLET_ID = BigInt(WALLET).toString();

const mockTypedVisa = vi.fn();
const mockGetTier = vi.fn();
const mockGetMetrics = vi.fn();
const mockCheckTierEligibility = vi.fn();
const mockGetTierThresholds = vi.fn();
const mockReviewRequestedTier = vi.fn();
const mockManualReviewApproved = vi.fn();

const mockRegistryGetAgentId = vi.fn();
const mockRegistryOwnerOf = vi.fn();
const mockRegistryBalanceOf = vi.fn();
const mockRegistryQueryFilter = vi.fn();
const mockVisaGetTier = vi.fn();

function installReadRouteMocks() {
  vi.doMock("@/lib/chain-config", () => ({
    CHAIN_CONFIG: {
      "42220": {
        rpc: "https://forno.celo.org",
        registry: "0xregistry",
        visa: "0xvisa",
        blockExplorer: "https://celoscan.io",
        registryDeployBlock: 0,
        visaDeployBlock: 0,
      },
    },
  }));

  vi.doMock("@/lib/constants", () => ({
    REGISTRY_ABI: ["registry"],
    VISA_ABI: ["visa"],
  }));

  vi.doMock("@/lib/contract-types", () => ({
    typedVisa: mockTypedVisa,
  }));

  vi.doMock("ethers", () => {
    class MockJsonRpcProvider {
      async getBlockNumber() {
        return 100;
      }
    }

    class MockContract {
      readonly kind: "registry" | "visa";

      constructor(_addr: string, abi: string[]) {
        this.kind = abi[0] === "visa" ? "visa" : "registry";
      }

      get filters() {
        return {
          Transfer: (_from: string | null, to: string) => ({
            event: "Transfer",
            to,
          }),
        };
      }

      async getAgentId(key: string) {
        return mockRegistryGetAgentId(key);
      }

      async ownerOf(tokenId: bigint) {
        return mockRegistryOwnerOf(tokenId);
      }

      async balanceOf(owner: string) {
        return mockRegistryBalanceOf(owner);
      }

      async queryFilter(filter: unknown, fromBlock: number, toBlock: number) {
        return mockRegistryQueryFilter(filter, fromBlock, toBlock);
      }

      async getTier(agentId: bigint) {
        return mockVisaGetTier(agentId);
      }
    }

    return {
      ethers: {
        ZeroAddress: "0x0000000000000000000000000000000000000000",
        JsonRpcProvider: MockJsonRpcProvider,
        Contract: MockContract,
        getAddress: (addr: string) => addr,
        zeroPadValue: (value: string) => `padded:${value}`,
      },
    };
  });
}

describe("visa read route (GET /api/visa/[chainId]/[agentId])", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.clearAllMocks();
    installReadRouteMocks();

    mockTypedVisa.mockReturnValue({
      getTier: mockGetTier,
      getMetrics: mockGetMetrics,
      checkTierEligibility: mockCheckTierEligibility,
      getTierThresholds: mockGetTierThresholds,
      reviewRequestedTier: mockReviewRequestedTier,
      manualReviewApproved: mockManualReviewApproved,
    });
    mockGetTier.mockResolvedValue(1n);
    mockGetMetrics.mockResolvedValue({
      transactionCount: 12n,
      volumeUsd: 2_500_000n,
      lastUpdated: 123n,
    });
    mockCheckTierEligibility.mockResolvedValue(true);
    mockGetTierThresholds
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
    mockReviewRequestedTier.mockResolvedValue(0n);
    mockManualReviewApproved.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("derives eligibility from live metrics without an on-chain eligibility call", async () => {
    const { GET } = await import("@/app/api/visa/[chainId]/[agentId]/route");
    const res = await GET(makeNextRequest("https://test.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "123" }),
    });

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      agentId: 123,
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
    // Eligibility is derived in-process from live metrics, not via an on-chain
    // checkTierEligibility round-trip.
    expect(mockCheckTierEligibility).not.toHaveBeenCalled();
  });

  it("honors minVolumeUsd and requiresBoth when deriving eligibility", async () => {
    // tier 1: tx-only, met. tier 2: requiresBoth tx+volume, volume short.
    // tier 3: either-axis, volume clears even though tx does not.
    mockGetTierThresholds.mockReset();
    mockGetTierThresholds
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

    const { GET } = await import("@/app/api/visa/[chainId]/[agentId]/route");
    const res = await GET(makeNextRequest("https://test.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "123" }),
    });

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      eligibility: {
        1: true,
        2: false, // requiresBoth but volume short
        3: true, // either-axis: volume clears
      },
    });
  });
});

describe("visa agents route (GET /api/visa/agents)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    installReadRouteMocks();
    mockRegistryGetAgentId.mockResolvedValue(0n);
    mockRegistryOwnerOf.mockResolvedValue(WALLET);
    mockRegistryBalanceOf.mockResolvedValue(0n);
    mockRegistryQueryFilter.mockResolvedValue([]);
    mockVisaGetTier.mockResolvedValue(0n);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it("returns a simple-mode registry agent for the wallet", async () => {
    mockRegistryGetAgentId.mockResolvedValue(123n);
    mockRegistryBalanceOf.mockResolvedValue(1n);

    const { GET } = await import("@/app/api/visa/agents/route");
    const res = await GET(
      makeNextRequest(
        `https://test.com/api/visa/agents?wallet=${WALLET}&chainId=42220`,
      ),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      agents: [{ agentId: "123", chainId: 42220 }],
    });
    expect(mockRegistryGetAgentId).toHaveBeenCalledWith(`padded:${WALLET}`);
    expect(mockRegistryOwnerOf).toHaveBeenCalledWith(123n);
  });

  it("discovers advanced-mode registry agents from Transfer events", async () => {
    mockRegistryBalanceOf.mockResolvedValue(1n);
    mockRegistryQueryFilter.mockResolvedValue([{ args: [null, WALLET, 456n] }]);

    const { GET } = await import("@/app/api/visa/agents/route");
    const res = await GET(
      makeNextRequest(
        `https://test.com/api/visa/agents?wallet=${WALLET}&chainId=42220`,
      ),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      agents: [{ agentId: "456", chainId: 42220 }],
    });
    expect(mockRegistryQueryFilter).toHaveBeenCalled();
    expect(mockRegistryOwnerOf).toHaveBeenCalledWith(456n);
  });

  it("includes wallet-based visa agents when the wallet has a visa tier", async () => {
    mockVisaGetTier.mockResolvedValue(1n);

    const { GET } = await import("@/app/api/visa/agents/route");
    const res = await GET(
      makeNextRequest(
        `https://test.com/api/visa/agents?wallet=${WALLET}&chainId=42220`,
      ),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      agents: [
        {
          agentId: WALLET_ID,
          chainId: 42220,
          isWalletBased: true,
        },
      ],
    });
    expect(mockVisaGetTier).toHaveBeenCalledWith(BigInt(WALLET_ID));
  });
});
