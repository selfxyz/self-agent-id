// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { describe, it } from "node:test";
import assert from "node:assert";
import { ethers } from "ethers";
import { SelfAgent } from "../SelfAgent";
import { HEADERS } from "../constants";
import { computeSigningMessage } from "../signing";

// These tests verify the signing protocol without needing a deployed contract.
// They test: key derivation, request signing, signature verification.

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FAKE_REGISTRY = "0x0000000000000000000000000000000000000001";
const FAKE_RPC = "http://localhost:8545"; // won't be called for these tests

describe("SelfAgent signing", () => {
  it("derives agent key from address (zero-padded)", () => {
    const agent = new SelfAgent({
      privateKey: TEST_PRIVATE_KEY,
      registryAddress: FAKE_REGISTRY,
      rpcUrl: FAKE_RPC,
    });

    // agentKey should be zeroPadValue(address, 32)
    const wallet = new ethers.Wallet(TEST_PRIVATE_KEY);
    const expected = ethers.zeroPadValue(wallet.address, 32);
    assert.strictEqual(agent.agentKey, expected);
  });

  it("signRequest returns all required headers", async () => {
    const agent = new SelfAgent({
      privateKey: TEST_PRIVATE_KEY,
      registryAddress: FAKE_REGISTRY,
      rpcUrl: FAKE_RPC,
    });

    const headers = await agent.signRequest("GET", "/api/test");

    assert.ok(headers[HEADERS.ADDRESS], "should have address header");
    assert.ok(headers[HEADERS.SIGNATURE], "should have signature header");
    assert.ok(headers[HEADERS.TIMESTAMP], "should have timestamp header");
    assert.strictEqual(headers[HEADERS.ADDRESS], agent.address);
  });

  it("signature is verifiable and recovers the agent address", async () => {
    const agent = new SelfAgent({
      privateKey: TEST_PRIVATE_KEY,
      registryAddress: FAKE_REGISTRY,
      rpcUrl: FAKE_RPC,
    });

    const method = "POST";
    const url = "/api/data";
    const body = '{"key":"value"}';

    const headers = await agent.signRequest(method, url, body);
    const timestamp = headers[HEADERS.TIMESTAMP];
    const signature = headers[HEADERS.SIGNATURE];

    // Reconstruct the message the same way the verifier would
    const bodyHash = ethers.keccak256(ethers.toUtf8Bytes(body));
    const message = ethers.keccak256(
      ethers.toUtf8Bytes(timestamp + method + url + bodyHash)
    );

    // Recover signer — this is what closes the off-chain verification gap
    const recovered = ethers.verifyMessage(ethers.getBytes(message), signature);
    assert.strictEqual(recovered, agent.address);

    // Verifier derives agent key from recovered address
    const derivedKey = ethers.zeroPadValue(recovered, 32);
    assert.strictEqual(derivedKey, agent.agentKey);
  });

  it("different bodies produce different signatures", async () => {
    const agent = new SelfAgent({
      privateKey: TEST_PRIVATE_KEY,
      registryAddress: FAKE_REGISTRY,
      rpcUrl: FAKE_RPC,
    });

    const headers1 = await agent.signRequest("POST", "/api", "body1");
    const headers2 = await agent.signRequest("POST", "/api", "body2");

    assert.notStrictEqual(
      headers1[HEADERS.SIGNATURE],
      headers2[HEADERS.SIGNATURE]
    );
  });

  it("canonicalizes full URL and path+query to the same signing message", () => {
    const ts = "1700000000000";
    const method = "POST";
    const body = '{"ok":true}';

    const full = computeSigningMessage(
      ts,
      method,
      "https://demo.example.com/api/data?x=1",
      body
    );
    const path = computeSigningMessage(ts, method, "/api/data?x=1", body);

    assert.strictEqual(full, path);
  });
});
