import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";

const HEADERS = {
  ADDRESS: "x-self-agent-address",
  SIGNATURE: "x-self-agent-signature",
  TIMESTAMP: "x-self-agent-timestamp",
};

const mockVerify = vi.fn();
const mockGetCachedVerifier = vi.fn(() => ({ verify: mockVerify }));
const mockCheckAndRecordReplay = vi.fn();
const mockGetNetwork = vi.fn();

const mockJsonRpcProvider = vi.fn();
const mockContract = vi.fn();
const mockWalletCtor = vi.fn();
const mockZeroPadValue = vi.fn();

const mockSelfAgentSignRequest = vi.fn();

const mockMetaStaticCall = vi.fn();
const mockMetaVerifyAgent = vi.fn();
const mockVerificationCount = vi.fn();
const mockTotalVerifications = vi.fn();

const mockRegistryGetAgentId = vi.fn();
const mockRegistryGetHumanNullifier = vi.fn();
const mockRegistryIsVerifiedAgent = vi.fn();
const mockRegistrySameHuman = vi.fn();

class MockSelfAgent {
  address = "0xdemoagent";

  constructor(_config: Record<string, unknown>) {}

  async signRequest() {
    return mockSelfAgentSignRequest();
  }
}

function installCommonMocks() {
  vi.doMock("@selfxyz/agent-sdk", () => ({
    HEADERS,
    SelfAgent: MockSelfAgent,
  }));

  vi.doMock("@/lib/network", () => ({
    NETWORKS: {
      "celo-sepolia": {},
      "celo-mainnet": {},
    },
    getNetwork: mockGetNetwork,
  }));

  vi.doMock("@/lib/selfVerifier", () => ({
    getCachedVerifier: mockGetCachedVerifier,
  }));

  vi.doMock("@/lib/replayGuard", () => ({
    checkAndRecordReplay: mockCheckAndRecordReplay,
  }));

  vi.doMock("@/lib/constants", () => ({
    AGENT_DEMO_VERIFIER_ABI: [],
    REGISTRY_ABI: [],
  }));

  vi.doMock("ethers", () => {
    return {
      ethers: {
        JsonRpcProvider: mockJsonRpcProvider,
        Wallet: mockWalletCtor,
        Contract: mockContract,
        zeroPadValue: mockZeroPadValue,
      },
    };
  });
}

function setDefaultMocks() {
  mockVerify.mockResolvedValue({
    valid: true,
    agentAddress: "0xcaller",
    agentKey: "0xcallerkey",
    agentId: 1n,
    agentCount: 1n,
    credentials: {
      olderThan: 18n,
      nationality: "US",
      ofac: [true, false, true],
    },
  });

  mockGetCachedVerifier.mockImplementation(() => ({ verify: mockVerify }));
  mockCheckAndRecordReplay.mockResolvedValue({ ok: true });

  mockGetNetwork.mockReturnValue({
    id: "celo-sepolia",
    label: "Sepolia",
    isTestnet: true,
    rpcUrl: "https://rpc.example",
    registryAddress: "0xregistry",
    agentDemoVerifierAddress: "0xagentdemo",
    blockExplorer: "https://explorer.example",
  });

  mockJsonRpcProvider.mockImplementation(() => ({ kind: "provider" }));
  mockWalletCtor.mockImplementation(() => ({ address: "0xrelayer" }));
  mockZeroPadValue.mockImplementation(
    (value: string) => `pad:${value.toLowerCase()}`,
  );

  mockMetaStaticCall.mockResolvedValue(undefined);
  mockMetaVerifyAgent.mockResolvedValue({
    hash: "0xtxhash",
    wait: vi.fn().mockResolvedValue({
      hash: "0xtxhash",
      blockNumber: 777,
      gasUsed: 12345n,
    }),
  });
  Object.assign(mockMetaVerifyAgent, { staticCall: mockMetaStaticCall });
  mockVerificationCount.mockResolvedValue(10n);
  mockTotalVerifications.mockResolvedValue(100n);

  mockRegistryGetAgentId.mockResolvedValue(7n);
  mockRegistryGetHumanNullifier.mockResolvedValue(999n);
  mockRegistryIsVerifiedAgent.mockResolvedValue(true);
  mockRegistrySameHuman.mockResolvedValue(false);

  mockContract.mockImplementation((address: string) => {
    if (address === "0xagentdemo") {
      return {
        metaVerifyAgent: mockMetaVerifyAgent,
        verificationCount: mockVerificationCount,
        totalVerifications: mockTotalVerifications,
      };
    }

    return {
      getAgentId: mockRegistryGetAgentId,
      getHumanNullifier: mockRegistryGetHumanNullifier,
      isVerifiedAgent: mockRegistryIsVerifiedAgent,
      sameHuman: mockRegistrySameHuman,
    };
  });

  mockSelfAgentSignRequest.mockResolvedValue({
    [HEADERS.ADDRESS]: "0xdemoagent",
    [HEADERS.SIGNATURE]: "0xsigned",
    [HEADERS.TIMESTAMP]: "1700000000000",
  });
}

