import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";

const mockCorsResponse = vi.fn();
const mockErrorResponse = vi.fn();
const mockValidateAgentId = vi.fn();
const mockGetProviderLabel = vi.fn();

const mockJsonRpcProvider = vi.fn();
const mockContract = vi.fn();
const mockIsAddress = vi.fn();
const mockGetAddress = vi.fn();
const mockZeroPadValue = vi.fn();

const mockChainConfig = {
  "42220": {
    rpc: "https://rpc.example",
    registry: "0xregistry",
  },
};

function installCommonMocks() {
  vi.doMock("@/lib/chain-config", () => ({
    CHAIN_CONFIG: mockChainConfig,
  }));

  vi.doMock("@/lib/api-helpers", () => ({
    CORS_HEADERS: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
    corsResponse: mockCorsResponse,
    errorResponse: mockErrorResponse,
    validateAgentId: mockValidateAgentId,
  }));

  vi.doMock("@selfxyz/agent-sdk", () => ({
    REGISTRY_ABI: [],
    PROVIDER_ABI: [],
    getProviderLabel: mockGetProviderLabel,
  }));

  vi.doMock("ethers", () => ({
    ethers: {
      JsonRpcProvider: mockJsonRpcProvider,
      Contract: mockContract,
      isAddress: mockIsAddress,
      getAddress: mockGetAddress,
      zeroPadValue: mockZeroPadValue,
      ZeroHash:
        "0x0000000000000000000000000000000000000000000000000000000000000000",
      ZeroAddress: "0x0000000000000000000000000000000000000000",
    },
  }));

  vi.doMock("@/lib/contract-types", () => ({
    typedRegistry: (_addr: string, _runner: unknown) => mockContract(),
    typedProvider: (_addr: string, _runner: unknown) => mockContract(),
    typedDemoVerifier: (_addr: string, _runner: unknown) => mockContract(),
    typedGate: (_addr: string, _runner: unknown) => mockContract(),
  }));
}

function setDefaultMocks() {
  mockCorsResponse.mockImplementation(
    () => new NextResponse(null, { status: 204 }),
  );
  mockErrorResponse.mockImplementation((message: string, status: number) =>
    NextResponse.json({ error: message }, { status }),
  );
  mockValidateAgentId.mockImplementation((value: string) => {
    try {
      const n = BigInt(value);
      return n > 0n ? n : null;
    } catch {
      return null;
    }
  });
  mockGetProviderLabel.mockImplementation(
    (strength: number) => `label-${strength}`,
  );

  mockJsonRpcProvider.mockImplementation(() => ({ kind: "provider" }));
  mockContract.mockReset();

  mockIsAddress.mockReturnValue(true);
  mockGetAddress.mockImplementation((value: string) => value.toLowerCase());
  mockZeroPadValue.mockImplementation(
    (value: string) => `pad:${value.toLowerCase()}`,
  );
}

async function loadInfoRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/info/[chainId]/[agentId]/route");
}

async function loadAgentsRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/agents/[chainId]/[address]/route");
}

async function loadVerifyRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/verify/[chainId]/[agentId]/route");
}

async function loadReputationRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/reputation/[chainId]/[agentId]/route");
}

async function loadCardsRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/cards/[chainId]/[agentId]/route");
}

async function loadVerifyStatusRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/verify-status/[chainId]/[agentId]/route");
}

