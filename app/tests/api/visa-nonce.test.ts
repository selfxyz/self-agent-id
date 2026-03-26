import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";

// ── Shared mock state ──────────────────────────────────────────────────────
const WALLET = "0xAb5801a7D398351b8bE11C439e05C5B3259aeC9B";
const OLD_AGENT_ID = BigInt(WALLET).toString();
const NEW_AGENT_ID = "999";

const mockWait = vi.fn().mockResolvedValue({ hash: "0xabc" });

const mockGetTier = vi.fn();
const mockIsProofFresh = vi.fn();
const mockGetVisaWallet = vi.fn();
const mockUpdateMetrics = vi.fn();
const mockMintVisa = vi.fn();
const mockGetTransactionCount = vi.fn();
const mockCheckTierEligibility = vi.fn();
const mockGetMetrics = vi.fn();
const mockGetTierThresholds = vi.fn();
const mockClaimTierUpgrade = vi.fn();
const mockManualReviewApproved = vi.fn();
const mockReviewRequestedTier = vi.fn();

/** Track whether NonceManager was used to wrap the wallet */
let nonceManagerUsed = false;

/** Track nonces assigned by the signer to each sendTransaction call */
const assignedNonces: number[] = [];
const BASE_NONCE = 42;

function installMocks() {
  vi.doMock("ethers", () => {
    const actual = {
      ZeroAddress: "0x0000000000000000000000000000000000000000",
      getAddress: (addr: string) => addr,
    };

    class MockJsonRpcProvider {
      async getTransactionCount() {
        return mockGetTransactionCount();
      }
    }

    class MockWallet {
      provider: MockJsonRpcProvider;
      constructor(_pk: string, provider: MockJsonRpcProvider) {
        this.provider = provider;
      }
    }

    /**
     * Real NonceManager behavior: tracks a delta that increments with each
     * sendTransaction, so sequential txs from the same signer get unique nonces
     * even before the first tx confirms on-chain.
     */
    class MockNonceManager {
      signer: MockWallet;
      _delta = 0;

      constructor(signer: MockWallet) {
        this.signer = signer;
        nonceManagerUsed = true;
      }

      /** Called internally by ethers Contract when sending a write tx */
      async sendTransaction() {
        const nonce = BASE_NONCE + this._delta;
        this._delta++;
        assignedNonces.push(nonce);
        return { wait: mockWait, hash: "0xabc", nonce };
      }

      async getAddress() {
        return "0xrelayer";
      }
    }

    // The mock contract stores a reference to the signer so we can route
    // write calls (updateMetrics, mintVisa, etc.) through it.
    let contractSigner: MockNonceManager | null = null;

    class MockContract {
      constructor(
        _addr: string,
        _abi: unknown[],
        signer?: MockNonceManager | MockJsonRpcProvider,
      ) {
        if (signer instanceof MockNonceManager) {
          contractSigner = signer;
        }
      }

      // Read methods — return mock values directly
      getTier = mockGetTier;
      isProofFresh = mockIsProofFresh;
      getVisaWallet = mockGetVisaWallet;
      checkTierEligibility = mockCheckTierEligibility;
      getMetrics = mockGetMetrics;
      getTierThresholds = mockGetTierThresholds;
      manualReviewApproved = mockManualReviewApproved;
      reviewRequestedTier = mockReviewRequestedTier;

      // Write methods — route through the signer so nonces are tracked
      updateMetrics = vi.fn().mockImplementation(async (...args: unknown[]) => {
        mockUpdateMetrics(...args);
        return contractSigner!.sendTransaction();
      });

      mintVisa = vi.fn().mockImplementation(async (...args: unknown[]) => {
        mockMintVisa(...args);
        return contractSigner!.sendTransaction();
      });

      claimTierUpgrade = vi
        .fn()
        .mockImplementation(async (...args: unknown[]) => {
          mockClaimTierUpgrade(...args);
          return contractSigner!.sendTransaction();
        });
    }

    return {
      ethers: {
        ...actual,
        JsonRpcProvider: MockJsonRpcProvider,
        Wallet: MockWallet,
        NonceManager: MockNonceManager,
        Contract: MockContract,
      },
    };
  });

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
    VISA_ABI: [],
    REGISTRY_ABI: [],
  }));

  vi.doMock("@/lib/rate-limit", () => ({
    checkRateLimit: vi.fn().mockReturnValue(null),
    recordRelayerTx: vi.fn(),
  }));
}

// ── Migrate route tests ─────────────────────────────────────────────────────

