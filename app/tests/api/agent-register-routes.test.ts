import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";

const mockCheckRateLimit = vi.fn();
const mockBuildSimpleRegisterUserDataAscii = vi.fn();
const mockBuildAdvancedRegisterUserDataAscii = vi.fn();
const mockBuildWalletFreeRegisterUserDataAscii = vi.fn();
const mockSignRegistrationChallenge = vi.fn();
const mockGetRegistrationConfigIndex = vi.fn();
const mockGetUniversalLink = vi.fn();
const mockCreateSessionToken = vi.fn();
const mockEncryptSession = vi.fn();

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
  readSessionTokenFromRequest: vi.fn(),
};

const mockCreateRandom = vi.fn();
const mockGetAddress = vi.fn();
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
      endpoint: this.args.endpoint,
    };
  }
}

function installCommonMocks() {
  vi.doMock("@/lib/rateLimit", () => ({
    checkRateLimit: mockCheckRateLimit,
  }));

  vi.doMock("@selfxyz/agent-sdk", () => ({
    buildSimpleRegisterUserDataAscii: mockBuildSimpleRegisterUserDataAscii,
    buildAdvancedRegisterUserDataAscii: mockBuildAdvancedRegisterUserDataAscii,
    buildWalletFreeRegisterUserDataAscii:
      mockBuildWalletFreeRegisterUserDataAscii,
    signRegistrationChallenge: mockSignRegistrationChallenge,
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
      Wallet: {
        createRandom: mockCreateRandom,
      },
      getAddress: mockGetAddress,
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
  mockBuildSimpleRegisterUserDataAscii.mockReturnValue("simple-user-data");
  mockBuildAdvancedRegisterUserDataAscii.mockReturnValue("advanced-user-data");
  mockBuildWalletFreeRegisterUserDataAscii.mockReturnValue(
    "walletfree-user-data",
  );
  mockSignRegistrationChallenge.mockResolvedValue("signed-challenge");
  mockGetRegistrationConfigIndex.mockReturnValue(3);
  mockGetUniversalLink.mockReturnValue("self://deep-link");
  mockCreateSessionToken.mockReturnValue({
    data: {
      id: "session-1",
      type: "register",
      stage: "pending",
      expiresAt: "2099-01-01T00:00:00.000Z",
    },
  });
  mockEncryptSession.mockReturnValue("encrypted-session-token");

  mockHelpers.decryptAndValidateSession.mockReturnValue({
    session: { type: "register", stage: "pending" },
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
    chainId: 11142220,
    registryAddress: "0xregistry",
    selfEndpointType: "staging_celo",
    rpcUrl: "https://rpc.example",
  });
  mockHelpers.isValidNetwork.mockReturnValue(true);
  mockHelpers.isValidAddress.mockReturnValue(true);
  mockHelpers.checkAgentOnChain.mockResolvedValue({
    isVerified: false,
    agentId: 0n,
  });
  mockHelpers.readSessionTokenFromRequest.mockImplementation((req: any) => {
    const auth = req?.headers?.get?.("authorization");
    if (auth === "Bearer t") return { token: "t" };
    return {
      error:
        "Missing session token. Provide Authorization: Bearer <sessionToken>.",
    };
  });

  mockCreateRandom.mockReturnValue({
    privateKey: "0xagentprivatekey",
    address: "0x00000000000000000000000000000000000000AA",
  });
  mockGetAddress.mockImplementation((value: string) => value.toLowerCase());
  mockJsonRpcProvider.mockImplementation(() => ({ kind: "provider" }));
  mockContract.mockImplementation(() => ({
    getAgentCredentials: vi.fn().mockResolvedValue({
      nationality: "FR",
      issuingState: "FR",
      olderThan: 21n,
      ofac: [true, false, true],
      dateOfBirth: "1990-01-01",
      gender: "M",
      expiryDate: "2030-01-01",
    }),
  }));
}

async function loadRegisterRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/register/route");
}

async function loadRegisterCallbackRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/register/callback/route");
}

async function loadRegisterStatusRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/register/status/route");
}

async function loadRegisterQrRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/register/qr/route");
}

async function loadRegisterExportRoute() {
  vi.resetModules();
  installCommonMocks();
  return import("@/app/api/agent/register/export/route");
}

