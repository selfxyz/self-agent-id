// SPDX-License-Identifier: MIT

/** Tests for the lookup tools (self_lookup_agent, self_list_agents_for_human). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reply, testConfig as config, textOf } from "../test/helpers.js";
import {
  INVALID_AGENT_ADDRESS_ERROR,
  INVALID_HUMAN_ADDRESS_ERROR,
} from "../utils.js";

const getAgentIdMock = vi.fn();
const typedRegistryMock = vi.fn((..._args: unknown[]) => ({
  getAgentId: getAgentIdMock,
}));
vi.mock("@selfxyz/agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@selfxyz/agent-sdk")>()),
  typedRegistry: typedRegistryMock,
}));

const { handleListAgentsForHuman, handleLookupAgent } =
  await import("./discovery.js");

const human = "0x526E35be30ea29c0ca5Dd45263fdc635833947aF";
const agent = "0x00000000000000000000000000000000000000aa";
const fetchMock = vi.fn();

describe("self_list_agents_for_human", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("maps the agents-by-human response faithfully, including complete", async () => {
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
    const out = textOf(
      await handleListAgentsForHuman({ human_address: human }, config),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.example/api/agent/agents/11142220/${human}`,
    );
    expect(out.json).toEqual({
      human_address: human,
      network: "testnet",
      agents,
      total_count: 3,
      complete: false,
    });
  });

  it("uses the requested network's chain ID", async () => {
    fetchMock.mockResolvedValue(reply(200, { agents: [] }));
    const out = textOf(
      await handleListAgentsForHuman(
        { human_address: human, network: "mainnet" },
        config,
      ),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      `https://api.example/api/agent/agents/42220/${human}`,
    );
    expect(out.json).toMatchObject({ total_count: 0, network: "mainnet" });
    expect(out.json.complete).toBeUndefined();
  });

  it("rejects malformed addresses before any request (no path injection)", async () => {
    for (const human_address of [
      "0x00/../../foo",
      "0x1234",
      "0x526e35be30ea29c0ca5Dd45263fdc635833947aF", // bad checksum
      "0x0000000000000000000000000000000000000000",
    ]) {
      expect(
        textOf(await handleListAgentsForHuman({ human_address }, config)),
      ).toMatchObject({ isError: true, text: INVALID_HUMAN_ADDRESS_ERROR });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns the API error, or a fixed message when unreachable", async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { error: "Too many requests" }));
    expect(
      textOf(await handleListAgentsForHuman({ human_address: human }, config))
        .text,
    ).toBe(`Failed to list agents for ${human}: Too many requests`);

    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    fetchMock.mockRejectedValueOnce(new Error("secret detail"));
    const out = textOf(
      await handleListAgentsForHuman({ human_address: human }, config),
    );
    expect(out.text).toBe(
      `Failed to list agents for ${human}: API unreachable`,
    );
  });
});

describe("self_lookup_agent", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    getAgentIdMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("looks up by agent_id via the info API", async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        agentId: 4,
        isVerified: true,
        credentials: { nationality: "\0\0\0", olderThan: 18, ofac: [true] },
      }),
    );
    const out = textOf(await handleLookupAgent({ agent_id: 4 }, config));
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example/api/agent/info/11142220/4",
    );
    expect(out.json).toMatchObject({
      agentId: 4,
      credentialsSummary: "Verified human, 18+, OFAC clear",
    });
  });

  it("looks up by agent_address via the registry of the requested network", async () => {
    getAgentIdMock.mockResolvedValue(12n);
    fetchMock.mockResolvedValue(reply(200, { agentId: 12, isVerified: false }));
    const out = textOf(
      await handleLookupAgent(
        { agent_address: agent, network: "mainnet" },
        config,
      ),
    );
    expect(getAgentIdMock).toHaveBeenCalledWith(
      "0x00000000000000000000000000000000000000000000000000000000000000aa",
    );
    expect(typedRegistryMock.mock.calls.at(-1)?.[0]).toBe(
      "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.example/api/agent/info/42220/12",
    );
    expect(out.json.credentialsSummary).toContain("Not verified");
  });

  it("requires agent_id or agent_address", async () => {
    expect(textOf(await handleLookupAgent({}, config))).toMatchObject({
      isError: true,
      text: "Provide agent_id or agent_address.",
    });
  });

  it("rejects a malformed agent_address before any registry call", async () => {
    for (const agent_address of [
      "0x1234",
      "not-an-address",
      "0x00000000000000000000000000000000000000Aa", // bad checksum
      "0x0000000000000000000000000000000000000000",
    ]) {
      expect(
        textOf(await handleLookupAgent({ agent_address }, config)),
      ).toMatchObject({ isError: true, text: INVALID_AGENT_ADDRESS_ERROR });
    }
    expect(getAgentIdMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an error result for unknown agents (registry 0 or API 404)", async () => {
    getAgentIdMock.mockResolvedValue(0n);
    expect(
      textOf(await handleLookupAgent({ agent_address: agent }, config)).isError,
    ).toBe(true);

    fetchMock.mockResolvedValue(reply(404, { error: "Agent not found" }));
    expect(textOf(await handleLookupAgent({ agent_id: 99 }, config))).toEqual({
      isError: true,
      json: {},
      text: "Agent #99 not found on testnet.",
    });
  });

  it("does not echo RPC error text", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    getAgentIdMock.mockRejectedValue(new Error("rpc https://key@rpc"));
    const out = textOf(
      await handleLookupAgent({ agent_address: agent }, config),
    );
    expect(out.text).toBe("Failed to look up agent: upstream error");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("key@rpc");
    errorSpy.mockRestore();
  });
});
