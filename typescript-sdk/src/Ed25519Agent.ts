// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * `Ed25519Agent`: agent-side SDK for agents identified by an Ed25519 key.
 *
 * Same request-signing scheme as `SelfAgent`, but signed with Ed25519 and
 * sent with `x-self-agent-key` / `x-self-agent-keytype: ed25519`. Node-only
 * (uses `node:crypto` for SHA-512).
 */

import * as ed from "@noble/ed25519";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { HEADERS, NETWORKS, DEFAULT_NETWORK } from "./constants";
import type { NetworkName } from "./constants";
import { computeSigningMessage, withAgentHeaders } from "./signing";
import { typedRegistry, type TypedRegistryContract } from "./contract-types";
import { readAgentInfo, type AgentInfo } from "./agent-info";

// @noble/ed25519 v3 needs a SHA-512 implementation for its sync methods (getPublicKey, sign, verify).
if (!ed.hashes.sha512) {
  ed.hashes.sha512 = (message: Uint8Array) =>
    new Uint8Array(createHash("sha512").update(message).digest());
}

/** Constructor options for `Ed25519Agent`. */
export interface Ed25519AgentConfig {
  /** Ed25519 private key (hex, with or without 0x prefix). 32 bytes. */
  privateKey: string;
  /** Network to use: "mainnet" (default) or "testnet" */
  network?: NetworkName;
  /** Override: custom registry address */
  registryAddress?: string;
  /** Override: custom RPC URL */
  rpcUrl?: string;
}

/**
 * Agent-side SDK for Self Agent ID using Ed25519 key pairs.
 *
 * The agent's on-chain identity is its raw 32-byte Ed25519 public key:
 *   agentKey = "0x" + hex(publicKey)
 *
 * For off-chain authentication, the agent signs each request with Ed25519.
 * Services verify the signature using the public key and check on-chain status.
 *
 * @example
 * ```ts
 * const agent = new Ed25519Agent({ privateKey: "<64 hex chars>" });
 * console.log(agent.agentKey); // 0x + 32-byte public key
 * const { isVerified } = await agent.getInfo();
 * const res = await agent.fetch("https://api.example.com/data");
 * ```
 */
export class Ed25519Agent {
  private privateKeyBytes: Uint8Array;
  private publicKeyBytes: Uint8Array;
  private registry: TypedRegistryContract;
  private _agentKey: string;
  private _address: string;

  /**
   * Create an agent from an Ed25519 private key.
   *
   * @param config - 32-byte hex private key plus optional network / registry / RPC overrides.
   * @throws If the private key is not 64 hex characters (after an optional 0x),
   *   including any non-hex character.
   */
  constructor(config: Ed25519AgentConfig) {
    const privHex = config.privateKey.startsWith("0x")
      ? config.privateKey.slice(2)
      : config.privateKey;

    if (privHex.length !== 64) {
      throw new Error(
        "Ed25519 private key must be 32 bytes (64 hex characters)",
      );
    }

    this.privateKeyBytes = hexToBytes(privHex);
    this.publicKeyBytes = ed.getPublicKey(this.privateKeyBytes);

    const net = NETWORKS[config.network ?? DEFAULT_NETWORK];
    const provider = new ethers.JsonRpcProvider(config.rpcUrl ?? net.rpcUrl);

    this.registry = typedRegistry(
      config.registryAddress ?? net.registryAddress,
      provider,
    );

    this._agentKey = "0x" + bytesToHex(this.publicKeyBytes);
    this._address = Ed25519Agent.deriveAddress(this.publicKeyBytes);
  }

  /** The agent's on-chain key (bytes32): the raw Ed25519 public key. */
  get agentKey(): string {
    return this._agentKey;
  }

  /**
   * A deterministic Ethereum-style address derived from keccak256(pubkey).
   * This matches the on-chain Ed25519Verifier.deriveAddress() function.
   */
  get address(): string {
    return this._address;
  }

  /**
   * Check whether this agent is registered with a human proof.
   *
   * The proof may have expired; use `getInfo().isVerified` to also require a fresh proof.
   *
   * @returns The registry's `isVerifiedAgent` result.
   * @throws If the RPC call fails.
   */
  async isRegistered(): Promise<boolean> {
    return this.registry.isVerifiedAgent(this._agentKey);
  }

  /**
   * Read this agent's full on-chain status.
   *
   * @returns Agent ID, verification state, proof expiry and sibling agents.
   * @throws If an RPC call fails.
   */
  async getInfo(): Promise<AgentInfo> {
    return readAgentInfo(this.registry, this._address, this._agentKey);
  }

  /**
   * Generate authentication headers for a request.
   *
   * Ed25519 signature over the raw 32-byte
   * keccak256(timestamp + method + canonicalPathAndQuery + bodyHash).
   *
   * @param method - HTTP method.
   * @param url - Request URL (absolute or path; only path + query are signed).
   * @param body - Request body exactly as it will be sent, if any.
   * @returns The key, key type, signature and timestamp headers.
   */
  async signRequest(
    method: string,
    url: string,
    body?: string,
  ): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    const message = computeSigningMessage(timestamp, method, url, body);

    const msgBytes = ethers.getBytes(message);
    const sigBytes = await ed.signAsync(msgBytes, this.privateKeyBytes);

    return {
      [HEADERS.KEY]: this._agentKey,
      [HEADERS.KEYTYPE]: "ed25519",
      [HEADERS.SIGNATURE]: "0x" + bytesToHex(sigBytes),
      [HEADERS.TIMESTAMP]: timestamp,
    };
  }

  /**
   * Call global `fetch` with agent signature headers added.
   *
   * String bodies are signed and sent as `application/json` unless you set a
   * Content-Type; non-string bodies are not covered by the signature.
   *
   * @param url - Request URL.
   * @param options - Standard fetch options.
   * @returns The fetch response.
   */
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const method = (options.method || "GET").toUpperCase();
    const body = typeof options.body === "string" ? options.body : undefined;
    const headers = await this.signRequest(method, url, body);

    return globalThis.fetch(url, {
      ...options,
      method,
      headers: withAgentHeaders(options, headers),
    });
  }

  /**
   * Derive a deterministic Ethereum-style address from an Ed25519 public key.
   *
   * Matches the on-chain Ed25519Verifier.deriveAddress():
   *   address(uint160(uint256(keccak256(pubkey))))
   *
   * @param pubkey - 32-byte public key as bytes or 0x-prefixed hex.
   * @returns The checksummed address (last 20 bytes of the hash).
   * @throws If `pubkey` is not valid hex.
   */
  static deriveAddress(pubkey: Uint8Array | string): string {
    const pubkeyBytes =
      typeof pubkey === "string" ? ethers.getBytes(pubkey) : pubkey;
    const hash = ethers.keccak256(pubkeyBytes);
    return ethers.getAddress("0x" + hash.slice(-40));
  }
}

// ── Hex helpers (no Buffer dependency) ──────────────────────────────────────

/**
 * Decode a hex string (no 0x) into bytes.
 *
 * @param hex - Hex string without prefix.
 * @returns The decoded bytes.
 * @throws If the length is odd or any character is not 0-9, a-f or A-F
 *   (otherwise `parseInt` would silently decode it as a zero byte).
 */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error(
      "Invalid hex string: expected an even number of characters 0-9, a-f, A-F",
    );
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Encode bytes as lowercase hex without a 0x prefix.
 *
 * @param bytes - Bytes to encode.
 * @returns The hex string.
 */
function bytesToHex(bytes: Uint8Array): string {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}
