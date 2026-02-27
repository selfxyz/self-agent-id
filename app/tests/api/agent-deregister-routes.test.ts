import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";

const mockCheckRateLimit = vi.fn();
const mockBuildSimpleDeregisterUserDataAscii = vi.fn();
const mockBuildAdvancedDeregisterUserDataAscii = vi.fn();
const mockGetRegistrationConfigIndex = vi.fn();
const mockCreateSessionToken = vi.fn();
const mockEncryptSession = vi.fn();
const mockGetUniversalLink = vi.fn();

const mockHelpers = {
  decryptAndValidateSession: vi.fn(),
  sessionResponse: vi.fn(),
  humanInstructions: vi.fn(),
  errorResponse: vi.fn(),
  corsResponse: vi.fn(),
  jsonResponse: vi.fn(),
  getSessionSecret: vi.fn(),
  getNetworkConfig: vi.fn(),
  isValidNetwork: vi.fn(),
  isValidAddress: vi.fn(),
  checkAgentOnChain: vi.fn(),
};

const mockGetAddress = vi.fn();
const mockZeroPadValue = vi.fn();
const mockJsonRpcProvider = vi.fn();
const mockContract = vi.fn();

class MockSelfAppBuilder {
  private readonly args: Record<string, unknown>;

  constructor(args: Record<string, unknown>) {
    this.args = args;
  }

  build() {
    return {
      kind: "self-app",
      userId: this.args.userId,
      userDefinedData: this.args.userDefinedData,
    };
  }
}

function installCommonMocks() {
  vi.doMock("@/lib/rateLimit", () => ({
    checkRateLimit: mockCheckRateLimit,
  }));

  vi.doMock("@selfxyz/agent-sdk", () => ({
    buildSimpleDeregisterUserDataAscii: mockBuildSimpleDeregisterUserDataAscii,
    buildAdvancedDeregisterUserDataAscii:
      mockBuildAdvancedDeregisterUserDataAscii,
    getRegistrationConfigIndex: mockGetRegistrationConfigIndex,
    REGISTRY_ABI: [],
  }));

  vi.doMock("@selfxyz/qrcode", () => ({
    SelfAppBuilder: MockSelfAppBuilder,
    getUniversalLink: mockGetUniversalLink,
  }));

  vi.doMock("@/lib/session-token", () => ({
    createSessionToken: mockCreateSessionToken,
    encryptSession: mockEncryptSession,
  }));

  vi.doMock("@/lib/agent-api-helpers", () => mockHelpers);

  vi.doMock("ethers", () => ({
    ethers: {
      getAddress: mockGetAddress,
      zeroPadValue: mockZeroPadValue,
      JsonRpcProvider: mockJsonRpcProvider,
      Contract: mockContract,
    },
  }));
}

function setDefaultMocks() {
  mockCheckRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 9,
    retryAfterMs: 1000,
  });
  mockBuildSimpleDeregisterUserDataAscii.mockReturnValue("simple-deregister");
  mockBuildAdvancedDeregisterUserDataAscii.mockReturnValue(
    "advanced-deregister",
  );
  mockGetRegistrationConfigIndex.mockReturnValue(4);
  mockCreateSessionToken.mockReturnValue({
    data: {
      id: "session-2",
      type: "deregister",
      stage: "pending",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  });
  mockEncryptSession.mockReturnValue("enc-deregister");
  mockGetUniversalLink.mockReturnValue("self://deregister");

  mockHelpers.decryptAndValidateSession.mockReturnValue({
    session: { type: "deregister", stage: "pending" },
    secret: "session-secret",
  });
  mockHelpers.sessionResponse.mockImplementation(
    (_session: unknown, _secret: string, extra: Record<string, unknown>) =>
      NextResponse.json({ sessionToken: "rotated", ...extra }, { status: 200 }),
  );
  mockHelpers.humanInstructions.mockImplementation((stage: string) => [
    `instruction:${stage}`,
  ]);
  mockHelpers.errorResponse.mockImplementation(
    (message: string, status: number) =>
      NextResponse.json({ error: message }, { status }),
  );
  mockHelpers.corsResponse.mockImplementation(
    () => new NextResponse(null, { status: 204 }),
  );
  mockHelpers.jsonResponse.mockImplementation(
    (body: Record<string, unknown>, status = 200) =>
      NextResponse.json(body, { status }),
  );
  mockHelpers.getSessionSecret.mockReturnValue("session-secret");
  mockHelpers.getNetworkConfig.mockReturnValue({
    rpcUrl: "https://rpc.example",
    registryAddress: "0xregistry",
    selfEndpointType: "staging_celo",
  });
  mockHelpers.isValidNetwork.mockReturnValue(true);
  mockHelpers.isValidAddress.mockReturnValue(true);
  mockHelpers.checkAgentOnChain.mockResolvedValue({
    isVerified: true,
    agentId: 21n,
  });

  mockGetAddress.mockImplementation((value: string) => value.toLowerCase());
  mockZeroPadValue.mockImplementation(
    (value: string) => `pad:${value.toLowerCase()}`,
  );
  mockJsonRpcProvider.mockImplementation(() => ({ kind: "provider" }));
  mockContract.mockImplementation(() => ({
    ownerOf: vi
      .fn()
      .mockResolvedValue("0x00000000000000000000000000000000000000ab"),
  }));
}

