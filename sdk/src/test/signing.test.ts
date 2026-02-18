import { describe, it } from "node:test";
import assert from "node:assert";
import { ethers } from "ethers";
import { SelfAgent } from "../SelfAgent";
import { HEADERS } from "../constants";

// These tests verify the signing protocol without needing a deployed contract.
// They test: key derivation, request signing, signature verification.

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const FAKE_REGISTRY = "0x0000000000000000000000000000000000000001";
const FAKE_RPC = "http://localhost:8545"; // won't be called for these tests

describe("SelfAgent signing", () => {
  it("produces deterministic pubkey hash", () => {
    const agent = new SelfAgent({
      privateKey: TEST_PRIVATE_KEY,
      registryAddress: FAKE_REGISTRY,
      rpcUrl: FAKE_RPC,
    });

    // pubkeyHash should be keccak256 of compressed public key
    const wallet = new ethers.Wallet(TEST_PRIVATE_KEY);
    const expected = ethers.keccak256(wallet.signingKey.compressedPublicKey);
    assert.strictEqual(agent.pubkeyHash, expected);
  });

  it("signRequest returns all required headers", async () => {
    const agent = new SelfAgent({
      privateKey: TEST_PRIVATE_KEY,
      registryAddress: FAKE_REGISTRY,
      rpcUrl: FAKE_RPC,
    });

    const headers = await agent.signRequest("GET", "/api/test");

    assert.ok(headers[HEADERS.PUBKEY], "should have pubkey header");
    assert.ok(headers[HEADERS.SIGNATURE], "should have signature header");
    assert.ok(headers[HEADERS.TIMESTAMP], "should have timestamp header");
    assert.strictEqual(headers[HEADERS.PUBKEY], agent.pubkeyHash);
  });

  it("signature is verifiable", async () => {
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

    const recovered = ethers.verifyMessage(ethers.getBytes(message), signature);
    assert.strictEqual(recovered, agent.address);
  });

  it("sign method produces valid signature", async () => {
    const agent = new SelfAgent({
      privateKey: TEST_PRIVATE_KEY,
      registryAddress: FAKE_REGISTRY,
      rpcUrl: FAKE_RPC,
    });

    const data = "hello world";
    const sig = await agent.sign(data);

    const hash = ethers.keccak256(ethers.toUtf8Bytes(data));
    const recovered = ethers.verifyMessage(ethers.getBytes(hash), sig);
    assert.strictEqual(recovered, agent.address);
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
});
