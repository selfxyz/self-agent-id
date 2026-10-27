// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests for POST /api/mcp: body limits, rate limiting, bearer auth and privileged tool gating.
 *
 * mcp-handler, the MCP config and the tool handlers are mocked.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { makeNextRequest } from "./test-utils";

/** The server-registration callback the route passes to createMcpHandler. */
type Register = (server: {
  tool: (...args: unknown[]) => void;
  resource: (...args: unknown[]) => void;
  prompt: (...args: unknown[]) => void;
}) => void;

const registeredTools: string[] = [];
const registeredResources: string[] = [];
const registeredPrompts: string[] = [];
const toolCallbacks = new Map<string, (...args: any[]) => unknown>();
const resourceCallbacks = new Map<string, (...args: any[]) => unknown>();
const loadMcpConfigMock = vi.fn((_baseUrl: string, _headers?: object) => ({
  network: "testnet",
  rpcUrl: "https://rpc.example",
  privateKey: undefined,
}));

let register: Register;
const forwarded: Request[] = [];

/**
 * Replay the route's registration callback against a fake server, recording
 * tool/resource/prompt names and their callbacks.
 */
function runRegister() {
  registeredTools.length = 0;
  registeredResources.length = 0;
  registeredPrompts.length = 0;
  register({
    tool: (...args: unknown[]) => {
      registeredTools.push(String(args[0]));
      toolCallbacks.set(String(args[0]), args.at(-1) as any);
    },
    resource: (...args: unknown[]) => {
      registeredResources.push(String(args[0]));
      resourceCallbacks.set(String(args[0]), args.at(-1) as any);
    },
    prompt: (name: unknown) => {
      registeredPrompts.push(String(name));
    },
  });
}

// mcp-handler initialises the server per request, inside the route's context.
const handlerMock = vi.fn(async (req: Request) => {
  forwarded.push(req);
  runRegister();
  return new Response("mcp-ok", { status: 200 });
});
const createMcpHandlerMock = vi.fn((fn: Register, ..._rest: unknown[]) => {
  register = fn;
  runRegister();
  return handlerMock;
});

/**
 * Stand-in tool handler result.
 *
 * @returns `{ ok: true }`.
 */
const ok = async () => ({ ok: true });
const handlers = {
  handleLookupAgent: vi.fn(ok),
  handleListAgentsForHuman: vi.fn(ok),
  handleGetIdentity: vi.fn(async () => ({
    content: [{ type: "text", text: '{"registered":false}' }],
  })),
  handleRegisterAgent: vi.fn(ok),
  handleCheckRegistration: vi.fn(ok),
  handleDeregisterAgent: vi.fn(ok),
  handleSignRequest: vi.fn(ok),
  handleAuthenticatedFetch: vi.fn(ok),
  handleVerifyAgent: vi.fn(ok),
  handleVerifyRequest: vi.fn(ok),
};
const checkRateLimitMock = vi.fn(async () => ({
  allowed: true,
  remaining: 1,
  retryAfterMs: 1,
}));

/**
 * Re-import the MCP route with fresh module state and the mocks above.
 *
 * @returns The route module (POST etc.).
 */
async function loadRoute() {
  vi.resetModules();
  forwarded.length = 0;
  vi.doMock("mcp-handler", () => ({ createMcpHandler: createMcpHandlerMock }));
  vi.doMock("@/lib/mcp/config", () => ({ loadMcpConfig: loadMcpConfigMock }));
  vi.doMock("@/lib/rate-limit", () => ({ checkRateLimit: checkRateLimitMock }));
  vi.doMock("@/lib/mcp/handlers/discovery", () => handlers);
  vi.doMock("@/lib/mcp/handlers/identity", () => handlers);
  vi.doMock("@/lib/mcp/handlers/auth", () => handlers);
  vi.doMock("@/lib/mcp/handlers/verify", () => handlers);
  return import("@/app/api/mcp/route");
}

/**
 * Build a JSON POST request to /api/mcp.
 *
 * @param body - Raw request body.
 * @param headers - Extra headers (e.g. authorization, x-real-ip).
 * @returns The request.
 */
function post(body: string, headers: Record<string, string> = {}) {
  return makeNextRequest("http://localhost:3100/api/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

const callNoArgs = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "self_get_identity" },
});