describe("agent register init route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("returns 429 when registration is rate limited", async () => {
    mockCheckRateLimit.mockResolvedValue({
      allowed: false,
      remaining: 0,
      retryAfterMs: 5000,
    });
    const { POST } = await loadRegisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register", {
        method: "POST",
        body: JSON.stringify({
          mode: "simple",
          network: "testnet",
          humanAddress: "0xabc",
        }),
      }),
    );

    expect(res.status).toBe(429);
    expect(await jsonBody(res)).toEqual({ error: "Too many requests" });
  });

  it("validates mode and network inputs", async () => {
    const { POST } = await loadRegisterRoute();

    const invalidMode = await POST(
      makeNextRequest("https://example.com/api/agent/register", {
        method: "POST",
        body: JSON.stringify({ mode: "bad-mode", network: "testnet" }),
      }),
    );
    expect(invalidMode.status).toBe(400);
    expect((await jsonBody<{ error: string }>(invalidMode)).error).toContain(
      "Invalid mode",
    );

    mockHelpers.isValidNetwork.mockReturnValue(false);
    const invalidNetwork = await POST(
      makeNextRequest("https://example.com/api/agent/register", {
        method: "POST",
        body: JSON.stringify({
          mode: "simple",
          network: "badnet",
          humanAddress: "0xabc",
        }),
      }),
    );
    expect(invalidNetwork.status).toBe(400);
    expect((await jsonBody<{ error: string }>(invalidNetwork)).error).toContain(
      "Invalid network",
    );
  });

  it("requires humanAddress for simple mode", async () => {
    mockHelpers.isValidAddress.mockReturnValue(false);
    const { POST } = await loadRegisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register", {
        method: "POST",
        body: JSON.stringify({
          mode: "simple",
          network: "testnet",
          humanAddress: "not-an-address",
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error:
        "humanAddress is required and must be a valid Ethereum address for this mode",
    });
  });

  it("rejects unsupported minimumAge values", async () => {
    const { POST } = await loadRegisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register", {
        method: "POST",
        body: JSON.stringify({
          mode: "simple",
          network: "testnet",
          humanAddress: "0xabc",
          disclosures: { minimumAge: 25 },
        }),
      }),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "minimumAge must be 0, 18, or 21",
    });
  });

  it("creates a simple mode registration session", async () => {
    const { POST } = await loadRegisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register", {
        method: "POST",
        body: JSON.stringify({
          mode: "verified-wallet",
          network: "testnet",
          humanAddress: "0x00000000000000000000000000000000000000FF",
          disclosures: { minimumAge: 18, ofac: true },
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockBuildSimpleRegisterUserDataAscii).toHaveBeenCalledWith({
      minimumAge: 18,
      ofac: true,
    });
    expect(
      await jsonBody<{ mode: string; sessionToken: string }>(res),
    ).toMatchObject({
      mode: "simple",
      sessionToken: "encrypted-session-token",
    });
  });

  it("creates an agent-identity registration with signed challenge", async () => {
    const { POST } = await loadRegisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register", {
        method: "POST",
        body: JSON.stringify({
          mode: "agent-identity",
          network: "testnet",
          humanAddress: "0x00000000000000000000000000000000000000FA",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockSignRegistrationChallenge).toHaveBeenCalledWith(
      "0xagentprivatekey",
      {
        humanIdentifier: "0x00000000000000000000000000000000000000fa",
        chainId: 11142220,
        registryAddress: "0xregistry",
      },
    );
    expect(mockBuildAdvancedRegisterUserDataAscii).toHaveBeenCalled();
  });

  it("creates a wallet-free registration", async () => {
    const { POST } = await loadRegisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register", {
        method: "POST",
        body: JSON.stringify({
          mode: "wallet-free",
          network: "testnet",
        }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockBuildWalletFreeRegisterUserDataAscii).toHaveBeenCalled();
    expect(mockCreateSessionToken).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "register",
        mode: "wallet-free",
      }),
      "session-secret",
    );
  });

  it("returns a server error when session secret is missing", async () => {
    mockHelpers.getSessionSecret.mockImplementation(() => {
      throw new Error("SESSION_SECRET environment variable is not set");
    });
    const { POST } = await loadRegisterRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register", {
        method: "POST",
        body: JSON.stringify({ mode: "wallet-free", network: "testnet" }),
      }),
    );

    expect(res.status).toBe(500);
    expect((await jsonBody<{ error: string }>(res)).error).toContain(
      "SESSION_SECRET",
    );
  });

  it("returns CORS preflight response for OPTIONS", async () => {
    const { OPTIONS } = await loadRegisterRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("agent register callback route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("requires token query parameter", async () => {
    const { POST } = await loadRegisterCallbackRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register/callback", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Missing token query parameter",
    });
  });

  it("maps expired sessions to 410", async () => {
    mockHelpers.decryptAndValidateSession.mockImplementation(() => {
      throw new Error("token expired");
    });
    const { POST } = await loadRegisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/register/callback?token=t",
        {
          method: "POST",
        },
      ),
    );

    expect(res.status).toBe(410);
    expect(await jsonBody(res)).toEqual({ error: "Session expired" });
  });

  it("returns failed stage when callback contains an error", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: { type: "register", stage: "pending", agentAddress: "0xabc" },
      secret: "session-secret",
    });
    const { POST } = await loadRegisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/register/callback?token=t",
        {
          method: "POST",
          body: JSON.stringify({ error: "Proof rejected" }),
        },
      ),
    );

    expect(res.status).toBe(200);
    expect(mockHelpers.sessionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "failed" }),
      "session-secret",
      expect.objectContaining({ error: "Proof rejected" }),
    );
  });

  it("marks session proof-received on non-empty callback payload", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: { type: "register", stage: "pending", agentAddress: "0xabc" },
      secret: "session-secret",
    });
    const { POST } = await loadRegisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/register/callback?token=t",
        {
          method: "POST",
          body: JSON.stringify({ proof: "ok" }),
        },
      ),
    );

    expect(res.status).toBe(200);
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
  it("rejects token with wrong session type (deregister on register endpoint)", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: { type: "deregister", stage: "pending" },
      secret: "session-secret",
    });
    const { POST } = await loadRegisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/register/callback?token=t",
        {
          method: "POST",
          body: JSON.stringify({ proof: "ok" }),
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Token is not for a registration session",
    });
  });

  it("short-circuits with 200 for already-completed session", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "register",
        stage: "completed",
        agentAddress: "0xdone",
        agentId: 99,
      },
      secret: "session-secret",
    });
    const { POST } = await loadRegisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/register/callback?token=t",
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
      expect.objectContaining({ agentAddress: "0xdone", agentId: 99 }),
    );
  });

  it("returns 400 for empty callback body", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: { type: "register", stage: "pending", agentAddress: "0xabc" },
      secret: "session-secret",
    });
    const { POST } = await loadRegisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/register/callback?token=t",
        {
          method: "POST",
          body: JSON.stringify({}),
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ error: "Empty callback payload" });
  });

  it("returns 400 for invalid JSON body", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: { type: "register", stage: "pending", agentAddress: "0xabc" },
      secret: "session-secret",
    });
    const { POST } = await loadRegisterCallbackRoute();
    const res = await POST(
      makeNextRequest(
        "https://example.com/api/agent/register/callback?token=t",
        {
          method: "POST",
          body: "{not valid json",
        },
      ),
    );

    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ error: "Invalid callback payload" });
  });

  it("returns preflight response for OPTIONS", async () => {
    const { OPTIONS } = await loadRegisterCallbackRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("agent register status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("requires a token", async () => {
    const { GET } = await loadRegisterStatusRoute();
    const res = await GET(
      makeNextRequest("https://example.com/api/agent/register/status", {
        method: "GET",
      }),
    );
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error:
        "Missing session token. Provide Authorization: Bearer <sessionToken>.",
    });
  });

  it("returns current terminal stage without on-chain checks", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "register",
        stage: "completed",
        agentAddress: "0xabc",
        agentId: 9,
      },
      secret: "session-secret",
    });
    const { GET } = await loadRegisterStatusRoute();
    const res = await GET(
      makeNextRequest("https://example.com/api/agent/register/status", {
        method: "GET",
        headers: { authorization: "Bearer t" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockHelpers.sessionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "completed" }),
      "session-secret",
      expect.objectContaining({ agentAddress: "0xabc", agentId: 9 }),
    );
  });

  it("updates to completed when on-chain verification is detected", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "register",
        stage: "proof-received",
        network: "testnet",
        agentAddress: "0xabc",
      },
      secret: "session-secret",
    });
    mockHelpers.checkAgentOnChain.mockResolvedValue({
      isVerified: true,
      agentId: 42n,
    });
    const { GET } = await loadRegisterStatusRoute();
    const res = await GET(
      makeNextRequest("https://example.com/api/agent/register/status", {
        method: "GET",
        headers: { authorization: "Bearer t" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockHelpers.sessionResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "completed",
        agentId: 42,
      }),
      "session-secret",
      expect.objectContaining({
        agentAddress: "0xabc",
        agentId: 42,
      }),
    );
  });

  it("returns stage as-is when verification is still pending", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "register",
        stage: "qr-ready",
        network: "testnet",
        agentAddress: "0xabc",
      },
      secret: "session-secret",
    });
    mockHelpers.checkAgentOnChain.mockResolvedValue({
      isVerified: false,
      agentId: 0n,
    });
    const { GET } = await loadRegisterStatusRoute();
    const res = await GET(
      makeNextRequest("https://example.com/api/agent/register/status", {
        method: "GET",
        headers: { authorization: "Bearer t" },
      }),
    );

    expect(res.status).toBe(200);
    expect(mockHelpers.sessionResponse).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "qr-ready" }),
      "session-secret",
      expect.objectContaining({ agentAddress: "0xabc" }),
    );
  });

  it("returns preflight response for OPTIONS", async () => {
    const { OPTIONS } = await loadRegisterStatusRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("agent register QR route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("requires token and qr-ready stage", async () => {
    const { GET } = await loadRegisterQrRoute();
    const missingToken = await GET(
      makeNextRequest("https://example.com/api/agent/register/qr", {
        method: "GET",
      }),
    );
    expect(missingToken.status).toBe(400);

    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: { type: "register", stage: "pending" },
      secret: "session-secret",
    });
    const wrongStage = await GET(
      makeNextRequest("https://example.com/api/agent/register/qr", {
        method: "GET",
        headers: { authorization: "Bearer t" },
      }),
    );
    expect(wrongStage.status).toBe(409);
  });

  it("returns the deep link and self app payload", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "register",
        stage: "qr-ready",
        qrData: { foo: "bar" },
      },
      secret: "session-secret",
    });
    const { GET } = await loadRegisterQrRoute();
    const res = await GET(
      makeNextRequest("https://example.com/api/agent/register/qr", {
        method: "GET",
        headers: { authorization: "Bearer t" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      deepLink: "self://deep-link",
      selfApp: { foo: "bar" },
    });
  });

  it("returns preflight response for OPTIONS", async () => {
    const { OPTIONS } = await loadRegisterQrRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});

