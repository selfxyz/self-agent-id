// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { describe, it } from "node:test";
import assert from "node:assert";
import { ethers } from "ethers";
import {
  getRegistrationConfigIndex,
  computeRegistrationChallengeHash,
  signRegistrationChallenge,
  buildSimpleRegisterUserDataAscii,
  buildSimpleDeregisterUserDataAscii,
  buildAdvancedRegisterUserDataAscii,
  buildAdvancedDeregisterUserDataAscii,
  buildWalletFreeRegisterUserDataAscii,
  buildSimpleRegisterUserDataBinary,
  buildSimpleDeregisterUserDataBinary,
  buildAdvancedRegisterUserDataBinary,
  buildAdvancedDeregisterUserDataBinary,
  buildWalletFreeRegisterUserDataBinary,
} from "../registration";

const HUMAN = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const REGISTRY = "0x29d941856134b1D053AfFF57fa560324510C79fa";
const CHAIN_ID = 11142220;
const AGENT_PK =
  "0x59c6995e998f97a5a0044966f094538db5f5f848f8a98f6f53f6df6f7d8f2148";

describe("registration helpers", () => {
  it("maps disclosure choices to config index", () => {
    assert.strictEqual(getRegistrationConfigIndex({ minimumAge: 0, ofac: false }), 0);
    assert.strictEqual(getRegistrationConfigIndex({ minimumAge: 18, ofac: false }), 1);
    assert.strictEqual(getRegistrationConfigIndex({ minimumAge: 21, ofac: false }), 2);
    assert.strictEqual(getRegistrationConfigIndex({ minimumAge: 0, ofac: true }), 3);
    assert.strictEqual(getRegistrationConfigIndex({ minimumAge: 18, ofac: true }), 4);
    assert.strictEqual(getRegistrationConfigIndex({ minimumAge: 21, ofac: true }), 5);
  });

  it("computes chain+registry-bound challenge hash", () => {
    const computed = computeRegistrationChallengeHash({
      humanIdentifier: HUMAN,
      chainId: CHAIN_ID,
      registryAddress: REGISTRY,
    });

    const expected = ethers.keccak256(
      ethers.solidityPacked(
        ["string", "address", "uint256", "address"],
        ["self-agent-id:register:", ethers.getAddress(HUMAN), BigInt(CHAIN_ID), ethers.getAddress(REGISTRY)]
      )
    );

    assert.strictEqual(computed, expected);
  });

  it("signs registration challenge and recovers expected address", async () => {
    const signed = await signRegistrationChallenge(AGENT_PK, {
      humanIdentifier: HUMAN,
      chainId: CHAIN_ID,
      registryAddress: REGISTRY,
    });

    const sig = ethers.Signature.from(signed.signature);
    assert.strictEqual(sig.r, signed.r);
    assert.strictEqual(sig.s, signed.s);
    assert.ok(signed.v === 27 || signed.v === 28);

    const recovered = ethers.recoverAddress(
      ethers.hashMessage(ethers.getBytes(signed.messageHash)),
      { r: signed.r, s: signed.s, v: signed.v }
    );

    assert.strictEqual(recovered.toLowerCase(), signed.agentAddress.toLowerCase());
  });

  it("builds ASCII userData with expected lengths", async () => {
    const signed = await signRegistrationChallenge(AGENT_PK, {
      humanIdentifier: HUMAN,
      chainId: CHAIN_ID,
      registryAddress: REGISTRY,
    });

    const agentAddr = signed.agentAddress;

    const simpleR = buildSimpleRegisterUserDataAscii({ minimumAge: 18 });
    const simpleD = buildSimpleDeregisterUserDataAscii({ minimumAge: 21, ofac: true });
    const advR = buildAdvancedRegisterUserDataAscii({
      agentAddress: agentAddr,
      signature: signed.signature,
      disclosures: { minimumAge: 18, ofac: true },
    });
    const advD = buildAdvancedDeregisterUserDataAscii({
      agentAddress: agentAddr,
      disclosures: { minimumAge: 21 },
    });
    const wf = buildWalletFreeRegisterUserDataAscii({
      agentAddress: agentAddr,
      guardianAddress: HUMAN,
      signature: signed.signature,
      disclosures: { minimumAge: 0, ofac: true },
    });

    assert.strictEqual(simpleR, "R1");
    assert.strictEqual(simpleD, "D5");
    assert.strictEqual(advR.length, 172);
    assert.strictEqual(advR.slice(0, 2), "K4");
    assert.strictEqual(advD.length, 42);
    assert.strictEqual(advD.slice(0, 2), "X2");
    assert.strictEqual(wf.length, 212);
    assert.strictEqual(wf.slice(0, 2), "W3");
  });

  it("builds binary userData with expected lengths and action bytes", async () => {
    const signed = await signRegistrationChallenge(AGENT_PK, {
      humanIdentifier: HUMAN,
      chainId: CHAIN_ID,
      registryAddress: REGISTRY,
    });

    const simpleR = buildSimpleRegisterUserDataBinary({ minimumAge: 18 });
    const simpleD = buildSimpleDeregisterUserDataBinary({ minimumAge: 21, ofac: true });
    const advR = buildAdvancedRegisterUserDataBinary({
      agentAddress: signed.agentAddress,
      signature: signed.signature,
      disclosures: { minimumAge: 18, ofac: true },
    });
    const advD = buildAdvancedDeregisterUserDataBinary({
      agentAddress: signed.agentAddress,
      disclosures: { minimumAge: 21 },
    });
    const wf = buildWalletFreeRegisterUserDataBinary({
      agentAddress: signed.agentAddress,
      guardianAddress: HUMAN,
      signature: signed.signature,
      disclosures: { ofac: true },
    });

    const simpleRBytes = ethers.getBytes(simpleR);
    const simpleDBytes = ethers.getBytes(simpleD);
    const advRBytes = ethers.getBytes(advR);
    const advDBytes = ethers.getBytes(advD);
    const wfBytes = ethers.getBytes(wf);

    assert.strictEqual(simpleRBytes.length, 2);
    assert.strictEqual(simpleRBytes[0], 0x01);
    assert.strictEqual(simpleRBytes[1], 0x01);

    assert.strictEqual(simpleDBytes.length, 2);
    assert.strictEqual(simpleDBytes[0], 0x02);
    assert.strictEqual(simpleDBytes[1], 0x05);

    assert.strictEqual(advRBytes.length, 87);
    assert.strictEqual(advRBytes[0], 0x03);
    assert.strictEqual(advRBytes[1], 0x04);

    assert.strictEqual(advDBytes.length, 22);
    assert.strictEqual(advDBytes[0], 0x04);
    assert.strictEqual(advDBytes[1], 0x02);

    assert.strictEqual(wfBytes.length, 107);
    assert.strictEqual(wfBytes[0], 0x05);
    assert.strictEqual(wfBytes[1], 0x03);
  });
});
