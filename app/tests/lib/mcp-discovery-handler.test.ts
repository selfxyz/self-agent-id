// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for the MCP discovery tool handlers (lib/mcp/handlers/discovery) and formatCredentialsSummary. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "@/lib/mcp/config";
import {
  formatCredentialsSummary,
  INVALID_AGENT_ADDRESS_ERROR,
} from "@/lib/mcp/utils";

const getAgentIdMock = vi.fn();
vi.mock("@/lib/contract-types", () => ({
  typedRegistry: () => ({ getAgentId: getAgentIdMock }),
}));

const { handleListAgentsForHuman, handleLookupAgent } =
  await import("@/lib/mcp/handlers/discovery");

const config: McpConfig = {
  privateKey: undefined,
  network: "testnet",
  rpcUrl: "https://rpc.example",
  appUrl: "https://agent-api.self.xyz",
  apiUrl: "https://api.example",
  callerHeaders: {},
  registryAddress: "0x2",
};
const human = "0x00000000000000000000000000000000000000Aa";
const agent = "0x00000000000000000000000000000000000000aa";
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
 * Unpack an MCP tool result into its error flag and first text block.
 *
 * @param r - The tool handler's return value.
 * @returns `{ isError, text }`.
 */
function result(r: unknown) {
  const { content, isError } = r as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  return { isError, text: content[0].text };
}

describe("mcp discovery handlers", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    getAgentIdMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps the agents-by-human response faithfully", async () => {
    const agents = [
      { agentId: 4, agentAddress: "0xa", isVerified: true },
      { agentId: 9, agentAddress: "0xb", isVerified: false },
    ];
    fetchMock.mockResolvedValue(
      reply(200, {
        humanAddress: human,
        agents,
        totalCount: 3,
        complete: false,
      }),
    );
    const out = result(
      await handleListAgentsForHuman({ human_address: human }, config),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.example/api/agent/agents/11142220/${human}`,
    );
    expect(JSON.parse(out.text)).toEqual({
      human_address: human,
      network: "testnet",
      agents,
      total_count: 3,
      complete: false,
    });
  });

  it("URL-encodes the address path segment", async () => {
    fetchMock.mockResolvedValue(
      reply(400, { error: "Invalid Ethereum address" }),
    );
    const out = result(
      await handleListAgentsForHuman(
        { human_address: "0x00/../../foo", network: "mainnet" },
        config,
      ),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example/api/agent/agents/42220/0x00%2F..%2F..%2Ffoo",
    );
    expect(out.isError).toBe(true);
  });

  it("looks up by agent_id via the info API", async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        agentId: 4,
        isVerified: true,
        credentials: { nationality: "\0\0\0", olderThan: 18, ofac: [true] },
      }),
    );
    const out = JSON.parse(
      result(await handleLookupAgent({ agent_id: 4 }, config)).text,
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example/api/agent/info/11142220/4",
    );
    expect(out.credentialsSummary).toBe("Verified human, 18+, OFAC clear");
  });

  it("looks up by agent_address via the registry", async () => {
    getAgentIdMock.mockResolvedValue(12n);
    fetchMock.mockResolvedValue(reply(200, { agentId: 12, isVerified: false }));
    const out = JSON.parse(
      result(await handleLookupAgent({ agent_address: agent }, config)).text,
    );
    expect(getAgentIdMock).toHaveBeenCalledWith(
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example/api/agent/info/11142220/12",
    );
    expect(out.credentialsSummary).toContain("Not verified");
  });

  it("rejects a malformed agent_address before any registry call", async () => {
    for (const agent_address of [
      "0x1234",
      "not-an-address",
      "0x00000000000000000000000000000000000000Aa", // bad checksum
      "0x0000000000000000000000000000000000000000",
    ]) {
      expect(
        result(await handleLookupAgent({ agent_address }, config)),
      ).toEqual({ isError: true, text: INVALID_AGENT_ADDRESS_ERROR });
    }
    expect(getAgentIdMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an error result for unknown agents", async () => {
    getAgentIdMock.mockResolvedValue(0n);
    expect(
      result(await handleLookupAgent({ agent_address: agent }, config)).isError,
    ).toBe(true);

    fetchMock.mockResolvedValue(reply(404, { error: "Agent not found" }));
    const out = result(await handleLookupAgent({ agent_id: 99 }, config));
    expect(out).toEqual({
      isError: true,
      text: "Agent #99 not found on testnet.",
    });
  });
});

describe("mcp utils", () => {
  it("treats NUL-padded, separator-only and UNAVAILABLE nationality as undisclosed", () => {
    for (const nationality of ["\0\0\0", "\0\0-\0\0-\0\0", "UNAVAILABLE", ""]) {
      expect(
        formatCredentialsSummary({ nationality, olderThan: 18n }, true),
      ).toBe("Verified human, 18+");
    }
    expect(formatCredentialsSummary({ nationality: "GBR\0" }, true)).toBe(
      "Verified human, nationality: GBR",
    );
  });
});
