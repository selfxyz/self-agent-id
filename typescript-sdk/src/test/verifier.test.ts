// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { SelfAgentVerifier } from "../SelfAgentVerifier";
import { SelfAgent } from "../SelfAgent";
import { HEADERS } from "../constants";

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const SELF_PROVIDER = "0x1111111111111111111111111111111111111111";
const TEST_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FAKE_REGISTRY = "0x0000000000000000000000000000000000000001";
const FAKE_RPC = "http://localhost:8545";

// Derived from TEST_KEY
const TEST_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TEST_AGENT_KEY = ethers.zeroPadValue(TEST_ADDRESS, 32);

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function createMockRegistry(
  overrides: Partial<{
    isVerifiedAgent: (key: string) => Promise<boolean>;
    getAgentId: (key: string) => Promise<bigint>;
    getHumanNullifier: (id: bigint) => Promise<bigint>;
    getAgentCountForHuman: (nullifier: bigint) => Promise<bigint>;
    getProofProvider: (id: bigint) => Promise<string>;
    selfProofProvider: () => Promise<string>;
    getAgentCredentials: (id: bigint) => Promise<any>;
  }> = {}
) {
  return {
    isVerifiedAgent: overrides.isVerifiedAgent ?? (async () => true),
    getAgentId: overrides.getAgentId ?? (async () => 1n),
    getHumanNullifier: overrides.getHumanNullifier ?? (async () => 123n),
    getAgentCountForHuman:
      overrides.getAgentCountForHuman ?? (async () => 1n),
    getProofProvider:
      overrides.getProofProvider ?? (async () => SELF_PROVIDER),
    selfProofProvider:
      overrides.selfProofProvider ?? (async () => SELF_PROVIDER),
    getAgentCredentials:
      overrides.getAgentCredentials ??
      (async () => ({
        issuingState: "US",
        name: ["Test"],
        idNumber: "",
        nationality: "US",
        dateOfBirth: "1990-01-01",
        gender: "M",
        expiryDate: "2030-01-01",
        olderThan: 30n,
        ofac: [true, false, false],
      })),
  };
}

function createVerifierWithMock(
  config: Record<string, any> = {},
  registryOverrides: Record<string, any> = {}
): SelfAgentVerifier {
  const verifier = new SelfAgentVerifier({
    registryAddress: FAKE_REGISTRY,
    rpcUrl: FAKE_RPC,
    requireSelfProvider: true,
    ...config,
  });
  (verifier as any).registry = createMockRegistry(registryOverrides);
  return verifier;
}

function createAgent(): SelfAgent {
  return new SelfAgent({
    privateKey: TEST_KEY,
    registryAddress: FAKE_REGISTRY,
    rpcUrl: FAKE_RPC,
  });
}