describe("MCP route", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("registers all tools, resources and prompts with the self-agent-id serverInfo", async () => {
    await loadRoute();

    expect(createMcpHandlerMock.mock.calls[0]?.[1]).toEqual({
      serverInfo: { name: "self-agent-id", version: expect.any(String) },
    });
    expect(createMcpHandlerMock.mock.calls[0]?.[2]).toEqual({
      basePath: "/api",
      maxDuration: 60,
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

  it("answers malformed and empty JSON with a JSON-RPC parse error", async () => {
    const { POST } = await loadRoute();

    for (const body of ["{bad", ""]) {
      const res = await POST(post(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      });
    }
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it("rejects bodies over 1MB", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post(`"${"a".repeat(1024 * 1024)}"`));
    expect(res.status).toBe(413);
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it("forwards the body and defaults missing tools/call arguments to {}", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post(callNoArgs));
    expect(res.status).toBe(200);
    expect(await forwarded[0].json()).toMatchObject({
      params: { name: "self_get_identity", arguments: {} },
    });
  });

  it("calls the REST routes of this deployment as the MCP caller", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://staging.example");
    const { POST } = await loadRoute();
    await POST(post(callNoArgs, { "x-real-ip": "7.7.7.7" }));
    expect(loadMcpConfigMock).toHaveBeenLastCalledWith(
      "https://staging.example",
      { "x-real-ip": "7.7.7.7" },
    );
  });

  it("rate limits per client IP", async () => {
    const { POST } = await loadRoute();
    checkRateLimitMock.mockResolvedValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterMs: 5000,
    });
    const res = await POST(post(callNoArgs, { "x-real-ip": "1.2.3.4" }));
    expect(res.status).toBe(429);
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      expect.objectContaining({ key: "mcp:1.2.3.4" }),
    );
    expect(handlerMock).not.toHaveBeenCalled();
  });

  it("treats unknown bearer tokens as anonymous instead of 401", async () => {
    const { POST } = await loadRoute();
    const res = await POST(post(callNoArgs, { authorization: "Bearer nope" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("www-authenticate")).toBeNull();
    expect((forwarded[0] as Request & { auth?: unknown }).auth).toBeUndefined();
  });

  it("attaches privileged auth for a configured key", async () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEY", "secret");
    const { POST } = await loadRoute();
    await POST(post(callNoArgs, { authorization: "Bearer secret" }));
    expect((forwarded[0] as Request & { auth?: unknown }).auth).toMatchObject({
      scopes: ["mcp:privileged"],
    });
  });

  it("keeps register/check/read/verify tools public", async () => {
    await loadRoute();
    for (const name of [
      "self_lookup_agent",
      "self_list_agents_for_human",
      "self_register_agent",
      "self_check_registration",
      "self_verify_agent",
      "self_verify_request",
    ]) {
      await expect(toolCallbacks.get(name)!({}, {})).resolves.toEqual({
        ok: true,
      });
    }
  });

  it("gates key-using tools behind privileged scope", async () => {
    await loadRoute();
    for (const name of [
      "self_get_identity",
      "self_deregister_agent",
      "self_sign_request",
      "self_authenticated_fetch",
    ]) {
      const denied = (await toolCallbacks.get(name)!({}, {})) as any;
      expect(denied.isError).toBe(true);
      expect(denied.content[0].text).toContain(
        "requires privileged MCP authorization",
      );
    }
    expect(handlers.handleSignRequest).not.toHaveBeenCalled();

    const allowed = await toolCallbacks.get("self_sign_request")!(
      { method: "GET", url: "https://example.com" },
      { authInfo: { scopes: ["mcp:privileged"] } },
    );
    expect(allowed).toEqual({ ok: true });
  });

  it("gates the identity resource behind privileged scope", async () => {
    await loadRoute();
    const resource = resourceCallbacks.get("self-identity")!;

    const denied = (await resource(new URL("self://identity"), {})) as any;
    expect(JSON.parse(denied.contents[0].text)).toMatchObject({ error: true });
    expect(handlers.handleGetIdentity).not.toHaveBeenCalled();

    const allowed = (await resource(new URL("self://identity"), {
      authInfo: { scopes: ["mcp:privileged"] },
    })) as any;
    expect(allowed.contents[0].text).toBe('{"registered":false}');
  });
});
