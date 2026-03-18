import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNextRequest } from "./test-utils";

const mockCheckRateLimit = vi.fn();
const mockDeriveEd25519Address = vi.fn();
const mockComputeEd25519ChallengeHash = vi.fn();
const mockIsValidEd25519PubkeyHex = vi.fn();

const mockHelpers = {
  getNetworkConfig: vi.fn(),
  isValidNetwork: vi.fn(),
  isValidAddress: vi.fn(),
  jsonResponse: vi.fn(),
  errorResponse: vi.fn(),
  corsResponse: vi.fn(),
};

const mockTypedRegistry = vi.fn();
const mockEd25519Nonce = vi.fn();

const mockJsonRpcProvider = vi.fn();
const mockGetAddress = vi.fn();

const VALID_PUBKEY =
  "3b6a27bcceb6a42d62a3a8d02a6f0d73653215771de243a63ac048a18b59da29";

function installMocks() {
  vi.doMock("@/lib/rateLimit", () => ({
    checkRateLimit: mockCheckRateLimit,
  }));

  vi.doMock("@/lib/ed25519", () => ({
    computeEd25519ChallengeHash: mockComputeEd25519ChallengeHash,
    deriveEd25519Address: mockDeriveEd25519Address,
    isValidEd25519PubkeyHex: mockIsValidEd25519PubkeyHex,
  }));

  vi.doMock("@/lib/agent-api-helpers", () => mockHelpers);

  vi.doMock("@/lib/contract-types", () => ({
    typedRegistry: mockTypedRegistry,
  }));

  vi.doMock("ethers", () => ({
    ethers: {
      JsonRpcProvider: mockJsonRpcProvider,
      getAddress: mockGetAddress,
    },
  }));
}

function setDefaultMocks() {
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterMs: 1000,
  });

  mockIsValidEd25519PubkeyHex.mockReturnValue(true);
  mockDeriveEd25519Address.mockReturnValue("0xDerivedAddress");
  mockComputeEd25519ChallengeHash.mockReturnValue("0xchallenge");

  mockHelpers.isValidNetwork.mockReturnValue(true);
  mockHelpers.isValidAddress.mockReturnValue(true);
  mockHelpers.getNetworkConfig.mockReturnValue({
    rpcUrl: "https://rpc.example",
    registryAddress: "0xregistry",
    chainId: 42220,
  });
  mockHelpers.jsonResponse.mockImplementation(
    (data: unknown) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  mockHelpers.errorResponse.mockImplementation(
    (msg: string, status: number) =>
      new Response(JSON.stringify({ error: msg }), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );

  mockJsonRpcProvider.mockImplementation(() => ({ kind: "provider" }));
  mockGetAddress.mockImplementation((addr: string) => addr);

  mockEd25519Nonce.mockResolvedValue(1n);
  mockTypedRegistry.mockReturnValue({
    ed25519Nonce: mockEd25519Nonce,
  });
}

async function loadRoute() {
  vi.resetModules();
  installMocks();
  return import("@/app/api/agent/register/ed25519-challenge/route");
}

describe("ed25519-challenge humanAddress derivation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("derives humanAddress from pubkey when humanAddress is omitted", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/register/ed25519-challenge",
        {
          method: "POST",
          body: JSON.stringify({
            pubkey: VALID_PUBKEY,
            network: "testnet",
          }),
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockDeriveEd25519Address).toHaveBeenCalledWith(VALID_PUBKEY);
    expect(mockGetAddress).toHaveBeenCalledWith("0xDerivedAddress");
  });

  it("uses provided humanAddress and does not call deriveEd25519Address", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/register/ed25519-challenge",
        {
          method: "POST",
          body: JSON.stringify({
            pubkey: VALID_PUBKEY,
            network: "testnet",
            humanAddress: "0xProvidedAddress",
          }),
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockDeriveEd25519Address).not.toHaveBeenCalled();
    expect(mockGetAddress).toHaveBeenCalledWith("0xProvidedAddress");
  });
});
