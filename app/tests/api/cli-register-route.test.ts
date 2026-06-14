import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeNextRequest } from "./test-utils";

const mockGetUniversalLink = vi.fn();
const mockRenderQrPng = vi.fn();
const mockErrorResponse = vi.fn();
const mockCorsResponse = vi.fn();
const builderArgs: Record<string, unknown>[] = [];

class MockSelfAppBuilder {
  private readonly args: Record<string, unknown>;

  constructor(args: Record<string, unknown>) {
    this.args = args;
    builderArgs.push(args);
  }

  build() {
    return {
      kind: "self-app",
      ...this.args,
    };
  }
}

function installMocks() {
  vi.doMock("@selfxyz/qrcode", () => ({
    SelfAppBuilder: MockSelfAppBuilder,
    getUniversalLink: mockGetUniversalLink,
  }));

  vi.doMock("@/lib/renderQr", () => ({
    renderQrPng: mockRenderQrPng,
  }));

  vi.doMock("@/lib/agent-api-helpers", () => ({
    errorResponse: mockErrorResponse,
    corsResponse: mockCorsResponse,
  }));
}

async function loadRoute() {
  vi.resetModules();
  installMocks();
  return import("@/app/cli/register/route");
}

function payloadUrl(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `https://example.com/cli/register?payload=${encoded}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    operation: "register",
    mode: "linked",
    chainId: 11142220,
    registryAddress: "0x1234567890123456789012345678901234567890",
    endpointType: "staging_celo",
    appName: "Self Agent ID",
    scope: "self-agent-id",
    humanIdentifier: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    userDefinedData: "X000000000000000000000000000000000000000000",
    disclosures: {
      minimumAge: 18,
      ofac: true,
      name: false,
    },
    expiresAt: Date.now() + 60_000,
    ...overrides,
  };
}

describe("CLI browser handoff route (GET /cli/register)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    builderArgs.length = 0;
    mockGetUniversalLink.mockReturnValue("self://deep-link");
    mockRenderQrPng.mockResolvedValue(Buffer.from("png-bytes"));
    mockErrorResponse.mockImplementation((message: string, status: number) =>
      Response.json({ error: message }, { status }),
    );
    mockCorsResponse.mockReturnValue(new Response(null, { status: 204 }));
  });

  it("returns a PNG QR for a valid CLI handoff payload", async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeNextRequest(payloadUrl(validPayload())));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(Buffer.from(await res.arrayBuffer()).toString("utf8")).toBe(
      "png-bytes",
    );
    expect(mockRenderQrPng).toHaveBeenCalledWith("self://deep-link");
    expect(mockGetUniversalLink).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "self-app",
        userDefinedData: "X000000000000000000000000000000000000000000",
      }),
    );
    expect(builderArgs[0]).toMatchObject({
      version: 2,
      appName: "Self Agent ID",
      scope: "self-agent-id",
      endpoint: "0x1234567890123456789012345678901234567890",
      userId: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      endpointType: "staging_celo",
      userIdType: "hex",
      userDefinedData: "X000000000000000000000000000000000000000000",
      disclosures: {
        minimumAge: 18,
        ofac: true,
      },
    });
  });

  it("returns 400 when the payload query parameter is missing", async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeNextRequest("https://example.com/cli/register"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Missing payload query parameter",
    });
  });

  it("returns 400 when the payload is not valid base64url JSON", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest("https://example.com/cli/register?payload=not-json"),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid payload encoding" });
  });

  it("returns 410 for expired sessions", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(payloadUrl(validPayload({ expiresAt: Date.now() - 1 }))),
    );

    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({
      error: "Session expired. Run `register init` again.",
    });
  });

  it("rejects smartwallet registration because it needs an interactive client", async () => {
    const { GET } = await loadRoute();
    const res = await GET(
      makeNextRequest(payloadUrl(validPayload({ mode: "smartwallet" }))),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error:
        "smartwallet registration needs an interactive client; use linked, wallet-free, or ed25519 mode, or the SDK",
    });
    expect(mockRenderQrPng).not.toHaveBeenCalled();
  });

  it("returns 400 when userDefinedData is missing", async () => {
    const { GET } = await loadRoute();
    const payload = validPayload();
    delete payload.userDefinedData;

    const res = await GET(makeNextRequest(payloadUrl(payload)));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Missing userDefinedData in payload",
    });
  });

  it("returns the shared CORS preflight response", async () => {
    const { OPTIONS } = await loadRoute();
    const res = await OPTIONS();

    expect(res.status).toBe(204);
    expect(mockCorsResponse).toHaveBeenCalled();
  });
});
