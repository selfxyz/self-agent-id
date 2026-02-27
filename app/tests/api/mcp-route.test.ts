import { beforeEach, describe, expect, it, vi } from "vitest";

const registeredTools: string[] = [];
const registeredResources: string[] = [];
const registeredPrompts: string[] = [];
const toolCallbacks = new Map<string, (...args: any[]) => unknown>();
const resourceCallbacks = new Map<string, (...args: any[]) => unknown>();

const handlerMock = vi.fn(async () => new Response("mcp-ok", { status: 200 }));
const wrappedHandlerMock = vi.fn(async (req: Request) => handlerMock(req));
const withMcpAuthMock = vi.fn(() => wrappedHandlerMock);

const mockHandleLookupAgent = vi.fn(async () => ({ ok: true }));
const mockHandleListAgentsForHuman = vi.fn(async () => ({ ok: true }));
const mockHandleGetIdentity = vi.fn(async () => ({ ok: true }));
const mockHandleRegisterAgent = vi.fn(async () => ({ ok: true }));
const mockHandleCheckRegistration = vi.fn(async () => ({ ok: true }));
const mockHandleDeregisterAgent = vi.fn(async () => ({ ok: true }));
const mockHandleSignRequest = vi.fn(async () => ({ ok: true }));
const mockHandleAuthenticatedFetch = vi.fn(async () => ({ ok: true }));
const mockHandleVerifyAgent = vi.fn(async () => ({ ok: true }));
const mockHandleVerifyRequest = vi.fn(async () => ({ ok: true }));

const createMcpHandlerMock = vi.fn(
  (
    register: (server: {
      tool: (...args: unknown[]) => void;
      resource: (...args: unknown[]) => void;
      prompt: (...args: unknown[]) => void;
    }) => void,
  ) => {
    registeredTools.length = 0;
    registeredResources.length = 0;
    registeredPrompts.length = 0;
    toolCallbacks.clear();
    resourceCallbacks.clear();

    register({
      tool: (...args: unknown[]) => {
        const name = String(args[0]);
        registeredTools.push(name);
        const cb = args[args.length - 1];
        if (typeof cb === "function") {
          toolCallbacks.set(name, cb as (...args: any[]) => unknown);
        }
      },
      resource: (...args: unknown[]) => {
        const name = String(args[0]);
        registeredResources.push(name);
        const cb = args[args.length - 1];
        if (typeof cb === "function") {
          resourceCallbacks.set(name, cb as (...args: any[]) => unknown);
        }
      },
      prompt: (name: unknown) => {
        registeredPrompts.push(String(name));
      },
    });
    return handlerMock;
  },
);

async function loadRoute() {
  vi.resetModules();
  handlerMock.mockClear();
  wrappedHandlerMock.mockClear();
  createMcpHandlerMock.mockClear();
  withMcpAuthMock.mockClear();
  mockHandleLookupAgent.mockClear();
  mockHandleListAgentsForHuman.mockClear();
  mockHandleGetIdentity.mockClear();
  mockHandleRegisterAgent.mockClear();
  mockHandleCheckRegistration.mockClear();
  mockHandleDeregisterAgent.mockClear();
  mockHandleSignRequest.mockClear();
  mockHandleAuthenticatedFetch.mockClear();
  mockHandleVerifyAgent.mockClear();
  mockHandleVerifyRequest.mockClear();

  vi.doMock("mcp-handler", () => ({
    createMcpHandler: createMcpHandlerMock,
    withMcpAuth: withMcpAuthMock,
  }));

  vi.doMock("@/lib/mcp/config", () => ({
    loadMcpConfig: () => ({
      network: "testnet",
      rpcUrl: "https://rpc.example",
      privateKey: undefined,
    }),
  }));

  vi.doMock("@selfxyz/agent-sdk", () => ({
    NETWORKS: {
      mainnet: {
        registryAddress: "0xmain",
        rpcUrl: "https://mainnet-rpc.example",
      },
      testnet: {
        registryAddress: "0xtest",
        rpcUrl: "https://testnet-rpc.example",
      },
    },
  }));

  vi.doMock("@/lib/mcp/handlers/discovery", () => ({
    handleLookupAgent: mockHandleLookupAgent,
    handleListAgentsForHuman: mockHandleListAgentsForHuman,
  }));
  vi.doMock("@/lib/mcp/handlers/identity", () => ({
    handleGetIdentity: mockHandleGetIdentity,
    handleRegisterAgent: mockHandleRegisterAgent,
    handleCheckRegistration: mockHandleCheckRegistration,
    handleDeregisterAgent: mockHandleDeregisterAgent,
  }));
  vi.doMock("@/lib/mcp/handlers/auth", () => ({
    handleSignRequest: mockHandleSignRequest,
    handleAuthenticatedFetch: mockHandleAuthenticatedFetch,
  }));
  vi.doMock("@/lib/mcp/handlers/verify", () => ({
    handleVerifyAgent: mockHandleVerifyAgent,
    handleVerifyRequest: mockHandleVerifyRequest,
  }));

  return import("@/app/api/mcp/route");
}

