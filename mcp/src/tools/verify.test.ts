// SPDX-License-Identifier: MIT

/** Tests for the verify tools: self_verify_request and self_verify_agent. */

import { computeSigningMessage } from "@selfxyz/agent-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ethers } from "ethers";
import type { ServerConfig } from "../config.js";

const verifyMock = vi.fn();
const verifierCtorMock = vi.fn(function () {
  return { verify: verifyMock };
});
const registry = {
  getAgentId: vi.fn(),
  hasHumanProof: vi.fn(),
  isProofFresh: vi.fn(),
  proofExpiresAt: vi.fn(),
  getHumanNullifier: vi.fn(),
  getProofProvider: vi.fn(),
  selfProofProvider: vi.fn(),
  agentRegisteredAt: vi.fn(),
  getAgentCredentials: vi.fn(),
  getAgentCountForHuman: vi.fn(),
};
const typedRegistryMock = vi.fn((..._args: unknown[]) => registry);

const SELF_PROVIDER = "0x00000000000000000000000000000000000000Aa";

const baseConfig: ServerConfig = {
  privateKey: undefined,
  network: "testnet",
  rpcUrl: "https://custom-rpc.example",
  apiUrl: "https://api.example",
};

const wallet = ethers.Wallet.createRandom();

/**
 * Parse a successful MCP tool result's JSON text, asserting it is not a tool error.
 *
 * @param result - The tool handler's return value.
 * @returns The parsed JSON payload.
 */
function parse(result: unknown): Record<string, any> {
  const payload = result as {
    content: Array<{ text: string }>;
    isError?: boolean;
  };
  expect(payload.isError).toBeUndefined();
  return JSON.parse(payload.content[0].text);
}

/**
 * Build self_verify_request args for a GET signed by the test wallet.
 *
 * @param path - Request path that was signed (default "/v1/data").
 * @param timestamp - Signing timestamp in ms, as a string (default now).
 * @returns Tool args with agent address, signature and timestamp.
 */
function signedArgs(path = "/v1/data", timestamp = String(Date.now())) {
  const message = computeSigningMessage(timestamp, "GET", path, undefined);
  return {
    agent_address: wallet.address,
    agent_signature: wallet.signMessageSync(ethers.getBytes(message)),
    agent_timestamp: timestamp,
    method: "GET",
    path,
  };
}

/**
 * Re-import the verify handlers with fresh module state (empty replay cache)
 * over the mocked SDK verifier and registry.
 *
 * @returns The verify handlers module.
 */
async function loadModule() {
  vi.resetModules();
  vi.doMock("@selfxyz/agent-sdk", async () => ({
    // Real signing-message helper; only the verifier and networks are faked.
    computeSigningMessage: (
      await vi.importActual<typeof import("@selfxyz/agent-sdk")>(
        "@selfxyz/agent-sdk",
      )
    ).computeSigningMessage,
    SelfAgentVerifier: verifierCtorMock,
    NETWORKS: {
      mainnet: {
        rpcUrl: "https://mainnet-rpc.example",
        registryAddress: "0x1",
      },
      testnet: {
        rpcUrl: "https://testnet-rpc.example",
        registryAddress: "0x2",
      },
    },
    isProofExpiringSoon: () => false,
    typedRegistry: typedRegistryMock,
  }));
  return import("./verify.js");
}