async function loadDemoVerifyRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/demo/verify/route");
}

async function loadDemoChatRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/demo/chat/route");
}

async function loadDemoCensusRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/demo/census/route");
}

async function loadDemoAgentToAgentRoute(withDemoKey = true) {
  vi.resetModules();
  installCommonMocks();
  if (withDemoKey) {
    vi.stubEnv("DEMO_AGENT_PRIVATE_KEY_SEPOLIA", "0xdemokey");
  } else {
    vi.stubEnv("DEMO_AGENT_PRIVATE_KEY_SEPOLIA", "");
    delete process.env.DEMO_AGENT_PRIVATE_KEY_SEPOLIA;
  }
  return import("@/app/api/demo/agent-to-agent/route");
}

async function loadDemoChainVerifyRoute(withRelayer = true) {
  vi.resetModules();
  installCommonMocks();
  if (withRelayer) {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "0xrelayer");
  } else {
    vi.stubEnv("RELAYER_PRIVATE_KEY", "");
    delete process.env.RELAYER_PRIVATE_KEY;
  }
  return import("@/app/api/demo/chain-verify/route");
}

describe("demo verify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("requires signature headers", async () => {
    const { POST } = await loadDemoVerifyRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/verify", {
        method: "POST",
      }),
    );

    expect(res.status).toBe(401);
    expect(await jsonBody(res)).toEqual({
      valid: false,
      error: "Missing agent authentication headers",
    });
  });

  it("returns verifier output and stringifies bigint fields", async () => {
    const { POST } = await loadDemoVerifyRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/verify", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
        body: '{"hello":"world"}',
      }),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      valid: true,
      agentId: "1",
      agentCount: "1",
      verificationCount: 1,
      credentials: {
        olderThan: "18",
        nationality: "US",
      },
    });
  });

  it("returns replay failure for duplicated valid requests", async () => {
    mockCheckAndRecordReplay.mockResolvedValue({
      ok: false,
      error: "Replay detected",
    });
    const { POST } = await loadDemoVerifyRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/verify", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
      }),
    );
    expect(res.status).toBe(409);
    expect(await jsonBody(res)).toEqual({
      valid: false,
      error: "Replay detected",
    });
  });

  it("returns verification result with error field when valid is false", async () => {
    mockVerify.mockResolvedValue({
      valid: false,
      error: "Agent not registered",
      agentAddress: undefined,
      agentKey: undefined,
      agentId: 0n,
      agentCount: 0n,
      credentials: undefined,
    });
    const { POST } = await loadDemoVerifyRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/verify", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
      }),
    );

    // Documents current behavior: returns 200 with valid=false and error field
    expect(res.status).toBe(200);
    const body = await jsonBody<{ valid: boolean; error: string }>(res);
    expect(body.valid).toBe(false);
    expect(body.error).toBe("Agent not registered");
  });
});

describe("demo chat route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => NextResponse.json({ response: "ok" })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rejects invalid JSON payloads", async () => {
    const { POST } = await loadDemoChatRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chat", {
        method: "POST",
        body: "{bad",
      }),
    );
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ error: "Invalid JSON body" });
  });

  it("requires both signature and timestamp if either is present", async () => {
    const { POST } = await loadDemoChatRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chat", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
        },
        body: '{"query":"hello"}',
      }),
    );
    expect(res.status).toBe(401);
    expect(await jsonBody(res)).toEqual({
      error: "Both signature and timestamp headers are required",
    });
  });

  it("forwards unsigned requests as anonymous", async () => {
    const { POST } = await loadDemoChatRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chat", {
        method: "POST",
        body: '{"query":"hello","session_id":"s1"}',
      }),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ response: "ok" });
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://127.0.0.1:8090/agent",
      expect.objectContaining({
        method: "POST",
      }),
    );
  });

  it("forwards signed + verified requests with agentAddress context", async () => {
    const { POST } = await loadDemoChatRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chat", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
        body: '{"query":"hello","session_id":"s1"}',
      }),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ response: "ok" });
    // Should pass the verified agent address (from mock), not "anonymous"
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(
      "http://127.0.0.1:8090/agent",
      expect.objectContaining({
        body: expect.stringContaining("0xcaller"),
      }),
    );
  });

  it("returns 403 when verification fails on signed request", async () => {
    mockVerify.mockResolvedValue({
      valid: false,
      error: "Bad signature",
    });
    const { POST } = await loadDemoChatRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chat", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xbadsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
        body: '{"query":"hello"}',
      }),
    );

    expect(res.status).toBe(403);
    expect(await jsonBody(res)).toEqual({ error: "Bad signature" });
  });

  it("returns 409 when replay is detected on signed request", async () => {
    mockCheckAndRecordReplay.mockResolvedValue({
      ok: false,
      error: "Replay detected",
    });
    const { POST } = await loadDemoChatRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chat", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
        body: '{"query":"hello"}',
      }),
    );

    expect(res.status).toBe(409);
    expect(await jsonBody(res)).toEqual({ error: "Replay detected" });
  });

  it("returns 503 when upstream fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const { POST } = await loadDemoChatRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chat", {
        method: "POST",
        body: '{"query":"hello"}',
      }),
    );

    expect(res.status).toBe(503);
    expect(await jsonBody(res)).toEqual({
      error: "LangChain service unavailable",
    });
  });
});

