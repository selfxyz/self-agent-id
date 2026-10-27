// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests for CORS on /api/mcp (OPTIONS preflight, handler and route-level errors)
 * and the self_verify_request tool description.
 *
 * mcp-handler and the rate limiter are mocked.
 */

import { describe, expect, it, vi } from "vitest";
import { makeNextRequest } from "./test-utils";

const toolDescriptions = new Map<string, string>();
const handlerMock = vi.fn(
  async () =>
    new Response("mcp-ok", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
);
const checkRateLimitMock = vi.fn(async () => ({
  allowed: true,
  remaining: 1,
  retryAfterMs: 1,
}));

/**
 * Re-import the MCP route with mcp-handler and the rate limiter mocked,
 * recording each registered tool's description.
 *
 * @returns The route module.
 */
async function loadRoute() {
  vi.resetModules();
  vi.doMock("mcp-handler", () => ({
    createMcpHandler: (register: (server: unknown) => void) => {
      register({
        tool: (name: string, description: string) =>
          toolDescriptions.set(name, description),
        resource: () => {},
        prompt: () => {},
      });
      return handlerMock;
    },
  }));
  vi.doMock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
  return import("@/app/api/mcp/route");
}

/**
 * Build a POST /api/mcp request.
 *
 * @param body - Raw request body.
 * @returns The request.
 */
function post(body: string) {
  return makeNextRequest("http://localhost:3100/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/**
 * Assert a response carries the MCP CORS headers.
 *
 * @param res - Route response.
 */
function expectMcpCors(res: Response) {
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  const allowed = res.headers.get("Access-Control-Allow-Headers") ?? "";
  for (const h of [
    "Authorization",
    "Mcp-Protocol-Version",
    "Mcp-Session-Id",
    "Content-Type",
  ]) {
    expect(allowed).toContain(h);
  }
  expect(res.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
}

describe("/api/mcp CORS", () => {
  it("answers OPTIONS with 204 and the MCP transport headers allowed", async () => {
    const { OPTIONS } = await loadRoute();
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expectMcpCors(res);
  });

  it("adds CORS to its own 400 and 413 JSON-RPC errors", async () => {
    const { POST } = await loadRoute();
    const parse = await POST(post("{bad"));
    expect(parse.status).toBe(400);
    expectMcpCors(parse);

    const big = await POST(post(`"${"x".repeat(1024 * 1024 + 10)}"`));
    expect(big.status).toBe(413);
    expectMcpCors(big);
  });

  it("adds CORS to mcp-handler responses and the 429, keeping the body", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post('{"jsonrpc":"2.0","id":1,"method":"ping"}'));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("Access-Control-Expose-Headers")).toContain(
      "Mcp-Session-Id",
    );
    expectMcpCors(res);
    expect(await res.text()).toBe("mcp-ok");

    checkRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 2000,
    });
    const limited = await POST(post("{}"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("2");
    expectMcpCors(limited);
  });

  it("says self_verify_request handles ECDSA-signed requests only", async () => {
    await loadRoute();
    const description = toolDescriptions.get("self_verify_request") ?? "";
    expect(description).toMatch(/ECDSA \(secp256k1\)/);
    expect(description).toMatch(/Ed25519.*not supported/);
    expect(description).toContain("SelfAgentVerifier");
  });
});