async function signAndVerify(
  verifier: SelfAgentVerifier,
  overrides: Partial<{
    method: string;
    url: string;
    body: string | undefined;
    signature: string;
    timestamp: string;
  }> = {}
) {
  const agent = createAgent();
  const method = overrides.method ?? "POST";
  const url = overrides.url ?? "/api/test";
  const body = overrides.body !== undefined ? overrides.body : '{"data":true}';

  const headers = await agent.signRequest(method, url, body ?? undefined);

  return verifier.verify({
    signature: overrides.signature ?? headers[HEADERS.SIGNATURE],
    timestamp: overrides.timestamp ?? headers[HEADERS.TIMESTAMP],
    method,
    url,
    body: body ?? undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SelfAgentVerifier", () => {
  // ── 1. Valid signature verification ──────────────────────────────────

  describe("valid signature verification", () => {
    it("accepts a correctly signed request from a verified agent", async () => {
      const verifier = createVerifierWithMock();
      const result = await signAndVerify(verifier);

      assert.equal(result.valid, true);
      assert.equal(result.agentAddress, TEST_ADDRESS);
      assert.equal(result.agentKey, TEST_AGENT_KEY);
      assert.equal(result.agentId, 1n);
      assert.equal(result.agentCount, 1n);
      assert.equal(result.nullifier, 123n);
      assert.equal(result.error, undefined);
    });
  });

  // ── 2. Reject expired timestamp ─────────────────────────────────────

  describe("timestamp validation", () => {
    it("rejects a timestamp older than maxAgeMs", async () => {
      const verifier = createVerifierWithMock();
      const tenMinutesAgo = (Date.now() - 10 * 60 * 1000).toString();

      const result = await signAndVerify(verifier, {
        timestamp: tenMinutesAgo,
      });

      assert.equal(result.valid, false);
      assert.equal(result.error, "Timestamp expired or invalid");
      assert.equal(result.agentAddress, ethers.ZeroAddress);
    });

    // ── 3. Reject future timestamp ──────────────────────────────────────

    it("rejects a timestamp in the future beyond maxAgeMs", async () => {
      const verifier = createVerifierWithMock();
      const tenMinutesFuture = (Date.now() + 10 * 60 * 1000).toString();

      const result = await signAndVerify(verifier, {
        timestamp: tenMinutesFuture,
      });

      assert.equal(result.valid, false);
      assert.equal(result.error, "Timestamp expired or invalid");
    });
  });

  // ── 4. Reject invalid signature ─────────────────────────────────────

  describe("signature validation", () => {
    it("rejects garbage signature data", async () => {
      const verifier = createVerifierWithMock();

      const result = await signAndVerify(verifier, {
        signature: "0xdeadbeef",
      });

      assert.equal(result.valid, false);
      assert.equal(result.error, "Invalid signature");
    });
  });

  // ── 5. Reject unverified agent ──────────────────────────────────────

  describe("on-chain verification", () => {
    it("rejects an agent not verified on-chain", async () => {
      const verifier = createVerifierWithMock(
        {},
        { isVerifiedAgent: async () => false }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, false);
      assert.equal(result.error, "Agent not verified on-chain");
      assert.equal(result.agentAddress, TEST_ADDRESS);
      assert.equal(result.agentKey, TEST_AGENT_KEY);
    });
  });

  // ── 6. Reject provider mismatch ────────────────────────────────────

  describe("provider verification", () => {
    it("rejects when proof provider does not match selfProofProvider", async () => {
      const verifier = createVerifierWithMock(
        { requireSelfProvider: true },
        {
          getProofProvider: async () =>
            "0x2222222222222222222222222222222222222222",
        }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, false);
      assert.match(result.error!, /proof provider mismatch/);
    });
  });

  // ── 7. Reject sybil cap exceeded ───────────────────────────────────

  describe("sybil resistance", () => {
    it("rejects when human has more agents than maxAgentsPerHuman", async () => {
      const verifier = createVerifierWithMock(
        { maxAgentsPerHuman: 3 },
        { getAgentCountForHuman: async () => 5n }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, false);
      assert.match(result.error!, /5 agents.*max 3/);
    });

    // ── 8. Accept when sybil check disabled ─────────────────────────────

    it("accepts when maxAgentsPerHuman is 0 (disabled)", async () => {
      const verifier = createVerifierWithMock(
        { maxAgentsPerHuman: 0 },
        { getAgentCountForHuman: async () => 5n }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, true);
      assert.equal(result.agentAddress, TEST_ADDRESS);
    });
  });

  // ── 9. Replay protection ───────────────────────────────────────────

  describe("replay protection", () => {
    it("rejects a replayed signature", async () => {
      const verifier = createVerifierWithMock();
      const agent = createAgent();
      const headers = await agent.signRequest("POST", "/api/test", '{"data":true}');
      const params = {
        signature: headers[HEADERS.SIGNATURE],
        timestamp: headers[HEADERS.TIMESTAMP],
        method: "POST",
        url: "/api/test",
        body: '{"data":true}',
      };

      const first = await verifier.verify(params);
      assert.equal(first.valid, true);

      const second = await verifier.verify(params);
      assert.equal(second.valid, false);
      assert.equal(second.error, "Replay detected");
    });

    // ── 10. Replay protection disabled ──────────────────────────────────

    it("allows duplicate signatures when replay protection is disabled", async () => {
      const verifier = createVerifierWithMock({
        enableReplayProtection: false,
      });
      const agent = createAgent();
      const headers = await agent.signRequest("POST", "/api/test", '{"data":true}');
      const params = {
        signature: headers[HEADERS.SIGNATURE],
        timestamp: headers[HEADERS.TIMESTAMP],
        method: "POST",
        url: "/api/test",
        body: '{"data":true}',
      };

      const first = await verifier.verify(params);
      assert.equal(first.valid, true);

      const second = await verifier.verify(params);
      assert.equal(second.valid, true);
    });

    // ── 11. Invalid signature doesn't poison replay cache ───────────────

    it("invalid signature does not poison the replay cache", async () => {
      const verifier = createVerifierWithMock();
      const agent = createAgent();
      const headers = await agent.signRequest("POST", "/api/test", '{"data":true}');

      // First: send a bad signature (should fail with "Invalid signature")
      const badResult = await verifier.verify({
        signature: "0xdeadbeef",
        timestamp: headers[HEADERS.TIMESTAMP],
        method: "POST",
        url: "/api/test",
        body: '{"data":true}',
      });
      assert.equal(badResult.valid, false);
      assert.equal(badResult.error, "Invalid signature");

      // Now: send the valid signature (should succeed, NOT "Replay detected")
      const goodResult = await verifier.verify({
        signature: headers[HEADERS.SIGNATURE],
        timestamp: headers[HEADERS.TIMESTAMP],
        method: "POST",
        url: "/api/test",
        body: '{"data":true}',
      });
      assert.equal(goodResult.valid, true);
      assert.equal(goodResult.error, undefined);
    });
  });

  // ── 12–13. Rate limiting ───────────────────────────────────────────

  describe("rate limiting", () => {
    it("rejects when per-minute rate limit is exceeded", async () => {
      const verifier = createVerifierWithMock({
        rateLimitConfig: { perMinute: 2 },
        enableReplayProtection: false,
      });

      // First two requests should succeed
      const r1 = await signAndVerify(verifier);
      assert.equal(r1.valid, true);
      const r2 = await signAndVerify(verifier);
      assert.equal(r2.valid, true);

      // Third should be rate limited
      const r3 = await signAndVerify(verifier);
      assert.equal(r3.valid, false);
      assert.match(r3.error!, /Rate limit exceeded/);
    });

    it("returns retryAfterMs > 0 when rate limited", async () => {
      const verifier = createVerifierWithMock({
        rateLimitConfig: { perMinute: 1 },
        enableReplayProtection: false,
      });

      await signAndVerify(verifier);
      const limited = await signAndVerify(verifier);

      assert.equal(limited.valid, false);
      assert.equal(typeof limited.retryAfterMs, "number");
      assert.ok(limited.retryAfterMs! > 0, "retryAfterMs should be positive");
    });
  });

  // ── 14–18. Credential checks ──────────────────────────────────────

  describe("credential checks", () => {
    // ── 14. Minimum age rejected ──────────────────────────────────────

    it("rejects when agent does not meet minimum age", async () => {
      const verifier = createVerifierWithMock(
        { minimumAge: 18, includeCredentials: true },
        {
          getAgentCredentials: async () => ({
            issuingState: "US",
            name: ["Test"],
            idNumber: "",
            nationality: "US",
            dateOfBirth: "2010-01-01",
            gender: "M",
            expiryDate: "2030-01-01",
            olderThan: 16n,
            ofac: [true, false, false],
          }),
        }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, false);
      assert.match(result.error!, /minimum age.*required: 18.*got: 16/);
      assert.ok(result.credentials, "should include credentials in error result");
    });

    // ── 15. Age passes ────────────────────────────────────────────────

    it("accepts when agent meets minimum age", async () => {
      const verifier = createVerifierWithMock(
        { minimumAge: 18, includeCredentials: true },
        {
          getAgentCredentials: async () => ({
            issuingState: "US",
            name: ["Test"],
            idNumber: "",
            nationality: "US",
            dateOfBirth: "2000-01-01",
            gender: "M",
            expiryDate: "2030-01-01",
            olderThan: 21n,
            ofac: [true, false, false],
          }),
        }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, true);
    });

    // ── 16. OFAC required but not passed ──────────────────────────────

    it("rejects when OFAC required but not passed", async () => {
      const verifier = createVerifierWithMock(
        { requireOFACPassed: true, includeCredentials: true },
        {
          getAgentCredentials: async () => ({
            issuingState: "US",
            name: ["Test"],
            idNumber: "",
            nationality: "US",
            dateOfBirth: "1990-01-01",
            gender: "M",
            expiryDate: "2030-01-01",
            olderThan: 30n,
            ofac: [false, false, false],
          }),
        }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, false);
      assert.match(result.error!, /OFAC/);
    });

    // ── 17. Nationality not in allowed list ───────────────────────────

    it("rejects when nationality is not in the allowed list", async () => {
      const verifier = createVerifierWithMock(
        { allowedNationalities: ["US", "GB"], includeCredentials: true },
        {
          getAgentCredentials: async () => ({
            issuingState: "FR",
            name: ["Test"],
            idNumber: "",
            nationality: "FR",
            dateOfBirth: "1990-01-01",
            gender: "M",
            expiryDate: "2030-01-01",
            olderThan: 30n,
            ofac: [true, false, false],
          }),
        }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, false);
      assert.match(result.error!, /Nationality "FR" not in allowed list/);
    });

    // ── 18. Nationality passes ────────────────────────────────────────

    it("accepts when nationality is in the allowed list", async () => {
      const verifier = createVerifierWithMock(
        { allowedNationalities: ["US", "GB"], includeCredentials: true },
        {
          getAgentCredentials: async () => ({
            issuingState: "US",
            name: ["Test"],
            idNumber: "",
            nationality: "US",
            dateOfBirth: "1990-01-01",
            gender: "M",
            expiryDate: "2030-01-01",
            olderThan: 30n,
            ofac: [true, false, false],
          }),
        }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, true);
    });
  });

  // ── 19–20. Cache behavior ─────────────────────────────────────────

  describe("on-chain status cache", () => {
    it("second verify uses cache and does not call registry again", async () => {
      let callCount = 0;
      const verifier = createVerifierWithMock(
        { enableReplayProtection: false, cacheTtlMs: 60_000 },
        {
          isVerifiedAgent: async () => {
            callCount++;
            return true;
          },
        }
      );

      await signAndVerify(verifier);
      assert.equal(callCount, 1, "first call should hit the registry");

      await signAndVerify(verifier);
      assert.equal(callCount, 1, "second call should use cache");
    });

    // ── 20. clearCache resets state ─────────────────────────────────────

    it("clearCache causes the registry to be called again", async () => {
      let callCount = 0;
      const verifier = createVerifierWithMock(
        { enableReplayProtection: false, cacheTtlMs: 60_000 },
        {
          isVerifiedAgent: async () => {
            callCount++;
            return true;
          },
        }
      );

      await signAndVerify(verifier);
      assert.equal(callCount, 1);

      verifier.clearCache();

      await signAndVerify(verifier);
      assert.equal(callCount, 2, "after clearCache, registry should be called again");
    });
  });

  // ── 21. Provider RPC error fails closed ────────────────────────────

  describe("RPC error handling", () => {
    it("fails closed when selfProofProvider() throws an RPC error", async () => {
      const verifier = createVerifierWithMock(
        { requireSelfProvider: true },
        {
          selfProofProvider: async () => {
            throw new Error("network timeout");
          },
        }
      );

      const result = await signAndVerify(verifier);

      assert.equal(result.valid, false);
      assert.equal(
        result.error,
        "Unable to verify proof provider — RPC error"
      );
      assert.equal(result.agentAddress, TEST_ADDRESS);
    });
  });

  // ── 22–24. Express middleware auth() ───────────────────────────────

  describe("auth() Express middleware", () => {
    // ── 22. Middleware success ─────────────────────────────────────────

    it("populates req.agent on successful verification", async () => {
      const verifier = createVerifierWithMock();
      const middleware = verifier.auth();

      const agent = createAgent();
      const headers = await agent.signRequest(
        "POST",
        "/api/test",
        '{"data":true}'
      );

      const req: any = {
        headers: {
          [HEADERS.SIGNATURE]: headers[HEADERS.SIGNATURE],
          [HEADERS.TIMESTAMP]: headers[HEADERS.TIMESTAMP],
        },
        method: "POST",
        originalUrl: "/api/test",
        body: { data: true },
      };

      let statusCode: number | undefined;
      let jsonBody: any;
      let nextCalled = false;

      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonBody = body;
        },
      };

      const next = () => {
        nextCalled = true;
      };

      await middleware(req, res, next);

      assert.equal(nextCalled, true, "next() should have been called");
      assert.ok(req.agent, "req.agent should be populated");
      assert.equal(req.agent.address, TEST_ADDRESS);
      assert.equal(req.agent.agentKey, TEST_AGENT_KEY);
      assert.equal(req.agent.agentId, 1n);
      assert.equal(req.agent.nullifier, 123n);
      assert.equal(statusCode, undefined, "should not set status on success");
    });

    // ── 23. Middleware missing headers ─────────────────────────────────

    it("returns 401 when signature headers are missing", async () => {
      const verifier = createVerifierWithMock();
      const middleware = verifier.auth();

      const req: any = {
        headers: {},
        method: "GET",
        originalUrl: "/api/test",
      };

      let statusCode: number | undefined;
      let jsonBody: any;
      let nextCalled = false;

      const res: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonBody = body;
        },
      };

      const next = () => {
        nextCalled = true;
      };

      await middleware(req, res, next);

      assert.equal(nextCalled, false, "next() should not be called");
      assert.equal(statusCode, 401);
      assert.match(jsonBody.error, /Missing agent authentication headers/);
    });

    // ── 24. Middleware rate limited ────────────────────────────────────

    it("returns 429 with retryAfterMs when rate limited", async () => {
      const verifier = createVerifierWithMock({
        rateLimitConfig: { perMinute: 1 },
        enableReplayProtection: false,
      });
      const middleware = verifier.auth();

      const agent = createAgent();

      // Build request helper
      async function buildReq() {
        const headers = await agent.signRequest(
          "POST",
          "/api/test",
          '{"data":true}'
        );
        return {
          headers: {
            [HEADERS.SIGNATURE]: headers[HEADERS.SIGNATURE],
            [HEADERS.TIMESTAMP]: headers[HEADERS.TIMESTAMP],
          },
          method: "POST",
          originalUrl: "/api/test",
          body: { data: true },
        } as any;
      }

      // First request — allowed
      let nextCalled = false;
      const res1: any = {
        status() {
          return this;
        },
        json() {},
      };
      await middleware(await buildReq(), res1, () => {
        nextCalled = true;
      });
      assert.equal(nextCalled, true, "first request should pass");

      // Second request — rate limited
      let statusCode: number | undefined;
      let jsonBody: any;
      const res2: any = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(body: any) {
          jsonBody = body;
        },
      };

      let nextCalled2 = false;
      await middleware(await buildReq(), res2, () => {
        nextCalled2 = true;
      });

      assert.equal(nextCalled2, false, "rate-limited request should not call next");
      assert.equal(statusCode, 429);
      assert.ok(jsonBody.retryAfterMs > 0, "retryAfterMs should be positive");
      assert.match(jsonBody.error, /Rate limit exceeded/);
    });
  });
});
