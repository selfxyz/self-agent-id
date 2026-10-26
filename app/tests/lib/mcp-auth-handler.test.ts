// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for the MCP sign-request and authenticated-fetch tool handlers (lib/mcp/handlers/auth). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "@/lib/mcp/config";

const fetchMock = vi.fn();
const signRequestMock = vi.fn();
// A `function` (not an arrow) so Vitest 4 lets the handler call it with `new`.
const selfAgentCtorMock = vi.fn(function () {
  return { fetch: fetchMock, signRequest: signRequestMock };
});
const lookupMock = vi.fn();

vi.mock("@selfxyz/agent-sdk", () => ({ SelfAgent: selfAgentCtorMock }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

const { handleAuthenticatedFetch, handleSignRequest } =
  await import("@/lib/mcp/handlers/auth");

const baseConfig: McpConfig = {
  privateKey: "0xabc123",
  network: "testnet",
  rpcUrl: "https://rpc.example.com",
  appUrl: "https://agent-api.self.xyz",
  apiUrl: "https://api.example.com",
  callerHeaders: {},
  registryAddress: "0x0000000000000000000000000000000000000000",
};

type ToolResult = { content: Array<{ text: string }>; isError?: boolean };

/**
 * Read the first text block of an MCP tool result.
 *
 * @param result - The tool handler's return value.
 * @returns The text content.
 */
function text(result: unknown): string {
  return (result as ToolResult).content[0].text;
}

/**
 * Build a redirect response for the mocked SDK fetch.
 *
 * @param location - Value of the Location header.
 * @param status - Redirect status code (default 302).
 * @returns A body-less Response.
 */
function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

/**
 * Build authenticated-fetch tool args for a JSON GET.
 *
 * @param url - Target URL.
 * @returns Tool args for handleAuthenticatedFetch.
 */
const get = (url: string) => ({
  method: "GET" as const,
  url,
  content_type: "application/json",
});

describe("mcp auth handlers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("points at the registration flow when no agent key is configured", async () => {
    const result = await handleSignRequest(
      { method: "GET", url: "https://example.com" },
      { ...baseConfig, privateKey: undefined },
    );
    expect((result as ToolResult).isError).toBe(true);
    expect(text(result)).toContain("reveal_private_key=true");
  });

  it("blocks authenticated fetch to localhost by default", async () => {
    const result = await handleAuthenticatedFetch(
      get("http://localhost:3000/health"),
      baseConfig,
    );
    expect(text(result)).toContain("Authenticated fetch blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces allowed-host list for authenticated fetch", async () => {
    vi.stubEnv("MCP_AUTH_FETCH_ALLOWED_HOSTS", "api.example.com");
    const result = await handleAuthenticatedFetch(
      get("https://not-allowed.example.com/ping"),
      baseConfig,
    );
    expect(text(result)).toContain("not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends signed requests with manual redirects and a timeout", async () => {
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

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/chat", {
      method: "POST",
      body: '{"q":"hello"}',
      headers: { "Content-Type": "application/json" },
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
    expect(JSON.parse(text(result))).toEqual({
      status: 200,
      url: "https://api.example.com/v1/chat",
      body: "ok",
      truncated: false,
    });
  });

  it("does not follow a redirect into a private network", async () => {
    fetchMock.mockResolvedValueOnce(
      redirect("http://127.0.0.1:39123/internal"),
    );
    const result = await handleAuthenticatedFetch(
      get("https://httpbin.example/redirect-to"),
      baseConfig,
    );
    expect(text(result)).toContain("Authenticated fetch blocked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-validates and re-signs each allowed redirect hop", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("/next", 303))
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    const result = await handleAuthenticatedFetch(
      {
        method: "POST",
        url: "https://api.example.com/start",
        body: "x",
        content_type: "text/plain",
      },
      baseConfig,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // The GET hop is signed without the body and drops its Content-Type.
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { "Content-Type": "text/plain" },
    });
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://api.example.com/next",
      expect.objectContaining({ method: "GET", body: undefined, headers: {} }),
    ]);
    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(text(result))).toMatchObject({
      status: 200,
      url: "https://api.example.com/next",
    });
  });

  it("keeps the body and Content-Type on a method-preserving 307", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("/moved", 307))
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    await handleAuthenticatedFetch(
      {
        method: "POST",
        url: "https://api.example.com/start",
        body: "x",
        content_type: "text/plain",
      },
      baseConfig,
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: "x",
      headers: { "Content-Type": "text/plain" },
    });
  });

  it("returns a tool error (not a throw) for a malformed agent key", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    selfAgentCtorMock.mockImplementationOnce(() => {
      throw new Error("invalid private key");
    });
    const result = await handleAuthenticatedFetch(
      get("https://api.example.com/x"),
      { ...baseConfig, privateKey: "0xnot-a-key" },
    );
    expect((result as ToolResult).isError).toBe(true);
    expect(text(result)).toBe("Authenticated fetch failed: invalid agent key");
    expect(fetchMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("stops after 3 redirects", async () => {
    fetchMock.mockImplementation(async () => redirect("/again"));
    const result = await handleAuthenticatedFetch(
      get("https://api.example.com/loop"),
      baseConfig,
    );
    expect(text(result)).toContain("more than 3 redirects");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("caps the response body it reads", async () => {
    fetchMock.mockResolvedValue(new Response("a".repeat(50_000)));
    const payload = JSON.parse(
      text(
        await handleAuthenticatedFetch(
          get("https://api.example.com/big"),
          baseConfig,
        ),
      ),
    );
    expect(payload.truncated).toBe(true);
    expect(payload.body).toHaveLength(10 * 1024);
  });

  it("does not echo network error details", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:22"));
    const result = await handleAuthenticatedFetch(
      get("https://api.example.com/x"),
      baseConfig,
    );
    expect(text(result)).toBe("Authenticated fetch failed: network error");
  });
});
