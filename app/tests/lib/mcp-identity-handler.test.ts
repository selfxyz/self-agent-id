// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for the MCP identity tool handlers (lib/mcp/handlers/identity): register, check, get identity, deregister. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpConfig } from "@/lib/mcp/config";

const selfAgentCtorMock = vi.fn();
vi.mock("@selfxyz/agent-sdk", () => ({
  SelfAgent: selfAgentCtorMock,
  NETWORKS: {
    mainnet: { rpcUrl: "https://mainnet-rpc.example", registryAddress: "0x1" },
    testnet: { rpcUrl: "https://testnet-rpc.example", registryAddress: "0x2" },
  },
}));
vi.mock("@/lib/render-qr", () => ({ renderQrBase64: async () => "rendered" }));

const {
  handleCheckRegistration,
  handleDeregisterAgent,
  handleGetIdentity,
  handleRegisterAgent,
} = await import("@/lib/mcp/handlers/identity");

const config: McpConfig = {
  privateKey: undefined,
  network: "testnet",
  rpcUrl: "https://custom-rpc.example",
  appUrl: "https://agent-api.self.xyz",
  apiUrl: "https://api.example",
  callerHeaders: {},
  registryAddress: "0x2",
};

const fetchMock = vi.fn();

/**
 * Build a JSON fetch response.
 *
 * @param status - HTTP status code.
 * @param body - Value serialised as the JSON body.
 * @returns A Response for the mocked fetch to resolve with.
 */
function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Unpack an MCP tool result's text block, parsing it as JSON when possible.
 *
 * @param result - The tool handler's return value.
 * @returns `{ isError, json, text }`; `json` is `{}` for plain-text results.
 */
function textOf(result: unknown): {
  isError?: boolean;
  json: Record<string, unknown>;
  text: string;
} {
  const r = result as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  const text = r.content.find((c) => c.type === "text")!.text!;
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // Plain-text result.
  }
  return { isError: r.isError, json, text };
}

