// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { SelfAgent } from "../SelfAgent";

describe("SelfAgent signer support", () => {
  it("accepts an ethers Signer instead of a private key", async () => {
    const wallet = ethers.Wallet.createRandom();
    const agent = new SelfAgent({ signer: wallet, network: "testnet" });
    assert.strictEqual(agent.address, wallet.address);
  });

  it("signRequest works with a signer", async () => {
    const wallet = ethers.Wallet.createRandom();
    const agent = new SelfAgent({ signer: wallet, network: "testnet" });
    const headers = await agent.signRequest("GET", "/test");
    assert.ok(headers["x-self-agent-signature"]);
    assert.strictEqual(headers["x-self-agent-address"], wallet.address);

    // Verify signature is recoverable
    const { computeSigningMessage } = await import("../signing");
    const message = computeSigningMessage(
      headers["x-self-agent-timestamp"],
      "GET",
      "/test"
    );
    const recovered = ethers.verifyMessage(
      ethers.getBytes(message),
      headers["x-self-agent-signature"]
    );
    assert.strictEqual(recovered, wallet.address);
  });

  it("throws if neither privateKey nor signer provided", () => {
    assert.throws(
      () => new SelfAgent({ network: "testnet" } as any),
      /Either privateKey or signer must be provided/
    );
  });
});
