// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import * as ed from "@noble/ed25519";
import { createHash } from "node:crypto";
import { ethers } from "ethers";
import { HEADERS, NETWORKS, DEFAULT_NETWORK } from "./constants";
import type { NetworkName } from "./constants";
import { computeSigningMessage } from "./signing";
import { typedRegistry, type TypedRegistryContract } from "./contract-types";

// @noble/ed25519 v3 requires a SHA-512 implementation for sync methods (getPublicKey, sign, verify).
// Use Node's built-in crypto module.
if (!ed.hashes.sha512) {
  ed.hashes.sha512 = (message: Uint8Array) =>
    new Uint8Array(createHash("sha512").update(message).digest());
}

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
 * Usage:
 * ```ts
 * const agent = new Ed25519Agent({ privateKey: "0x..." });
 *
 * const registered = await agent.isRegistered();
 * const response = await agent.fetch("https://api.example.com/data");
 * ```
 */
export class Ed25519Agent {
  private privateKeyBytes: Uint8Array;
  private publicKeyBytes: Uint8Array;
  private registry: TypedRegistryContract;
  private _agentKey: string;
  private _address: string;

  constructor(config: Ed25519AgentConfig) {
    // Parse private key (strip 0x prefix if present)
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

    // Agent key = raw 32-byte public key as 0x-prefixed hex (already 32 bytes)
    this._agentKey = "0x" + bytesToHex(this.publicKeyBytes);

    // Derive a deterministic Ethereum-style address from pubkey:
    // address = address(uint160(uint256(keccak256(pubkey))))
    this._address = Ed25519Agent.deriveAddress(this.publicKeyBytes);
  }

  /** The agent's on-chain key (bytes32) — raw Ed25519 public key */
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

  /** Check if this agent is registered and verified on-chain */
  async isRegistered(): Promise<boolean> {
    return this.registry.isVerifiedAgent(this._agentKey);
  }

  /** Get full agent info from the registry */
  async getInfo(): Promise<{
    address: string;
    agentKey: string;
    agentId: bigint;
    isVerified: boolean;
    nullifier: bigint;
    agentCount: bigint;
  }> {
    const agentId: bigint = await this.registry.getAgentId(this._agentKey);
    if (agentId === 0n) {
      return {
        address: this._address,
        agentKey: this._agentKey,
        agentId: 0n,
        isVerified: false,
        nullifier: 0n,
        agentCount: 0n,
      };
    }

    const [isVerified, nullifier] = await Promise.all([
      this.registry.hasHumanProof(agentId),
      this.registry.getHumanNullifier(agentId),
    ]);

    const agentCount: bigint =
      await this.registry.getAgentCountForHuman(nullifier);

    return {
      address: this._address,
      agentKey: this._agentKey,
      agentId,
      isVerified,
      nullifier,
      agentCount,
    };
  }

  /**
   * Generate authentication headers for a request.
   *
   * Signature covers: keccak256(timestamp + method + canonicalPathAndQuery + bodyHash)
   * Signed with Ed25519 instead of ECDSA.
   */
  async signRequest(
    method: string,
    url: string,
    body?: string,
  ): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    const message = computeSigningMessage(timestamp, method, url, body);

    // Sign the raw 32-byte keccak256 hash with Ed25519
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
   * Wrapper around global fetch that automatically adds agent signature headers.
   */
  async fetch(url: string, options: RequestInit = {}): Promise<Response> {
    const method = (options.method || "GET").toUpperCase();
    const body = typeof options.body === "string" ? options.body : undefined;
    const headers = await this.signRequest(method, url, body);

    return globalThis.fetch(url, {
      ...options,
      method,
      headers: {
        ...Object.fromEntries(Object.entries(options.headers || {})),
        ...headers,
      },
    });
  }

  /**
   * Derive a deterministic Ethereum-style address from an Ed25519 public key.
   *
   * Matches the on-chain Ed25519Verifier.deriveAddress():
   *   address(uint160(uint256(keccak256(pubkey))))
   */
  static deriveAddress(pubkey: Uint8Array | string): string {
    const pubkeyBytes =
      typeof pubkey === "string" ? ethers.getBytes(pubkey) : pubkey;
    const hash = ethers.keccak256(pubkeyBytes);
    // Take the last 20 bytes of the 32-byte keccak256 hash
    return ethers.getAddress("0x" + hash.slice(-40));
  }
}

// ---------------------------------------------------------------------------
// Hex utility helpers (avoids Buffer dependency for browser compatibility)
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
