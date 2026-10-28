// SPDX-License-Identifier: MIT

/** End-to-end tests of the MCP server over an in-memory transport. */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./server.js";
import { testConfig } from "./test/helpers.js";
import { NO_AGENT_KEY_ERROR } from "./utils.js";

const TOOLS = [
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
];
const AGENT_TOOLS = [
  "self_get_identity",
  "self_deregister_agent",
  "self_sign_request",
  "self_authenticated_fetch",
];

let client: Client;
const fetchMock = vi.fn();

/**
 * Connect a fresh client to a server built from `config`.
 *
 * @param config - Server config to use.
 * @returns The connected client.
 */
async function connect(config = testConfig): Promise<Client> {
  const { server } = createServer(config);
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const c = new Client({ name: "test", version: "0.0.0" });
  await c.connect(clientTransport);
  return c;
}

/**
 * Read the first text block of a callTool result.
 *
 * @param result - callTool's return value.
 * @returns The text.
 */
function firstText(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

describe("MCP server", () => {
  beforeEach(async () => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    client = await connect();
  });
  afterEach(async () => {
    await client.close();
    vi.unstubAllGlobals();
  });

  it("reports the package version", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8"));
    expect(client.getServerVersion()).toEqual({
      name: "self-agent-id",
      version: pkg.version,
    });
  });

  // ponytail: compares tool names only; compare input schemas too if they drift.
  it("registers the same tools as the hosted server (app/app/api/mcp)", () => {
    const hosted = readFileSync("../app/app/api/mcp/route.ts", "utf8");
    const names = [...hosted.matchAll(/server\.tool\(\s*"(self_\w+)"/g)].map(
      (m) => m[1],
    );
    expect(names.sort()).toEqual([...TOOLS].sort());
  });

  it("lists the 10 tools, defaulting network to the configured one", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    for (const tool of tools) {
      const needsKey = AGENT_TOOLS.includes(tool.name);
      expect(tool.description).toContain(
        needsKey ? "requires SELF_AGENT_PRIVATE_KEY" : "No agent key needed",
      );
      const network = (
        tool.inputSchema.properties as Record<string, { default?: string }>
      ).network;
      if (network) expect(network.default).toBe("testnet");
    }
    const verify = tools.find((t) => t.name === "self_verify_agent")!;
    const props = verify.inputSchema.properties as Record<
      string,
      { default?: unknown }
    >;
    expect(props.max_agents_per_human.default).toBe(1);
    expect(props.require_self_provider.default).toBe(true);
    const verifyRequest = tools.find((t) => t.name === "self_verify_request")!;
    expect(verifyRequest.description).toContain("ECDSA (secp256k1)");
  });

  it("returns the setup hint from agent tools when no key is set", async () => {
    const args: Record<string, Record<string, unknown>> = {
      self_get_identity: {},
      self_deregister_agent: {},
      self_sign_request: { method: "GET", url: "https://example.com" },
      self_authenticated_fetch: { method: "GET", url: "https://example.com" },
    };
    for (const name of AGENT_TOOLS) {
      const result = await client.callTool({ name, arguments: args[name] });
      expect(result.isError).toBe(true);
      expect(firstText(result)).toBe(NO_AGENT_KEY_ERROR);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates addresses in the schema before calling the API", async () => {
    const result = await client.callTool({
      name: "self_list_agents_for_human",
      arguments: { human_address: "0x00/../../foo" },
    });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("Input validation error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls the REST API with schema defaults applied", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ stage: "qr-ready", sessionToken: "t2" })),
    );
    const result = await client.callTool({
      name: "self_check_registration",
      arguments: { session_token: "t1" },
    });
    expect(JSON.parse(firstText(result))).toMatchObject({
      stage: "qr-ready",
      session_token: "t2",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves the networks and identity resources", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual([
      "self://identity",
      "self://networks",
    ]);
    const networks = JSON.parse(
      (
        (await client.readResource({ uri: "self://networks" })).contents[0] as {
          text: string;
        }
      ).text,
    );
    expect(networks).toMatchObject({
      current_network: "testnet",
      api_base: "https://api.example",
      networks: {
        mainnet: { chain_id: 42220 },
        testnet: { chain_id: 11142220 },
      },
    });
    const identity = JSON.parse(
      (
        (await client.readResource({ uri: "self://identity" })).contents[0] as {
          text: string;
        }
      ).text,
    );
    expect(identity).toEqual({ error: true, message: NO_AGENT_KEY_ERROR });
  });

  it("serves the integration prompt with current SDK method names", async () => {
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["self_integrate_verification"]);
    const prompt = await client.getPrompt({
      name: "self_integrate_verification",
      arguments: { framework: "Hono" },
    });
    const text = (prompt.messages[0].content as { text: string }).text;
    expect(text).toContain("my Hono API");
    expect(text).toContain("verifier.verify(");
    expect(text).not.toContain("verifyRequest(");
  });
});
