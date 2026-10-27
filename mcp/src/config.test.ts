// SPDX-License-Identifier: MIT

/** Tests for loadConfig and rpcUrlFor. */

import { describe, expect, it } from "vitest";
import { loadConfig, rpcUrlFor } from "./config.js";

// Hardhat test account #0 (public test key).
const KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

describe("loadConfig", () => {
  it("defaults to mainnet, the SDK RPC and the hosted API, with no key", () => {
    expect(loadConfig({})).toEqual({
      privateKey: undefined,
      network: "mainnet",
      rpcUrl: "https://forno.celo.org",
      apiUrl: "https://agent-api.self.xyz",
    });
  });

  it("reads SELF_AGENT_NETWORK, falling back to the older SELF_NETWORK", () => {
    expect(loadConfig({ SELF_AGENT_NETWORK: "testnet" }).network).toBe(
      "testnet",
    );
    expect(loadConfig({ SELF_NETWORK: "testnet" })).toMatchObject({
      network: "testnet",
      rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
    });
    expect(
      loadConfig({ SELF_AGENT_NETWORK: "mainnet", SELF_NETWORK: "testnet" })
        .network,
    ).toBe("mainnet");
  });

  it("rejects an unknown network", () => {
    expect(() => loadConfig({ SELF_AGENT_NETWORK: "goerli" })).toThrow(
      'Invalid SELF_AGENT_NETWORK: "goerli"',
    );
  });

  it("applies SELF_RPC_URL and SELF_AGENT_API_BASE (trailing slashes trimmed)", () => {
    expect(
      loadConfig({
        SELF_RPC_URL: "https://my-rpc.example",
        SELF_AGENT_API_BASE: "http://localhost:3000//",
      }),
    ).toMatchObject({
      rpcUrl: "https://my-rpc.example",
      apiUrl: "http://localhost:3000",
    });
  });

  it("rejects a non-http(s) API base", () => {
    for (const base of ["ftp://x.example", "not a url"]) {
      expect(() => loadConfig({ SELF_AGENT_API_BASE: base })).toThrow(
        "Invalid SELF_AGENT_API_BASE",
      );
    }
  });

  it("accepts a valid private key", () => {
    expect(loadConfig({ SELF_AGENT_PRIVATE_KEY: ` ${KEY}\n` }).privateKey).toBe(
      KEY,
    );
  });

  it("rejects an invalid private key without echoing it", () => {
    const bad = "0x" + "zz".repeat(32);
    let message = "";
    try {
      loadConfig({ SELF_AGENT_PRIVATE_KEY: bad });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("Invalid SELF_AGENT_PRIVATE_KEY");
    expect(message).not.toContain("zzzz");
  });
});

describe("rpcUrlFor", () => {
  it("uses SELF_RPC_URL only for the configured network", () => {
    const config = loadConfig({
      SELF_AGENT_NETWORK: "testnet",
      SELF_RPC_URL: "https://my-rpc.example",
    });
    expect(rpcUrlFor(config, "testnet")).toBe("https://my-rpc.example");
    expect(rpcUrlFor(config, "mainnet")).toBe("https://forno.celo.org");
  });
});