describe("MCP route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers tools/resources/prompts and wraps transport with optional MCP auth", async () => {
    await loadRoute();

    expect(createMcpHandlerMock).toHaveBeenCalledTimes(1);
    expect(createMcpHandlerMock.mock.calls[0]?.[2]).toEqual({
      basePath: "/api",
      maxDuration: 60,
    });

    expect(withMcpAuthMock).toHaveBeenCalledTimes(1);
    expect(withMcpAuthMock.mock.calls[0]?.[2]).toEqual({
      required: false,
    });

    expect(registeredTools).toEqual([
      "self_lookup_agent",
      "self_list_agents_for_human",
      "self_get_identity",
      "self_register_agent",
      "self_check_registration",
      "self_deregister_agent",
      "self_sign_request",
      "self_authenticated_fetch",
      "self_verify_agent",
      "self_verify_request",
    ]);
    expect(registeredResources).toEqual(["self-networks", "self-identity"]);
    expect(registeredPrompts).toEqual(["self_integrate_verification"]);
  });

  it("exports GET/POST/DELETE bound to the auth-wrapped MCP handler", async () => {
    const mod = await loadRoute();

    expect(mod.GET).toBe(wrappedHandlerMock);
    expect(mod.POST).toBe(wrappedHandlerMock);
    expect(mod.DELETE).toBe(wrappedHandlerMock);

    const res = await mod.GET(new Request("https://example.com/api/mcp"));
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("mcp-ok");
    expect(wrappedHandlerMock).toHaveBeenCalledTimes(1);
    expect(handlerMock).toHaveBeenCalledTimes(1);
  });

  it("keeps read-only tools open without privileged auth", async () => {
    await loadRoute();
    const lookupTool = toolCallbacks.get("self_lookup_agent");
    expect(lookupTool).toBeTruthy();

    const result = await lookupTool!(
      { agent_address: "0xabc", network: "testnet" },
      {},
    );

    expect(mockHandleLookupAgent).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it("blocks privileged tools without privileged scope", async () => {
    await loadRoute();
    const signTool = toolCallbacks.get("self_sign_request");
    expect(signTool).toBeTruthy();

    const result = await signTool!(
      { method: "GET", url: "https://example.com" },
      {},
    );

    expect(mockHandleSignRequest).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
    expect((result as any).content?.[0]?.text).toContain(
      "requires privileged MCP authorization",
    );
  });

  it("allows privileged tools with privileged scope", async () => {
    await loadRoute();
    const signTool = toolCallbacks.get("self_sign_request");
    expect(signTool).toBeTruthy();

    const result = await signTool!(
      { method: "GET", url: "https://example.com" },
      { authInfo: { scopes: ["mcp:privileged"] } },
    );

    expect(mockHandleSignRequest).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: true });
  });

  it("blocks privileged resources without privileged scope", async () => {
    await loadRoute();
    const identityResource = resourceCallbacks.get("self-identity");
    expect(identityResource).toBeTruthy();

    const unauthorized = await identityResource!(
      new URL("self://identity"),
      {},
    );
    const unauthorizedText = (unauthorized as any).contents?.[0]?.text || "";
    expect(unauthorizedText).toContain("requires privileged authorization");

    const authorized = await identityResource!(new URL("self://identity"), {
      authInfo: { scopes: ["mcp:privileged"] },
    });
    const authorizedText = (authorized as any).contents?.[0]?.text || "";
    expect(authorizedText).toContain("No agent identity configured");
  });
});
