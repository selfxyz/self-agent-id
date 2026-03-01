import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "@/lib/mcp/config";

const fetchMock = vi.fn();
const signRequestMock = vi.fn();
const selfAgentCtorMock = vi.fn(() => ({
  fetch: fetchMock,
  signRequest: signRequestMock,
}));

const baseConfig: McpConfig = {
  privateKey: "0xabc123",
  network: "testnet",
  rpcUrl: "https://rpc.example.com",
  apiUrl: "https://api.example.com",
  registryAddress: "0x0000000000000000000000000000000000000000",
};

function parseToolSuccess(result: unknown): Record<string, unknown> {
  const payload = result as {
    content?: Array<{ text?: string }>;
    isError?: boolean;
  };
  expect(payload.isError).toBeUndefined();
  const text = payload.content?.[0]?.text || "";
  return JSON.parse(text) as Record<string, unknown>;
}

async function loadHandlers() {
  vi.resetModules();
  fetchMock.mockReset();
  signRequestMock.mockReset();
  selfAgentCtorMock.mockClear();

  vi.doMock("@selfxyz/agent-sdk", () => ({
    SelfAgent: selfAgentCtorMock,
  }));

  return import("@/lib/mcp/handlers/auth");
}

describe("mcp auth handlers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("blocks authenticated fetch to localhost by default", async () => {
    const { handleAuthenticatedFetch } = await loadHandlers();
    const result = await handleAuthenticatedFetch(
      {
        method: "GET",
        url: "http://localhost:3000/health",
        content_type: "application/json",
      },
      baseConfig,
    );

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(
      (result as { content?: Array<{ text?: string }> }).content?.[0]?.text,
    ).toContain("Authenticated fetch blocked");
    expect(selfAgentCtorMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces allowed-host list for authenticated fetch", async () => {
    vi.stubEnv("MCP_AUTH_FETCH_ALLOWED_HOSTS", "api.example.com");
    const { handleAuthenticatedFetch } = await loadHandlers();
    const result = await handleAuthenticatedFetch(
      {
        method: "GET",
        url: "https://not-allowed.example.com/ping",
        content_type: "application/json",
      },
      baseConfig,
    );

    expect((result as { isError?: boolean }).isError).toBe(true);
    expect(
      (result as { content?: Array<{ text?: string }> }).content?.[0]?.text,
    ).toContain("not allowed");
    expect(selfAgentCtorMock).not.toHaveBeenCalled();
  });

  it("allows authenticated fetch when target is permitted", async () => {
    vi.stubEnv("MCP_AUTH_FETCH_ALLOWED_HOSTS", "api.example.com");

    const { handleAuthenticatedFetch } = await loadHandlers();
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await handleAuthenticatedFetch(
      {
        method: "POST",
        url: "https://api.example.com/v1/chat",
        body: '{"q":"hello"}',
        content_type: "application/json",
      },
      baseConfig,
    );

    expect(selfAgentCtorMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/chat", {
      method: "POST",
      body: '{"q":"hello"}',
      headers: { "Content-Type": "application/json" },
    });

    const payload = parseToolSuccess(result);
    expect(payload.status).toBe(200);
    expect(payload.body).toBe("ok");
    expect(payload.truncated).toBe(false);
  });
});
