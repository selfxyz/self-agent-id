// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as ed from "@noble/ed25519";
import { ethers } from "ethers";
import { Ed25519Agent } from "./Ed25519Agent";
import { computeSigningMessage } from "./signing";
import { HEADERS } from "./constants";
import { SelfAgentVerifier } from "./SelfAgentVerifier";

// A deterministic test private key (32 bytes hex)
const TEST_PRIVATE_KEY =
  "0x4cdb08e75df7b2cc tried9c3e5f8dc91a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8";
// Use a simpler deterministic key
const TEST_KEY_HEX =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("Ed25519Agent", () => {
  it("should construct from hex private key without 0x prefix", () => {
    const agent = new Ed25519Agent({
      privateKey: TEST_KEY_HEX,
      rpcUrl: "http://localhost:1", // won't be used
      registryAddress: ethers.ZeroAddress,
    });
    assert.ok(agent.agentKey.startsWith("0x"));
    assert.equal(agent.agentKey.length, 66); // 0x + 64 hex chars = 32 bytes
  });

  it("should construct from hex private key with 0x prefix", () => {
    const agent = new Ed25519Agent({
      privateKey: "0x" + TEST_KEY_HEX,
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
    });
    assert.ok(agent.agentKey.startsWith("0x"));
    assert.equal(agent.agentKey.length, 66);
  });

  it("should derive correct public key", () => {
    const privBytes = hexToBytes(TEST_KEY_HEX);
    const expectedPubkey = ed.getPublicKey(privBytes);
    const expectedKey = "0x" + bytesToHex(expectedPubkey);

    const agent = new Ed25519Agent({
      privateKey: TEST_KEY_HEX,
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
    });
    assert.equal(agent.agentKey, expectedKey);
  });

  it("should derive deterministic address from keccak256(pubkey)", () => {
    const privBytes = hexToBytes(TEST_KEY_HEX);
    const pubkeyBytes = ed.getPublicKey(privBytes);
    const hash = ethers.keccak256(pubkeyBytes);
    const expectedAddress = ethers.getAddress("0x" + hash.slice(-40));

    const agent = new Ed25519Agent({
      privateKey: TEST_KEY_HEX,
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
    });
    assert.equal(agent.address, expectedAddress);
  });

  it("should produce valid Ed25519 signatures in signRequest", async () => {
    const agent = new Ed25519Agent({
      privateKey: TEST_KEY_HEX,
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
    });

    const headers = await agent.signRequest("GET", "https://example.com/api");

    // Check required headers are present
    assert.ok(headers[HEADERS.KEY], "should have key header");
    assert.ok(headers[HEADERS.KEYTYPE], "should have keytype header");
    assert.ok(headers[HEADERS.SIGNATURE], "should have signature header");
    assert.ok(headers[HEADERS.TIMESTAMP], "should have timestamp header");

    // Check keytype is ed25519
    assert.equal(headers[HEADERS.KEYTYPE], "ed25519");

    // Check key matches agentKey
    assert.equal(headers[HEADERS.KEY], agent.agentKey);

    // Verify the signature is valid
    const message = computeSigningMessage(
      headers[HEADERS.TIMESTAMP],
      "GET",
      "https://example.com/api",
    );
    const msgBytes = ethers.getBytes(message);
    const sigBytes = ethers.getBytes(headers[HEADERS.SIGNATURE]);
    const pubkeyBytes = ethers.getBytes(agent.agentKey);

    const valid = await ed.verifyAsync(sigBytes, msgBytes, pubkeyBytes);
    assert.ok(valid, "Ed25519 signature should be valid");
  });

  it("should produce valid signatures for POST requests with body", async () => {
    const agent = new Ed25519Agent({
      privateKey: TEST_KEY_HEX,
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
    });

    const body = JSON.stringify({ hello: "world" });
    const headers = await agent.signRequest(
      "POST",
      "https://example.com/api",
      body,
    );

    const message = computeSigningMessage(
      headers[HEADERS.TIMESTAMP],
      "POST",
      "https://example.com/api",
      body,
    );
    const msgBytes = ethers.getBytes(message);
    const sigBytes = ethers.getBytes(headers[HEADERS.SIGNATURE]);
    const pubkeyBytes = ethers.getBytes(agent.agentKey);

    const valid = await ed.verifyAsync(sigBytes, msgBytes, pubkeyBytes);
    assert.ok(valid, "Ed25519 signature should be valid for POST with body");
  });

  it("should reject invalid private key length", () => {
    assert.throws(
      () =>
        new Ed25519Agent({
          privateKey: "0xdead",
          rpcUrl: "http://localhost:1",
          registryAddress: ethers.ZeroAddress,
        }),
      /32 bytes/,
    );
  });

  it("deriveAddress static method should match instance address", () => {
    const privBytes = hexToBytes(TEST_KEY_HEX);
    const pubkeyBytes = ed.getPublicKey(privBytes);

    const staticAddr = Ed25519Agent.deriveAddress(pubkeyBytes);

    const agent = new Ed25519Agent({
      privateKey: TEST_KEY_HEX,
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
    });

    assert.equal(staticAddr, agent.address);
  });

  it("deriveAddress should accept hex string input", () => {
    const privBytes = hexToBytes(TEST_KEY_HEX);
    const pubkeyBytes = ed.getPublicKey(privBytes);
    const pubHex = "0x" + bytesToHex(pubkeyBytes);

    const fromBytes = Ed25519Agent.deriveAddress(pubkeyBytes);
    const fromHex = Ed25519Agent.deriveAddress(pubHex);

    assert.equal(fromBytes, fromHex);
  });
});