describe("demo census route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("rejects unverified requests", async () => {
    mockVerify.mockResolvedValue({
      valid: false,
      error: "Bad signature",
    });
    const { POST } = await loadDemoCensusRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/census", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
      }),
    );
    expect(res.status).toBe(403);
    expect(await jsonBody(res)).toEqual({ error: "Bad signature" });
  });

  it("records verified submissions and returns aggregate stats", async () => {
    const { POST, GET } = await loadDemoCensusRoute();

    const postRes = await POST(
      makeNextRequest("https://example.com/api/demo/census", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
      }),
    );
    expect(postRes.status).toBe(200);
    expect(await jsonBody(postRes)).toMatchObject({
      recorded: true,
      totalAgents: 1,
    });

    const getRes = await GET(
      makeNextRequest("https://example.com/api/demo/census", {
        method: "GET",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
      }),
    );
    expect(getRes.status).toBe(200);
    expect(await jsonBody(getRes)).toMatchObject({
      totalAgents: 1,
      verifiedOver18: 1,
    });
  });
});

describe("demo agent-to-agent route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 500 when demo agent key is missing", async () => {
    const { POST } = await loadDemoAgentToAgentRoute(false);
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/agent-to-agent", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(500);
    expect((await jsonBody<{ error: string }>(res)).error).toContain(
      "Demo agent not configured",
    );
  });

  it("requires auth headers and blocks replayed requests", async () => {
    const { POST } = await loadDemoAgentToAgentRoute(true);

    const missing = await POST(
      makeNextRequest("https://example.com/api/demo/agent-to-agent", {
        method: "POST",
      }),
    );
    expect(missing.status).toBe(401);

    mockCheckAndRecordReplay.mockResolvedValue({
      ok: false,
      error: "Replay detected",
    });
    const replay = await POST(
      makeNextRequest("https://example.com/api/demo/agent-to-agent", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
      }),
    );
    expect(replay.status).toBe(409);
  });

  it("returns signed demo response payload for verified callers", async () => {
    mockRegistryGetAgentId
      .mockResolvedValueOnce(21n)
      .mockResolvedValueOnce(22n);
    mockRegistrySameHuman.mockResolvedValue(true);
    const { POST } = await loadDemoAgentToAgentRoute(true);
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/agent-to-agent", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
        body: '{"ping":"pong"}',
      }),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get(HEADERS.SIGNATURE)).toBe("0xsigned");
    expect(await jsonBody(res)).toMatchObject({
      verified: true,
      sameHuman: true,
      uniqueAgents: 1,
    });
  });
});

describe("demo chain-verify route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 503 when relayer is not configured", async () => {
    const { POST } = await loadDemoChainVerifyRoute(false);
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chain-verify", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(503);
    expect(await jsonBody(res)).toEqual({ error: "Relayer not configured" });
  });

  it("validates headers and payload shape", async () => {
    const { POST } = await loadDemoChainVerifyRoute(true);
    const missingHeaders = await POST(
      makeNextRequest("https://example.com/api/demo/chain-verify", {
        method: "POST",
      }),
    );
    expect(missingHeaders.status).toBe(401);

    const invalidBody = await POST(
      makeNextRequest("https://example.com/api/demo/chain-verify", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
        body: '{"bad":true}',
      }),
    );
    expect(invalidBody.status).toBe(400);
  });

  it("maps simulation revert reasons to user-friendly errors", async () => {
    mockMetaStaticCall.mockRejectedValue(
      new Error("execution reverted: NotVerifiedAgent"),
    );
    const { POST } = await loadDemoChainVerifyRoute(true);
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chain-verify", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
        body: JSON.stringify({
          agentKey: "0xagentkey",
          nonce: "1",
          deadline: Date.now() + 10_000,
          eip712Signature: "0xeipsig",
        }),
      }),
    );
    expect(res.status).toBe(400);
    expect((await jsonBody<{ error: string }>(res)).error).toContain(
      "agent not verified",
    );
  });

  it("relays valid meta-transactions and returns tx metadata", async () => {
    const { POST } = await loadDemoChainVerifyRoute(true);
    const res = await POST(
      makeNextRequest("https://example.com/api/demo/chain-verify", {
        method: "POST",
        headers: {
          [HEADERS.SIGNATURE]: "0xsig",
          [HEADERS.TIMESTAMP]: "1700000000000",
        },
        body: JSON.stringify({
          agentKey: "0xagentkey",
          nonce: "1",
          deadline: Date.now() + 10_000,
          eip712Signature: "0xeipsig",
          networkId: "celo-sepolia",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toMatchObject({
      txHash: "0xtxhash",
      blockNumber: 777,
      verificationCount: "10",
      totalVerifications: "100",
      rateLimitRemaining: 2,
    });
  });
});