describe("agent register export route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it("requires token in request body", async () => {
    const { POST } = await loadRegisterExportRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register/export", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({
      error: "Missing token in request body",
    });
  });

  it("enforces completed stage and private key availability", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: { type: "register", stage: "proof-received" },
      secret: "session-secret",
    });
    const { POST } = await loadRegisterExportRoute();
    const notCompleted = await POST(
      makeNextRequest("https://example.com/api/agent/register/export", {
        method: "POST",
        body: JSON.stringify({ token: "t" }),
      }),
    );
    expect(notCompleted.status).toBe(409);

    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "register",
        stage: "completed",
        agentPrivateKey: undefined,
      },
      secret: "session-secret",
    });
    const missingPk = await POST(
      makeNextRequest("https://example.com/api/agent/register/export", {
        method: "POST",
        body: JSON.stringify({ token: "t" }),
      }),
    );
    expect(missingPk.status).toBe(400);
  });

  it("exports private key for completed keypair-based registrations", async () => {
    mockHelpers.decryptAndValidateSession.mockReturnValue({
      session: {
        type: "register",
        stage: "completed",
        agentPrivateKey: "0xpk",
        agentAddress: "0xagent",
        agentId: 55,
        network: "testnet",
        mode: "agent-identity",
      },
      secret: "session-secret",
    });
    const { POST } = await loadRegisterExportRoute();
    const res = await POST(
      makeNextRequest("https://example.com/api/agent/register/export", {
        method: "POST",
        body: JSON.stringify({ token: "t" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({
      privateKey: "0xpk",
      agentAddress: "0xagent",
      agentId: 55,
      network: "testnet",
      mode: "agent-identity",
    });
  });

  it("returns preflight response for OPTIONS", async () => {
    const { OPTIONS } = await loadRegisterExportRoute();
    const res = await OPTIONS();
    expect(res.status).toBe(204);
  });
});