describe("agent info route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("returns 400 for unsupported chain or invalid IDs", async () => {
    const { GET } = await loadInfoRoute();
    const unsupported = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "999", agentId: "1" }),
    });
    expect(unsupported.status).toBe(400);

    const invalid = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "0" }),
    });
    expect(invalid.status).toBe(400);
  });

  it("returns 404 when agent key is zero hash", async () => {
    mockContract.mockImplementationOnce(() => ({
      agentIdToAgentKey: vi
        .fn()
        .mockResolvedValue(
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        ),
      hasHumanProof: vi.fn(),
      getProofProvider: vi.fn(),
      agentRegisteredAt: vi.fn(),
      getAgentCredentials: vi.fn(),
    }));

    const { GET } = await loadInfoRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "11" }),
    });
    expect(res.status).toBe(404);
    expect(await jsonBody(res)).toEqual({ error: "Agent not found" });
  });

  it("returns on-chain info for a verified agent", async () => {
    mockContract
      .mockImplementationOnce(() => ({
        agentIdToAgentKey: vi
          .fn()
          .mockResolvedValue(
            "0x0000000000000000000000001111111111111111111111111111111111111111",
          ),
        hasHumanProof: vi.fn().mockResolvedValue(true),
        getProofProvider: vi.fn().mockResolvedValue("0xprovider"),
        agentRegisteredAt: vi.fn().mockResolvedValue(1234n),
        getAgentCredentials: vi.fn().mockResolvedValue({
          nationality: "US",
          olderThan: 21n,
          ofac: [true, false, true],
        }),
      }))
      .mockImplementationOnce(() => ({
        verificationStrength: vi.fn().mockResolvedValue(3),
      }));

    const { GET } = await loadInfoRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "11" }),
    });
    const body = await jsonBody<{
      isVerified: boolean;
      verificationStrength: number;
      credentials: { nationality: string; olderThan: number };
    }>(res);

    expect(res.status).toBe(200);
    expect(body.isVerified).toBe(true);
    expect(body.verificationStrength).toBe(3);
    expect(body.credentials.nationality).toBe("US");
    expect(body.credentials.olderThan).toBe(21);
  });

  it("returns OPTIONS preflight response", async () => {
    const { OPTIONS } = await loadInfoRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("agents-by-human route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("validates address and returns empty list when no direct registration exists", async () => {
    mockContract.mockImplementationOnce(() => ({
      getAgentId: vi.fn().mockResolvedValue(0n),
    }));
    const { GET } = await loadAgentsRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", address: "0xabc" }),
    });

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      humanAddress: "0xabc",
      chainId: 42220,
      agents: [],
      totalCount: 0,
    });
  });

  it("returns agent info and total count for verified addresses", async () => {
    mockContract.mockImplementationOnce(() => ({
      getAgentId: vi.fn().mockResolvedValue(12n),
      hasHumanProof: vi.fn().mockResolvedValue(true),
      getHumanNullifier: vi.fn().mockResolvedValue(99n),
      getAgentCountForHuman: vi.fn().mockResolvedValue(2n),
    }));

    const { GET } = await loadAgentsRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", address: "0xAbC" }),
    });
    const body = await jsonBody<{
      totalCount: number;
      agents: Array<{ agentId: number }>;
    }>(res);

    expect(res.status).toBe(200);
    expect(body.totalCount).toBe(2);
    expect(body.agents[0]?.agentId).toBe(12);
  });

  it("returns OPTIONS preflight response", async () => {
    const { OPTIONS } = await loadAgentsRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("agent verify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("returns unverified payload when agent has no human proof", async () => {
    mockContract.mockImplementationOnce(() => ({
      hasHumanProof: vi.fn().mockResolvedValue(false),
      getProofProvider: vi.fn().mockResolvedValue("0x0"),
      getHumanNullifier: vi.fn().mockResolvedValue(0n),
      selfProofProvider: vi.fn().mockResolvedValue("0xself"),
    }));

    const { GET } = await loadVerifyRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({ isVerified: false });
  });

  it("returns provider strength and self-provider status when verified", async () => {
    mockContract
      .mockImplementationOnce(() => ({
        hasHumanProof: vi.fn().mockResolvedValue(true),
        getProofProvider: vi.fn().mockResolvedValue("0xprovider"),
        getHumanNullifier: vi.fn().mockResolvedValue(7n),
        selfProofProvider: vi.fn().mockResolvedValue("0xprovider"),
        getAgentCountForHuman: vi.fn().mockResolvedValue(3n),
      }))
      .mockImplementationOnce(() => ({
        verificationStrength: vi.fn().mockResolvedValue(5),
      }));

    const { GET } = await loadVerifyRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      isVerified: true,
      isSelfProvider: true,
      verificationStrength: 5,
      agentCountForHuman: 3,
    });
  });

  it("returns OPTIONS preflight response", async () => {
    const { OPTIONS } = await loadVerifyRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("reputation route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("returns zero score when no proof exists", async () => {
    mockContract.mockImplementationOnce(() => ({
      hasHumanProof: vi.fn().mockResolvedValue(false),
    }));
    const { GET } = await loadReputationRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "1" }),
    });
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ score: 0, hasProof: false });
  });

  it("returns provider reputation details for verified agents", async () => {
    mockContract
      .mockImplementationOnce(() => ({
        hasHumanProof: vi.fn().mockResolvedValue(true),
        getProofProvider: vi.fn().mockResolvedValue("0xprovider"),
      }))
      .mockImplementationOnce(() => ({
        verificationStrength: vi.fn().mockResolvedValue(4),
        providerName: vi.fn().mockResolvedValue("Self"),
      }));

    const { GET } = await loadReputationRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "1" }),
    });

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      score: 4,
      hasProof: true,
      providerName: "Self",
      proofType: "label-4",
    });
  });

  it("returns OPTIONS preflight response", async () => {
    const { OPTIONS } = await loadReputationRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("cards route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("returns 404 for empty metadata and parsed card JSON when present", async () => {
    mockContract.mockImplementationOnce(() => ({
      getAgentMetadata: vi.fn().mockResolvedValue(""),
    }));

    const { GET } = await loadCardsRoute();
    const empty = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "1" }),
    });
    expect(empty.status).toBe(404);

    mockContract.mockImplementationOnce(() => ({
      getAgentMetadata: vi.fn().mockResolvedValue('{"title":"Agent Alpha"}'),
    }));
    const found = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "1" }),
    });
    expect(found.status).toBe(200);
    expect(await jsonBody(found)).toEqual({ title: "Agent Alpha" });
  });

  it("returns OPTIONS preflight response", async () => {
    const { OPTIONS } = await loadCardsRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("verify-status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("returns verified=false when no proof exists", async () => {
    mockContract.mockImplementationOnce(() => ({
      hasHumanProof: vi.fn().mockResolvedValue(false),
      getProofProvider: vi.fn().mockResolvedValue("0x0"),
      agentRegisteredAt: vi.fn().mockResolvedValue(0n),
    }));

    const { GET } = await loadVerifyStatusRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "1" }),
    });

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ verified: false });
  });

  it("returns proof metadata for verified agents", async () => {
    mockContract
      .mockImplementationOnce(() => ({
        hasHumanProof: vi.fn().mockResolvedValue(true),
        getProofProvider: vi.fn().mockResolvedValue("0xprovider"),
        agentRegisteredAt: vi.fn().mockResolvedValue(555n),
      }))
      .mockImplementationOnce(() => ({
        verificationStrength: vi.fn().mockResolvedValue(2),
      }));

    const { GET } = await loadVerifyStatusRoute();
    const res = await GET(makeNextRequest("https://example.com"), {
      params: Promise.resolve({ chainId: "42220", agentId: "1" }),
    });

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      verified: true,
      proofType: "label-2",
      registeredAtBlock: "555",
      providerAddress: "0xprovider",
    });
  });

  it("returns OPTIONS preflight response", async () => {
    const { OPTIONS } = await loadVerifyStatusRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});