async function loadDeregisterRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/deregister/route");
}

async function loadDeregisterCallbackRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/deregister/callback/route");
}

async function loadDeregisterStatusRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/deregister/status/route");
}

describe("agent deregister init route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("returns 429 when deregistration is rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 1000,
    });
    const { POST } = await loadDeregisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/deregister", {
        method: "POST",
        body: JSON.stringify({ network: "testnet", agentAddress: "0xabc" }),
      }),
    );
    expect(res.status).toBe(429);
    expect(await jsonBody(res)).toEqual({ error: "Too many requests" });
  });

  it("validates network, address and disclosures", async () => {
    const { POST } = await loadDeregisterRoute();

    mockHelpers.isValidNetwork.mockReturnValue(false);
    const badNetwork = await POST(
      makeNextRequest("https://example.com/api/agent/deregister", {
        method: "POST",
        body: JSON.stringify({ network: "bad", agentAddress: "0xabc" }),
      }),
    );
    expect(badNetwork.status).toBe(400);

    mockHelpers.isValidNetwork.mockReturnValue(true);
    mockHelpers.isValidAddress.mockReturnValue(false);
    const badAddress = await POST(
      makeNextRequest("https://example.com/api/agent/deregister", {
        method: "POST",
        body: JSON.stringify({ network: "testnet", agentAddress: "bad" }),
      }),
    );
    expect(badAddress.status).toBe(400);

    mockHelpers.isValidAddress.mockReturnValue(true);
    const badAge = await POST(
      makeNextRequest("https://example.com/api/agent/deregister", {
        method: "POST",
        body: JSON.stringify({
          network: "testnet",
          agentAddress: "0xabc",
          disclosures: { minimumAge: 30 },
        }),
      }),
    );
    expect(badAge.status).toBe(400);
    expect(await jsonBody(badAge)).toEqual({
      error: "minimumAge must be 0, 18, or 21",
    });
  });

  it("returns 404 when the agent is not currently on-chain", async () => {
    mockHelpers.checkAgentOnChain.mockResolvedValue({
      isVerified: false,
      agentId: 0n,
    });
    const { POST } = await loadDeregisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/deregister", {
        method: "POST",
        body: JSON.stringify({ network: "testnet", agentAddress: "0xabc" }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await jsonBody(res)).toEqual({
      error: "Agent is not currently registered on-chain",
    });
  });

  it("creates a simple-mode deregistration session when owner matches agent", async () => {
    mockContract.mockImplementation(() => ({
      ownerOf: vi.fn().mockResolvedValue("0xabc"),
    }));
    const { POST } = await loadDeregisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/deregister", {
        method: "POST",
        body: JSON.stringify({
          network: "testnet",
          agentAddress: "0xabc",
          disclosures: { minimumAge: 18 },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockBuildSimpleDeregisterUserDataAscii).toHaveBeenCalledWith({
      minimumAge: 18,
      ofac: false,
    });
    expect(await jsonBody<{ sessionToken: string }>(res)).toMatchObject({
      sessionToken: "enc-deregister",
      stage: "qr-ready",
    });
  });

  it("creates an advanced-mode deregistration session when owner differs", async () => {
    mockContract.mockImplementation(() => ({
      ownerOf: vi.fn().mockResolvedValue("0xowner"),
    }));
    const { POST } = await loadDeregisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/deregister", {
        method: "POST",
        body: JSON.stringify({
          network: "testnet",
          agentAddress: "0xabc",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockBuildAdvancedDeregisterUserDataAscii).toHaveBeenCalledWith({
      agentAddress: "0xabc",
      disclosures: { minimumAge: 0, ofac: false },
    });
  });

  it("returns preflight response for OPTIONS", async () => {
    const { OPTIONS } = await loadDeregisterRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("agent deregister callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("requires token and supports failed/success callback payloads", async () => {
    const { POST } = await loadDeregisterCallbackRoute();
    const missingToken = await POST(
      makeNextRequest("https://example.com/api/agent/deregister/callback", {
        method: "POST",
      }),
    );
    expect(missingToken.status).toBe(400);

    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "deregister",
        stage: "pending",
        agentAddress: "0xabc",
        agentId: 1,
      },
      secret: "session-secret",
    });
    const failed = await POST(
      makeNextRequest(
        "https://example.com/api/agent/deregister/callback?token=t",
        {
          method: "POST",
          body: JSON.stringify({ error: "rejected" }),
        },
      ),
    );
    expect(failed.status).toBe(200);
    expect(mockHelpers.sessionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "failed" }),
      "session-secret",
      expect.objectContaining({ error: "rejected" }),
    );

    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "deregister",
        stage: "pending",
        agentAddress: "0xabc",
        agentId: 1,
      },
      secret: "session-secret",
    });
    const success = await POST(
      makeNextRequest(
        "https://example.com/api/agent/deregister/callback?token=t",
        {
          method: "POST",
          body: JSON.stringify({ proof: "ok" }),
        },
      ),
    );
    expect(success.status).toBe(200);
    expect(mockHelpers.sessionResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "proof-received",
        proof: { proof: "ok" },
      }),
      "session-secret",
      expect.objectContaining({ agentAddress: "0xabc" }),
    );
  });

  // SECURITY_GAP: Finding #6 — callback does not validate session type matches endpoint
  it("rejects token with wrong session type (register on deregister endpoint)", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: { type: "register", stage: "pending" },
      secret: "session-secret",
    });
    const { POST } = await loadDeregisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/deregister/callback?token=t",
        {
          method: "POST",
          body: JSON.stringify({ proof: "ok" }),
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Token is not for a deregistration session",
    });
  });

  it("short-circuits with 200 for already-completed session", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "deregister",
        stage: "completed",
        agentAddress: "0xdone",
        agentId: 88,
      },
      secret: "session-secret",
    });
    const { POST } = await loadDeregisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/deregister/callback?token=t",
        {
          method: "POST",
          body: JSON.stringify({ proof: "ok" }),
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockHelpers.sessionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "completed" }),
      "session-secret",
      expect.objectContaining({ agentAddress: "0xdone", agentId: 88 }),
    );
  });

  it("returns 400 for empty callback body", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "deregister",
        stage: "pending",
        agentAddress: "0xabc",
        agentId: 1,
      },
      secret: "session-secret",
    });
    const { POST } = await loadDeregisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/deregister/callback?token=t",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ error: "Empty callback payload" });
  });

  it("returns 410 for expired session", async () => {
    mockHelpers.decryptAndValidateSession.mockImplementation(() => {
      throw new Error("token expired");
    });
    const { POST } = await loadDeregisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/deregister/callback?token=t",
        {
          method: "POST",
        },
      ),
    );

    expect(res.status).toBe(410);
    expect(await jsonBody(res)).toEqual({ error: "Session expired" });
  });

  it("returns 204 for OPTIONS", async () => {
    const { OPTIONS } = await loadDeregisterCallbackRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("agent deregister status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("returns completed when agent is no longer verified", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "deregister",
        stage: "proof-received",
        network: "testnet",
        agentAddress: "0xabc",
        agentId: 11,
      },
      secret: "session-secret",
    });
    mockHelpers.checkAgentOnChain.mockResolvedValue({
      isVerified: false,
      agentId: 11n,
    });
    const { GET } = await loadDeregisterStatusRoute();
    const res = await GET(
      makeNextRequest(
        "https://example.com/api/agent/deregister/status?token=t",
        { method: "GET" },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockHelpers.sessionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "completed" }),
      "session-secret",
      expect.objectContaining({ agentAddress: "0xabc", agentId: 11 }),
    );
  });

  it("returns current stage while deregistration is still pending", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "deregister",
        stage: "qr-ready",
        network: "testnet",
        agentAddress: "0xabc",
        agentId: 11,
      },
      secret: "session-secret",
    });
    mockHelpers.checkAgentOnChain.mockResolvedValue({
      isVerified: true,
      agentId: 11n,
    });
    const { GET } = await loadDeregisterStatusRoute();
    const res = await GET(
      makeNextRequest(
        "https://example.com/api/agent/deregister/status?token=t",
        { method: "GET" },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockHelpers.sessionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "qr-ready" }),
      "session-secret",
      expect.objectContaining({ agentAddress: "0xabc", agentId: 11 }),
    );
  });

  it("returns 204 for OPTIONS", async () => {
    const { OPTIONS } = await loadDeregisterStatusRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});
