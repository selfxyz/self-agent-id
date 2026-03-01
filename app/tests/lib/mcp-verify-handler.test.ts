import { afterEach, describe, expect, it, vi } from "vitest";
import type { McpConfig } from "@/lib/mcp/config";

type VerifyResponse = {
  valid: boolean;
  agentAddress: string;
  agentId: bigint;
  agentCount: bigint;
  credentials?: {
    nationality?: string;
    olderThan: bigint;
    ofac?: boolean[];
  };
  error?: string;
};

const verifyMock = vi.fn<[], Promise<VerifyResponse>>();
const buildMock = vi.fn(() => ({ verify: verifyMock }));
const replayProtectionMock = vi.fn(() => ({ build: buildMock }));
const includeCredentialsMock = vi.fn(() => ({
  replayProtection: replayProtectionMock,
}));
const rpcMock = vi.fn(() => ({ includeCredentials: includeCredentialsMock }));
const networkMock = vi.fn(() => ({ rpc: rpcMock }));
const createMock = vi.fn(() => ({ network: networkMock }));

const baseConfig: McpConfig = {
  privateKey: undefined,
  network: "testnet",
  rpcUrl: "https://rpc.example",
  apiUrl: "https://api.example",
  registryAddress: "0x0000000000000000000000000000000000000000",
};

function parseToolPayload(result: unknown): Record<string, unknown> {
  const payload = result as {
    content?: Array<{ text?: string }>;
    isError?: boolean;
  };
  const text = payload.content?.[0]?.text || "{}";
  return JSON.parse(text) as Record<string, unknown>;
}

async function loadModule() {
  vi.resetModules();
  verifyMock.mockReset();
  buildMock.mockClear();
  replayProtectionMock.mockClear();
  includeCredentialsMock.mockClear();
  rpcMock.mockClear();
  networkMock.mockClear();
  createMock.mockClear();

  vi.doMock("@selfxyz/agent-sdk", () => ({
    SelfAgentVerifier: { create: createMock },
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
  }));

  return import("@/lib/mcp/handlers/verify");
}

describe("mcp verify handler", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("enables replay protection by default", async () => {
    const { handleVerifyRequest } = await loadModule();
    verifyMock.mockResolvedValue({
      valid: true,
      agentAddress: "0x00000000000000000000000000000000000000aa",
      agentId: 12n,
      agentCount: 1n,
      credentials: { olderThan: 18n, ofac: [true] },
    });

    const result = await handleVerifyRequest(
      {
        agent_address: "0x00000000000000000000000000000000000000AA",
        agent_signature: "0xsig",
        agent_timestamp: "1700000000000",
        method: "GET",
        path: "/v1/data",
      },
      baseConfig,
    );

    expect(replayProtectionMock).toHaveBeenCalledWith(true);
    const payload = parseToolPayload(result);
    expect(payload.valid).toBe(true);
    expect(String(payload.note)).toContain("Replay protection is enabled");
  });

  it("allows disabling replay protection via env override", async () => {
    vi.stubEnv("MCP_VERIFY_REQUEST_REPLAY_PROTECTION", "false");
    const { handleVerifyRequest } = await loadModule();
    verifyMock.mockResolvedValue({
      valid: true,
      agentAddress: "0x00000000000000000000000000000000000000aa",
      agentId: 12n,
      agentCount: 1n,
      credentials: { olderThan: 18n, ofac: [true] },
    });

    const result = await handleVerifyRequest(
      {
        agent_address: "0x00000000000000000000000000000000000000AA",
        agent_signature: "0xsig",
        agent_timestamp: "1700000000000",
        method: "GET",
        path: "/v1/data",
      },
      baseConfig,
    );

    expect(replayProtectionMock).toHaveBeenCalledWith(false);
    const payload = parseToolPayload(result);
    expect(payload.valid).toBe(true);
    expect(String(payload.note)).toContain("not enforced");
  });

  it("rejects mismatched claimed address vs recovered signer", async () => {
    const { handleVerifyRequest } = await loadModule();
    verifyMock.mockResolvedValue({
      valid: true,
      agentAddress: "0x00000000000000000000000000000000000000bb",
      agentId: 12n,
      agentCount: 1n,
      credentials: { olderThan: 18n, ofac: [true] },
    });

    const result = await handleVerifyRequest(
      {
        agent_address: "0x00000000000000000000000000000000000000AA",
        agent_signature: "0xsig",
        agent_timestamp: "1700000000000",
        method: "GET",
        path: "/v1/data",
      },
      baseConfig,
    );

    const payload = parseToolPayload(result);
    expect(payload.valid).toBe(false);
    expect(String(payload.reason)).toContain(
      "does not match recovered signature signer",
    );
  });

  it("reuses verifier instance for repeated requests with same config", async () => {
    const { handleVerifyRequest } = await loadModule();
    verifyMock.mockResolvedValue({
      valid: true,
      agentAddress: "0x00000000000000000000000000000000000000aa",
      agentId: 12n,
      agentCount: 1n,
      credentials: { olderThan: 18n, ofac: [true] },
    });

    const args = {
      agent_address: "0x00000000000000000000000000000000000000AA",
      agent_signature: "0xsig",
      agent_timestamp: "1700000000000",
      method: "GET",
      path: "/v1/data",
    } as const;

    await handleVerifyRequest(args, baseConfig);
    await handleVerifyRequest(args, baseConfig);

    expect(createMock).toHaveBeenCalledTimes(1);
    expect(buildMock).toHaveBeenCalledTimes(1);
    expect(verifyMock).toHaveBeenCalledTimes(2);
  });
});
