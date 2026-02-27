import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCP_PRIVILEGED_SCOPE,
  hasPrivilegedScope,
  verifyMcpBearerToken,
} from "@/lib/mcp/authz";

describe("mcp authz", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns undefined when no bearer token is provided", async () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEY", "secret");
    const result = await verifyMcpBearerToken(
      new Request("https://example.com/api/mcp"),
      undefined,
    );
    expect(result).toBeUndefined();
  });

  it("accepts a valid single privileged API key", async () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEY", "secret");
    const result = await verifyMcpBearerToken(
      new Request("https://example.com/api/mcp"),
      "secret",
    );

    expect(result).toMatchObject({
      token: "secret",
      clientId: "mcp-privileged",
      scopes: [MCP_PRIVILEGED_SCOPE],
    });
  });

  it("accepts a valid API key from MCP_PRIVILEGED_API_KEYS list", async () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEYS", "alpha,beta,gamma");
    const result = await verifyMcpBearerToken(
      new Request("https://example.com/api/mcp"),
      "beta",
    );

    expect(result?.scopes).toContain(MCP_PRIVILEGED_SCOPE);
  });

  it("rejects invalid tokens", async () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEYS", "alpha,beta");
    await expect(
      verifyMcpBearerToken(new Request("https://example.com/api/mcp"), "wrong"),
    ).rejects.toThrow("Invalid MCP bearer token");
  });

  it("rejects bearer tokens when privileged auth is not configured", async () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEY", "");
    vi.stubEnv("MCP_PRIVILEGED_API_KEYS", "");
    await expect(
      verifyMcpBearerToken(new Request("https://example.com/api/mcp"), "token"),
    ).rejects.toThrow("Privileged MCP authentication is not configured");
  });

  it("detects privileged scope", () => {
    expect(hasPrivilegedScope({ scopes: [MCP_PRIVILEGED_SCOPE] })).toBe(true);
    expect(hasPrivilegedScope({ scopes: [] })).toBe(false);
    expect(hasPrivilegedScope(undefined)).toBe(false);
  });
});