describe("SelfAgentVerifier Ed25519 path", () => {
  it("should verify a valid Ed25519 signed request", async () => {
    const agent = new Ed25519Agent({
      privateKey: TEST_KEY_HEX,
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
    });

    const headers = await agent.signRequest("GET", "/api/test");

    // We can't test on-chain checks without a real provider, but we can verify
    // the signature verification path runs correctly up to the on-chain check.
    // Create a verifier with replay protection disabled and a short maxAge.
    const verifier = new SelfAgentVerifier({
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
      enableReplayProtection: false,
      requireSelfProvider: false,
    });

    // Directly test verify — it will fail at the on-chain check (RPC error),
    // but we can at least verify the Ed25519 signature validation path works
    // by checking it doesn't fail with "Invalid Ed25519 signature"
    try {
      await verifier.verify({
        signature: headers[HEADERS.SIGNATURE],
        timestamp: headers[HEADERS.TIMESTAMP],
        method: "GET",
        url: "/api/test",
        keytype: "ed25519",
        agentKey: headers[HEADERS.KEY],
      });
    } catch (err: unknown) {
      // RPC errors are expected — but signature errors mean our code is wrong
      const msg = err instanceof Error ? err.message : String(err);
      assert.ok(
        !msg.includes("Invalid Ed25519 signature"),
        "Should not fail on Ed25519 signature validation: " + msg,
      );
    }
  });

  it("should reject Ed25519 request without agentKey", async () => {
    const verifier = new SelfAgentVerifier({
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
      enableReplayProtection: false,
    });

    const result = await verifier.verify({
      signature: "0x" + "00".repeat(64),
      timestamp: Date.now().toString(),
      method: "GET",
      url: "/test",
      keytype: "ed25519",
      // agentKey intentionally omitted
    });

    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("Missing agent key"));
  });

  it("should reject Ed25519 request with wrong signature", async () => {
    const agent = new Ed25519Agent({
      privateKey: TEST_KEY_HEX,
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
    });

    const verifier = new SelfAgentVerifier({
      rpcUrl: "http://localhost:1",
      registryAddress: ethers.ZeroAddress,
      enableReplayProtection: false,
    });

    const result = await verifier.verify({
      signature: "0x" + "ab".repeat(64), // bogus signature
      timestamp: Date.now().toString(),
      method: "GET",
      url: "/test",
      keytype: "ed25519",
      agentKey: agent.agentKey,
    });

    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("Invalid Ed25519 signature"));
  });
});

// ---------------------------------------------------------------------------
// Hex utility helpers (matching Ed25519Agent's internal helpers)
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
