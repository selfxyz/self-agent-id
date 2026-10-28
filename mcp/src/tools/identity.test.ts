// SPDX-License-Identifier: MIT

/** Tests for the identity tools: register, check registration, get identity, deregister. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reply, testConfig as config, textOf } from "../test/helpers.js";
import { INVALID_HUMAN_ADDRESS_ERROR, NO_AGENT_KEY_ERROR } from "../utils.js";

const selfAgentCtorMock = vi.fn();
vi.mock("@selfxyz/agent-sdk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@selfxyz/agent-sdk")>()),
  SelfAgent: selfAgentCtorMock,
}));

const {
  handleCheckRegistration,
  handleDeregisterAgent,
  handleGetIdentity,
  handleRegisterAgent,
} = await import("./identity.js");

const fetchMock = vi.fn();
// Hardhat test account #1 (public test key).
const KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const KEY_ADDRESS = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

type Content = Array<{ type: string; data?: string }>;

describe("identity tools", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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
      expect(init.method).toBe("POST");
      expect(JSON.parse(init.body)).toEqual({
        mode: "wallet-free",
        network: "testnet",
        disclosures: { minimumAge: 18 },
      });
      expect((result as { content: Content }).content[0]).toEqual({
        type: "image",
        data: "png",
        mimeType: "image/png",
      });
      expect(textOf(result).json).toMatchObject({
        session_token: "tok",
        agent_address: "0xagent",
        deep_link: "https://redirect.self.xyz?x",
        scan_url: "https://api.example/api/qr/qrtok",
        expires_at: "2030-01-01T00:00:00.000Z",
        human_instructions: ["Scan it"],
        mode: "wallet-free",
      });
    });

    it("uses linked mode with a checksummed human_address", async () => {
      fetchMock.mockResolvedValue(reply(200, { deepLink: "dl" }));
      const human = "0x526e35be30ea29c0ca5dd45263fdc635833947af";
      const result = await handleRegisterAgent(
        { human_address: human, network: "mainnet", ofac: true },
        config,
      );
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        mode: "linked",
        humanAddress: "0x526E35be30ea29c0ca5Dd45263fdc635833947aF",
        network: "mainnet",
        disclosures: { ofac: true },
      });
      // No qrImageBase64: text only, and no scan URL is invented.
      const content = (result as { content: Content }).content;
      expect(content).toHaveLength(1);
      expect(textOf(result).json.scan_url).toBeUndefined();
    });

    it("rejects a malformed human_address without calling the API", async () => {
      for (const human_address of [
        "0x1234",
        "0x526e35be30ea29c0ca5Dd45263fdc635833947aF",
        "0x0000000000000000000000000000000000000000",
      ]) {
        expect(
          textOf(await handleRegisterAgent({ human_address }, config)),
        ).toMatchObject({ isError: true, text: INVALID_HUMAN_ADDRESS_ERROR });
      }
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns an error result with the API error message", async () => {
      fetchMock.mockResolvedValue(reply(400, { error: "Invalid mode" }));
      const result = textOf(await handleRegisterAgent({}, config));
      expect(result).toMatchObject({
        isError: true,
        text: "Registration failed: Invalid mode",
      });
    });

    it("reports an unreachable API without echoing the error", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      fetchMock.mockRejectedValue(new Error("getaddrinfo secret"));
      expect(textOf(await handleRegisterAgent({}, config)).text).toBe(
        "Failed to initiate registration: API unreachable",
      );
    });
  });

  describe("self_check_registration", () => {
    it("polls with a Bearer token and maps qr-ready faithfully", async () => {
      fetchMock.mockResolvedValue(
        reply(200, {
          stage: "qr-ready",
          sessionToken: "tok2",
          expiresAt: "2030-01-01T00:00:00.000Z",
        }),
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
      // The token never goes in the URL.
      expect(fetchMock.mock.calls[0][0]).not.toContain("tok1");
      expect(result.json).toMatchObject({
        stage: "qr-ready",
        session_token: "tok2",
        expires_at: "2030-01-01T00:00:00.000Z",
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
    });

    it("maps HTTP 410 to the expired stage", async () => {
      fetchMock.mockResolvedValue(reply(410, { error: "Session expired" }));
      const result = textOf(
        await handleCheckRegistration({ session_token: "t" }, config),
      );
      expect(result.isError).toBeUndefined();
      expect(result.json.stage).toBe("expired");
    });

    it("returns other API errors as tool errors", async () => {
      fetchMock.mockResolvedValue(
        reply(401, { error: "Invalid session token" }),
      );
      expect(
        textOf(await handleCheckRegistration({ session_token: "t" }, config)),
      ).toMatchObject({
        isError: true,
        text: "Failed to check registration: Invalid session token",
      });
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
        agent_address: "0xagent",
        session_token: "tok2",
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

    it("reports a failed export as a tool error", async () => {
      fetchMock
        .mockResolvedValueOnce(
          reply(200, { stage: "completed", sessionToken: "tok2" }),
        )
        .mockResolvedValueOnce(reply(409, { error: "Not completed" }));
      expect(
        textOf(
          await handleCheckRegistration(
            { session_token: "tok1", reveal_private_key: true },
            config,
          ),
        ),
      ).toMatchObject({
        isError: true,
        text: "Failed to export agent key: Not completed",
      });
    });

    it("never logs the session token when the API is unreachable", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      fetchMock.mockRejectedValue(new Error("failed for token tok-secret"));
      const result = textOf(
        await handleCheckRegistration({ session_token: "tok-secret" }, config),
      );
      expect(result.text).toBe(
        "Failed to check registration status: API unreachable",
      );
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("tok-secret");
    });
  });

  describe("self_get_identity", () => {
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

    beforeEach(() => {
      selfAgentCtorMock.mockReset();
      selfAgentCtorMock.mockImplementation(function () {
        return {
          address: "0xagent",
          getInfo: async () => info,
          getCredentials: async () => ({ olderThan: 18n }),
          getVerificationStrength: async () => 100,
        };
      });
    });

    it("needs an agent key", async () => {
      expect(textOf(await handleGetIdentity({}, config))).toMatchObject({
        isError: true,
        text: NO_AGENT_KEY_ERROR,
      });
      expect(selfAgentCtorMock).not.toHaveBeenCalled();
    });

    it("uses the RPC of the requested network and requires a fresh proof", async () => {
      const keyed = { ...config, privateKey: KEY };
      const mainnet = textOf(
        await handleGetIdentity({ network: "mainnet" }, keyed),
      );
      expect(selfAgentCtorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          network: "mainnet",
          rpcUrl: "https://forno.celo.org",
        }),
      );
      expect(mainnet.json).toMatchObject({
        registered: true,
        agentId: 3,
        isVerified: false,
        nullifier: (2n ** 200n).toString(),
        proofExpiresAt: "2023-11-14T22:13:20.000Z",
        credentials_summary: "Not verified (no fresh human proof)",
        network: "mainnet",
      });

      await handleGetIdentity({}, keyed);
      expect(selfAgentCtorMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          network: "testnet",
          rpcUrl: "https://custom-rpc.example",
        }),
      );
    });

    it("reports an unregistered key", async () => {
      selfAgentCtorMock.mockImplementation(function () {
        return {
          address: "0xagent",
          getInfo: async () => ({ ...info, agentId: 0n }),
        };
      });
      const out = textOf(
        await handleGetIdentity({}, { ...config, privateKey: KEY }),
      );
      expect(out.json).toMatchObject({ registered: false, address: "0xagent" });
    });

    it("never echoes or logs the error text (ethers echoes bad keys)", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      selfAgentCtorMock.mockImplementation(function () {
        throw Object.assign(new TypeError(`invalid private key ${KEY}`), {
          code: "INVALID_ARGUMENT",
        });
      });
      const out = textOf(
        await handleGetIdentity({}, { ...config, privateKey: KEY }),
      );
      expect(out.text).toBe("Failed to get agent identity: RPC error");
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain(KEY.slice(2));
      expect(errorSpy.mock.calls[0][1]).toBe("TypeError (INVALID_ARGUMENT)");
    });
  });

  describe("self_deregister_agent", () => {
    it("needs an agent key", async () => {
      expect(textOf(await handleDeregisterAgent({}, config)).text).toBe(
        NO_AGENT_KEY_ERROR,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("starts deregistration for the configured key's address", async () => {
      fetchMock.mockResolvedValue(
        reply(200, {
          sessionToken: "d",
          deepLink: "dl",
          scanUrl: "https://api.example/api/qr/q",
          qrImageBase64: "png",
        }),
      );
      const result = await handleDeregisterAgent(
        {},
        { ...config, privateKey: KEY },
      );
      expect(fetchMock.mock.calls[0][0]).toBe(
        "https://api.example/api/agent/deregister",
      );
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
        network: "testnet",
        agentAddress: KEY_ADDRESS,
      });
      // The private key is never sent.
      expect(JSON.stringify(fetchMock.mock.calls)).not.toContain(KEY.slice(2));
      expect((result as { content: Content }).content[0].type).toBe("image");
      expect(textOf(result).json).toMatchObject({
        session_token: "d",
        scan_url: "https://api.example/api/qr/q",
        agent_address: KEY_ADDRESS,
      });
      expect(textOf(result).json.warning).toContain("IRREVERSIBLE");
    });

    it("returns the API error", async () => {
      fetchMock.mockResolvedValue(reply(404, { error: "Agent not found" }));
      expect(
        textOf(await handleDeregisterAgent({}, { ...config, privateKey: KEY }))
          .text,
      ).toBe("Deregistration failed: Agent not found");
    });
  });
});
