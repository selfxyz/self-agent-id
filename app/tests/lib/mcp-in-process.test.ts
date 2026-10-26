// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Tests that MCP tools call the REST route handlers in-process.
 *
 * Real routes; only the contract bindings are faked. Per-IP rate limits follow the MCP caller.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMcpConfig } from "@/lib/mcp/config";

const registry: Record<string, ReturnType<typeof vi.fn>> = {};
vi.mock("@/lib/contract-types", () => ({
  typedRegistry: () => registry,
  typedProvider: () => ({ verificationStrength: async () => 100 }),
}));

const { handleRegisterAgent } = await import("@/lib/mcp/handlers/identity");
const { handleLookupAgent } = await import("@/lib/mcp/handlers/discovery");

const fetchMock = vi.fn();

/**
 * Load an MCP config for a caller at the given IP, with no remote API base.
 *
 * @param ip - Caller IP, sent as `x-real-ip`.
 * @returns The MCP config the handlers receive.
 */
function configFor(ip: string) {
  return loadMcpConfig("https://agent-api.self.xyz", { "x-real-ip": ip });
}

/**
 * Unpack an MCP tool result into its error flag and first text block.
 *
 * @param result - The tool handler's return value.
 * @returns `{ isError, text }`.
 */
function textOf(result: unknown): { isError?: boolean; text: string } {
  const r = result as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  return {
    isError: r.isError,
    text: r.content.find((c) => c.type === "text")!.text!,
  };
}

beforeEach(() => {
  (
    globalThis as { __selfMemoryCounters?: Map<string, unknown> }
  ).__selfMemoryCounters?.clear();
  vi.stubEnv("SESSION_SECRET", "test-secret-for-mcp-in-process");
  vi.stubEnv("SELF_AGENT_API_BASE", "");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockRejectedValue(new Error("no HTTP expected"));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("in-process REST calls", () => {
  it("rate-limits registrations per MCP caller, not per server", async () => {
    // 12 distinct callers: all succeed (the register route allows 10/min/IP).
    for (let i = 1; i <= 12; i++) {
      const out = textOf(
        await handleRegisterAgent(
          { network: "testnet" },
          configFor(`9.0.0.${i}`),
        ),
      );
      expect(out.isError, out.text).toBeUndefined();
      expect(JSON.parse(out.text).scan_url).toMatch(
        /^https:\/\/agent-api\.self\.xyz\/api\/qr\//,
      );
    }
    // One caller: the 11th call within a minute is limited.
    const results = [];
    for (let i = 0; i < 11; i++) {
      results.push(
        textOf(
          await handleRegisterAgent(
            { network: "testnet" },
            configFor("9.9.9.9"),
          ),
        ),
      );
    }
    expect(results.slice(0, 10).every((r) => !r.isError)).toBe(true);
    expect(results[10]).toEqual({
      isError: true,
      text: "Registration failed: Rate limit exceeded. Try again later.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  }, 30_000);

  it("looks agents up through the info route", async () => {
    for (const [name, value] of Object.entries({
      agentIdToAgentKey:
        "0x00000000000000000000000059489da9e1eb1f162b0d8eeeadc0314f49ad759a",
      hasHumanProof: true,
      isProofFresh: true,
      proofExpiresAt: 1803752935n,
      getProofProvider: "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
      agentRegisteredAt: 1n,
      getAgentCredentials: {
        nationality: "UNAVAILABLE",
        olderThan: 18n,
        ofac: [true, false, false],
      },
    })) {
      registry[name] = vi.fn().mockResolvedValue(value);
    }
    const out = textOf(
      await handleLookupAgent({ agent_id: 5 }, configFor("9.1.1.1")),
    );
    expect(out.isError).toBeUndefined();
    const info = JSON.parse(out.text);
    expect(info).toMatchObject({
      agentId: 5,
      chainId: 42220,
      isVerified: true,
      network: "mainnet",
      credentials: { nationality: null },
      credentialsSummary: "Verified human, 18+, OFAC clear",
    });
    expect(registry.agentIdToAgentKey).toHaveBeenCalledWith(5n);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("loadMcpConfig", () => {
  it("calls another deployment over HTTP only when SELF_AGENT_API_BASE is set", () => {
    expect(configFor("1.1.1.1").apiUrl).toBeUndefined();
    vi.stubEnv("SELF_AGENT_API_BASE", "https://other.example/");
    expect(configFor("1.1.1.1")).toMatchObject({
      apiUrl: "https://other.example",
      appUrl: "https://agent-api.self.xyz",
      callerHeaders: { "x-real-ip": "1.1.1.1" },
    });
  });
});