describe("visa migrate route — nonce management", () => {
  beforeEach(() => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "0x" + "ab".repeat(32));
    assignedNonces.length = 0;
    nonceManagerUsed = false;
    installMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses NonceManager to wrap the relayer wallet", async () => {
    mockGetTier.mockResolvedValueOnce(1n).mockResolvedValueOnce(0n);
    mockIsProofFresh.mockResolvedValue(true);
    mockGetVisaWallet.mockResolvedValue(WALLET);
    mockGetTransactionCount.mockResolvedValue(50);

    const { POST } = await import("@/app/api/visa/migrate/route");
    await POST(
      makeNextRequest("https://test.com/api/visa/migrate", {
        method: "POST",
        body: JSON.stringify({
          chainId: "42220",
          oldAgentId: OLD_AGENT_ID,
          newAgentId: NEW_AGENT_ID,
          connectedWallet: WALLET,
        }),
      }),
    );

    expect(nonceManagerUsed).toBe(true);
  });

  it("assigns incrementing nonces when updateMetrics + mintVisa are sent sequentially", async () => {
    mockGetTier.mockResolvedValueOnce(1n).mockResolvedValueOnce(0n);
    mockIsProofFresh.mockResolvedValue(true);
    mockGetVisaWallet.mockResolvedValue(WALLET);
    mockGetTransactionCount.mockResolvedValue(50);

    const { POST } = await import("@/app/api/visa/migrate/route");
    const res = await POST(
      makeNextRequest("https://test.com/api/visa/migrate", {
        method: "POST",
        body: JSON.stringify({
          chainId: "42220",
          oldAgentId: OLD_AGENT_ID,
          newAgentId: NEW_AGENT_ID,
          connectedWallet: WALLET,
        }),
      }),
    );

    const body = await jsonBody(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true });

    // Critical: two txs sent with incrementing nonces — no collision
    expect(assignedNonces).toHaveLength(2);
    expect(assignedNonces[0]).toBe(BASE_NONCE); // updateMetrics
    expect(assignedNonces[1]).toBe(BASE_NONCE + 1); // mintVisa
  });

  it("sends only one tx when txCount is 0 (skips updateMetrics)", async () => {
    mockGetTier.mockResolvedValueOnce(1n).mockResolvedValueOnce(0n);
    mockIsProofFresh.mockResolvedValue(true);
    mockGetVisaWallet.mockResolvedValue(WALLET);
    mockGetTransactionCount.mockResolvedValue(0);

    const { POST } = await import("@/app/api/visa/migrate/route");
    const res = await POST(
      makeNextRequest("https://test.com/api/visa/migrate", {
        method: "POST",
        body: JSON.stringify({
          chainId: "42220",
          oldAgentId: OLD_AGENT_ID,
          newAgentId: NEW_AGENT_ID,
          connectedWallet: WALLET,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(assignedNonces).toHaveLength(1); // only mintVisa
    expect(assignedNonces[0]).toBe(BASE_NONCE);
    expect(mockUpdateMetrics).not.toHaveBeenCalled();
  });
});

// ── Claim route tests ───────────────────────────────────────────────────────

describe("visa claim route — nonce management", () => {
  beforeEach(() => {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "0x" + "ab".repeat(32));
    assignedNonces.length = 0;
    nonceManagerUsed = false;
    installMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses NonceManager to wrap the relayer wallet", async () => {
    mockGetTier.mockResolvedValue(0n);
    mockGetTierThresholds.mockResolvedValue({
      minTransactions: 1n,
      minVolumeUsd: 0n,
      requiresBoth: false,
      requiresManualReview: false,
    });
    mockGetTransactionCount.mockResolvedValue(10);
    mockCheckTierEligibility.mockResolvedValue(true);
    mockGetVisaWallet.mockResolvedValue(
      "0x0000000000000000000000000000000000000000",
    );

    const { POST } = await import("@/app/api/visa/claim/route");
    await POST(
      makeNextRequest("https://test.com/api/visa/claim", {
        method: "POST",
        body: JSON.stringify({
          chainId: "42220",
          agentId: "12345",
          targetTier: 1,
          agentWallet: WALLET,
        }),
      }),
    );

    expect(nonceManagerUsed).toBe(true);
  });

  it("assigns incrementing nonces when updateMetrics + mintVisa are sent sequentially", async () => {
    mockGetTier.mockResolvedValue(0n);
    mockGetTierThresholds.mockResolvedValue({
      minTransactions: 1n,
      minVolumeUsd: 0n,
      requiresBoth: false,
      requiresManualReview: false,
    });
    mockGetTransactionCount.mockResolvedValue(10);
    mockCheckTierEligibility.mockResolvedValue(true);
    mockGetVisaWallet.mockResolvedValue(
      "0x0000000000000000000000000000000000000000",
    );

    const { POST } = await import("@/app/api/visa/claim/route");
    const res = await POST(
      makeNextRequest("https://test.com/api/visa/claim", {
        method: "POST",
        body: JSON.stringify({
          chainId: "42220",
          agentId: "12345",
          targetTier: 1,
          agentWallet: WALLET,
        }),
      }),
    );

    const body = await jsonBody(res);
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ success: true });

    // Critical: two txs with incrementing nonces
    expect(assignedNonces).toHaveLength(2);
    expect(assignedNonces[0]).toBe(BASE_NONCE); // updateMetrics
    expect(assignedNonces[1]).toBe(BASE_NONCE + 1); // mintVisa
  });

  it("sends only one tx for upgrade when no metrics update needed", async () => {
    mockGetTier.mockResolvedValue(1n);
    mockGetTierThresholds.mockResolvedValue({
      minTransactions: 1000n,
      minVolumeUsd: 5000000000n,
      requiresBoth: false,
      requiresManualReview: false,
    });
    mockGetVisaWallet.mockResolvedValue(WALLET);
    mockGetTransactionCount.mockResolvedValue(0);
    mockCheckTierEligibility.mockResolvedValue(true);

    const { POST } = await import("@/app/api/visa/claim/route");
    const res = await POST(
      makeNextRequest("https://test.com/api/visa/claim", {
        method: "POST",
        body: JSON.stringify({
          chainId: "42220",
          agentId: "12345",
          targetTier: 2,
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(assignedNonces).toHaveLength(1); // only claimTierUpgrade
    expect(assignedNonces[0]).toBe(BASE_NONCE);
    expect(mockUpdateMetrics).not.toHaveBeenCalled();
  });
});