describe("self_verify_request", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    verifyMock.mockResolvedValue({
      valid: true,
      agentAddress: wallet.address,
      agentId: 12n,
      agentCount: 1n,
      credentials: { nationality: "\0\0\0", olderThan: 18n, ofac: [true] },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts a fresh signed request and states the replay scope", async () => {
    const { handleVerifyRequest } = await loadModule();
    const payload = parse(await handleVerifyRequest(signedArgs(), baseConfig));

    expect(payload).toMatchObject({
      valid: true,
      agent_address: wallet.address,
      agent_id: 12,
      credentials: { older_than: 18, ofac_clear: true },
      network: "testnet",
    });
    expect(payload.credentials.nationality).toBeNull();
    expect(payload.note).toContain("this MCP server process");
    // SDK replay cache is bypassable, so it is disabled in favour of ours.
    expect(verifierCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        enableReplayProtection: false,
        requireSelfProvider: true,
        maxAgentsPerHuman: 1,
        rpcUrl: "https://custom-rpc.example",
      }),
    );
  });

  it("rejects replays, including re-encoded signatures of the same request", async () => {
    const { handleVerifyRequest } = await loadModule();
    const args = signedArgs();
    const sig = ethers.Signature.from(args.agent_signature);
    const vZeroOne =
      args.agent_signature.slice(0, -2) +
      (sig.v - 27).toString(16).padStart(2, "0");

    expect(parse(await handleVerifyRequest(args, baseConfig)).valid).toBe(true);
    for (const agent_signature of [
      args.agent_signature,
      args.agent_signature.toUpperCase().replace("0X", "0x"),
      vZeroOne,
      sig.compactSerialized,
    ]) {
      const payload = parse(
        await handleVerifyRequest({ ...args, agent_signature }, baseConfig),
      );
      expect(payload).toMatchObject({
        valid: false,
        reason: "Replay detected",
      });
    }
    // Replays are rejected before any on-chain lookup.
    expect(verifyMock).toHaveBeenCalledTimes(1);
  });

  it("allows disabling replay protection via env override", async () => {
    vi.stubEnv("MCP_VERIFY_REQUEST_REPLAY_PROTECTION", "false");
    const { handleVerifyRequest } = await loadModule();
    const args = signedArgs();
    await handleVerifyRequest(args, baseConfig);
    const payload = parse(await handleVerifyRequest(args, baseConfig));
    expect(payload.valid).toBe(true);
    expect(payload.note).toContain("disabled");
  });

  it("rejects timestamps in the future beyond a small skew", async () => {
    const { handleVerifyRequest } = await loadModule();
    const future = parse(
      await handleVerifyRequest(
        signedArgs("/a", String(Date.now() + 120_000)),
        baseConfig,
      ),
    );
    expect(future.valid).toBe(false);
    const skewed = parse(
      await handleVerifyRequest(
        signedArgs("/b", String(Date.now() + 10_000)),
        baseConfig,
      ),
    );
    expect(skewed.valid).toBe(true);
  });

  it("returns valid:false (not a tool error) for an invalid claimed address", async () => {
    const { handleVerifyRequest } = await loadModule();
    const payload = parse(
      await handleVerifyRequest(
        { ...signedArgs(), agent_address: "0xnot-an-address" },
        baseConfig,
      ),
    );
    expect(payload.valid).toBe(false);
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("rejects Ed25519-style and malformed signatures without an RPC call", async () => {
    const { handleVerifyRequest } = await loadModule();
    // A 64-byte Ed25519 signature parses as compact ECDSA but recovers to a
    // different address.
    const ed25519 = parse(
      await handleVerifyRequest(
        { ...signedArgs(), agent_signature: "0x" + "ab".repeat(64) },
        baseConfig,
      ),
    );
    expect(ed25519.valid).toBe(false);
    expect(ed25519.reason).toContain(
      "does not match recovered signature signer",
    );
    const malformed = parse(
      await handleVerifyRequest(
        { ...signedArgs(), agent_signature: "0x1234" },
        baseConfig,
      ),
    );
    expect(malformed).toMatchObject({
      valid: false,
      reason: "Invalid signature.",
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("returns a fixed tool error when the RPC fails", async () => {
    const { handleVerifyRequest } = await loadModule();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    verifyMock.mockRejectedValueOnce(new Error("rpc https://key@rpc"));
    const result = (await handleVerifyRequest(signedArgs(), baseConfig)) as {
      content: Array<{ text: string }>;
      isError?: boolean;
    };
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0].text).toBe("Failed to verify request: RPC error");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("key@rpc");
    errorSpy.mockRestore();
  });

  it("rejects a claimed address that does not match the recovered signer", async () => {
    const { handleVerifyRequest } = await loadModule();
    const payload = parse(
      await handleVerifyRequest(
        {
          ...signedArgs(),
          agent_address: ethers.Wallet.createRandom().address,
        },
        baseConfig,
      ),
    );
    expect(payload.valid).toBe(false);
    expect(payload.reason).toContain(
      "does not match recovered signature signer",
    );
  });

  it("does not record requests the verifier rejects", async () => {
    const { handleVerifyRequest } = await loadModule();
    const args = signedArgs();
    verifyMock.mockResolvedValueOnce({
      valid: false,
      error: "Agent not verified on-chain",
    });
    expect(parse(await handleVerifyRequest(args, baseConfig)).reason).toBe(
      "Agent not verified on-chain",
    );
    expect(parse(await handleVerifyRequest(args, baseConfig)).valid).toBe(true);
  });

  it("applies the requested network and policy", async () => {
    const { handleVerifyRequest } = await loadModule();
    await handleVerifyRequest(
      {
        ...signedArgs(),
        network: "mainnet",
        require_age: 18,
        require_ofac: true,
        require_self_provider: false,
        max_agents_per_human: 0,
      },
      baseConfig,
    );
    expect(verifierCtorMock).toHaveBeenCalledWith(
      expect.objectContaining({
        network: "mainnet",
        rpcUrl: "https://mainnet-rpc.example",
        minimumAge: 18,
        requireOFACPassed: true,
        requireSelfProvider: false,
        maxAgentsPerHuman: 0,
      }),
    );
  });

  it("fails closed when the replay cache is full of live entries", async () => {
    const { recordRequest } = await loadModule();
    const live = Date.now() + 60_000;
    for (let i = 0; i < 10_000; i++) {
      expect(recordRequest(`k${i}`, live)).toBeNull();
    }
    expect(recordRequest("new", live)).toBe(
      "Replay cache is full; retry shortly",
    );
    // Existing live entries are never evicted.
    expect(recordRequest("k0", live)).toBe("Replay detected");
  });

  it("prunes expired entries before refusing", async () => {
    const { recordRequest } = await loadModule();
    for (let i = 0; i < 10_000; i++) {
      recordRequest(`k${i}`, Date.now() - 1);
    }
    expect(recordRequest("new", Date.now() + 60_000)).toBeNull();
  });
});

describe("self_verify_agent", () => {
  const agent = "0x00000000000000000000000000000000000000bb";

  beforeEach(() => {
    registry.getAgentId.mockResolvedValue(5n);
    registry.hasHumanProof.mockResolvedValue(true);
    registry.isProofFresh.mockResolvedValue(true);
    registry.proofExpiresAt.mockResolvedValue(0n);
    registry.getHumanNullifier.mockResolvedValue(99n);
    registry.getProofProvider.mockResolvedValue(SELF_PROVIDER);
    registry.selfProofProvider.mockResolvedValue(SELF_PROVIDER);
    registry.agentRegisteredAt.mockResolvedValue(100n);
    registry.getAgentCredentials.mockResolvedValue({
      nationality: "\0\0\0",
      olderThan: 21n,
      ofac: [true, false, false],
    });
    registry.getAgentCountForHuman.mockResolvedValue(1n);
  });

  it("verifies a fresh, Self-provided, single-agent human", async () => {
    const { handleVerifyAgent } = await loadModule();
    const payload = parse(
      await handleVerifyAgent({ agent_address: agent }, baseConfig),
    );
    expect(payload).toMatchObject({
      verified: true,
      agent_id: 5,
      sybil_count: 1,
      credentials: { older_than: 21, ofac_clear: true },
    });
    expect(payload.credentials.nationality).toBeNull();
  });

  it("applies the same default sybil limit as self_verify_request", async () => {
    registry.getAgentCountForHuman.mockResolvedValue(3n);
    const { handleVerifyAgent } = await loadModule();
    const limited = parse(
      await handleVerifyAgent({ agent_address: agent }, baseConfig),
    );
    expect(limited.verified).toBe(false);
    expect(limited.reason).toContain("Human has 3 agents (max 1)");

    const unlimited = parse(
      await handleVerifyAgent(
        { agent_address: agent, max_agents_per_human: 0 },
        baseConfig,
      ),
    );
    expect(unlimited.verified).toBe(true);
  });

  it("reports not verified when the proof is stale or missing", async () => {
    registry.isProofFresh.mockResolvedValue(false);
    const { handleVerifyAgent } = await loadModule();
    expect(
      parse(await handleVerifyAgent({ agent_address: agent }, baseConfig))
        .verified,
    ).toBe(false);

    registry.hasHumanProof.mockResolvedValue(false);
    const missing = parse(
      await handleVerifyAgent({ agent_address: agent }, baseConfig),
    );
    expect(missing.reason).toContain("no proof-of-human");
  });

  it("returns a validation error (not an RPC error) for a malformed address", async () => {
    const { handleVerifyAgent } = await loadModule();
    registry.getAgentId.mockClear();
    for (const agent_address of [
      "0x123",
      "0x00000000000000000000000000000000000000Bb", // bad checksum
      "0x0000000000000000000000000000000000000000",
    ]) {
      const result = (await handleVerifyAgent(
        { agent_address },
        baseConfig,
      )) as { content: Array<{ text: string }>; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/^Invalid agent_address/);
    }
    expect(registry.getAgentId).not.toHaveBeenCalled();
  });

  it("reports unregistered agents and uses the requested network", async () => {
    registry.getAgentId.mockResolvedValue(0n);
    const { handleVerifyAgent } = await loadModule();
    const payload = parse(
      await handleVerifyAgent(
        { agent_address: agent, network: "mainnet" },
        baseConfig,
      ),
    );
    expect(payload).toMatchObject({ verified: false, network: "mainnet" });
    expect(typedRegistryMock.mock.calls.at(-1)?.[0]).toBe("0x1");
  });
});