describe("mcp identity handlers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("self_register_agent", () => {
    it("uses wallet-free mode when no human_address is given", async () => {
      fetchMock.mockResolvedValue(
        reply(200, {
          sessionToken: "tok",
          agentAddress: "0xagent",
          deepLink: "https://redirect.self.xyz?x",
          scanUrl: "https://api.example/api/qr/qrtok",
          qrImageBase64: "png",
          expiresAt: "2030-01-01T00:00:00.000Z",
          humanInstructions: ["Scan it"],
        }),
      );
      const result = await handleRegisterAgent({ minimum_age: 18 }, config);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.example/api/agent/register");
      expect(JSON.parse(init.body)).toEqual({
        mode: "wallet-free",
        network: "testnet",
        disclosures: { minimumAge: 18 },
      });
      expect((result as CallToolResult).content[0]).toEqual({
        type: "image",
        data: "png",
        mimeType: "image/png",
      });
      expect(textOf(result).json).toMatchObject({
        session_token: "tok",
        scan_url: "https://api.example/api/qr/qrtok",
        mode: "wallet-free",
      });
    });

    it("uses linked mode with a human_address", async () => {
      fetchMock.mockResolvedValue(reply(200, { deepLink: "dl" }));
      const human = "0x00000000000000000000000000000000000000Aa";
      const result = await handleRegisterAgent(
        { human_address: human, network: "mainnet" },
        config,
      );
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
        mode: "linked",
        humanAddress: human,
        network: "mainnet",
      });
      // Falls back to rendering the QR from the deep link; never builds a
      // scan URL out of the session token.
      expect((result as CallToolResult).content[0]).toMatchObject({
        data: "rendered",
      });
      expect(textOf(result).json.scan_url).toBeUndefined();
    });

    it("returns an error result with the API error message", async () => {
      fetchMock.mockResolvedValue(reply(400, { error: "Invalid mode" }));
      const result = textOf(await handleRegisterAgent({}, config));
      expect(result.isError).toBe(true);
      expect(result.text).toBe("Registration failed: Invalid mode");
    });
  });

  describe("self_check_registration", () => {
    it("polls with a Bearer token and maps qr-ready faithfully", async () => {
      fetchMock.mockResolvedValue(
        reply(200, { stage: "qr-ready", sessionToken: "tok2" }),
      );
      const result = textOf(
        await handleCheckRegistration({ session_token: "tok1" }, config),
      );
      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.example/api/agent/register/status",
        expect.objectContaining({
          headers: { Authorization: "Bearer tok1" },
        }),
      );
      expect(result.json).toMatchObject({
        stage: "qr-ready",
        session_token: "tok2",
      });
      expect(result.json.message).toContain("scan the QR code");
    });

    it.each(["expired", "failed"])("reports the %s stage", async (stage) => {
      fetchMock.mockResolvedValue(reply(200, { stage, sessionToken: "t" }));
      const result = textOf(
        await handleCheckRegistration({ session_token: "t" }, config),
      );
      expect(result.json.stage).toBe(stage);
      expect(result.json.message).toContain("self_register_agent");
      expect(result.json.message).not.toContain("not scanned");
    });

    it("maps HTTP 410 to the expired stage", async () => {
      fetchMock.mockResolvedValue(reply(410, { error: "Session expired" }));
      const result = textOf(
        await handleCheckRegistration({ session_token: "t" }, config),
      );
      expect(result.json.stage).toBe("expired");
    });

    it("explains how to export the key once completed", async () => {
      fetchMock.mockResolvedValue(
        reply(200, {
          stage: "completed",
          sessionToken: "tok2",
          agentId: 7,
          agentAddress: "0xagent",
          expiresAt: "2030-01-01T00:00:00.000Z",
        }),
      );
      const result = textOf(
        await handleCheckRegistration({ session_token: "tok1" }, config),
      );
      expect(result.json).toMatchObject({
        stage: "completed",
        agent_id: 7,
        export_expires_at: "2030-01-01T00:00:00.000Z",
      });
      expect(result.json.private_key).toBeUndefined();
      expect(result.json.message).toContain("reveal_private_key=true");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("exports the key with the rotated Bearer token when asked", async () => {
      fetchMock
        .mockResolvedValueOnce(
          reply(200, { stage: "completed", sessionToken: "tok2", agentId: 7 }),
        )
        .mockResolvedValueOnce(reply(200, { privateKey: "0xkey" }));
      const result = textOf(
        await handleCheckRegistration(
          { session_token: "tok1", reveal_private_key: true },
          config,
        ),
      );
      expect(fetchMock.mock.calls[1]).toEqual([
        "https://api.example/api/agent/register/export",
        expect.objectContaining({
          method: "POST",
          headers: { Authorization: "Bearer tok2" },
        }),
      ]);
      expect(result.json).toMatchObject({
        stage: "completed",
        private_key: "0xkey",
      });
    });
  });

  describe("self_get_identity", () => {
    it("uses the RPC of the requested network", async () => {
      const info = {
        address: "0xagent",
        agentKey: "0xkey",
        agentId: 3n,
        isVerified: true,
        isProofFresh: false,
        nullifier: 2n ** 200n,
        agentCount: 1n,
        proofExpiresAt: 1_700_000_000n,
      };
      selfAgentCtorMock.mockImplementation(function () {
        return {
          address: "0xagent",
          getInfo: async () => info,
          getCredentials: async () => undefined,
          getVerificationStrength: async () => 100,
        };
      });
      const keyed = { ...config, privateKey: "0xabc" };

      const mainnet = textOf(
        await handleGetIdentity({ network: "mainnet" }, keyed),
      );
      expect(selfAgentCtorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          network: "mainnet",
          rpcUrl: "https://mainnet-rpc.example",
        }),
      );
      // Verified requires a fresh proof; big nullifiers keep full precision.
      expect(mainnet.json).toMatchObject({
        isVerified: false,
        nullifier: (2n ** 200n).toString(),
        proofExpiresAt: "2023-11-14T22:13:20.000Z",
      });

      await handleGetIdentity({}, keyed);
      expect(selfAgentCtorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          network: "testnet",
          rpcUrl: "https://custom-rpc.example",
        }),
      );
    });
  });

  describe("self_deregister_agent", () => {
    it("starts deregistration for the configured key's address", async () => {
      fetchMock.mockResolvedValue(
        reply(200, {
          sessionToken: "d",
          deepLink: "dl",
          scanUrl: "https://api.example/api/qr/q",
        }),
      );
      const key =
        "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
      const result = textOf(
        await handleDeregisterAgent({}, { ...config, privateKey: key }),
      );
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        network: "testnet",
        agentAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      });
      expect(result.json).toMatchObject({
        session_token: "d",
        scan_url: "https://api.example/api/qr/q",
      });
    });
  });
});
