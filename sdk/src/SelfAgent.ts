import { ethers } from "ethers";
import {
  REGISTRY_ABI,
  HEADERS,
  NETWORKS,
  DEFAULT_NETWORK,
} from "./constants";
import type { NetworkName } from "./constants";

export interface SelfAgentConfig {
  /** Agent's private key (hex, with or without 0x) */
  privateKey: string;
  /** Network to use: "mainnet" (default) or "testnet" */
  network?: NetworkName;
  /** Override: custom registry address (takes precedence over network) */
  registryAddress?: string;
  /** Override: custom RPC URL (takes precedence over network) */
  rpcUrl?: string;
}

export interface AgentInfo {
  address: string;
  agentKey: string;
  agentId: bigint;
  isVerified: boolean;
  nullifier: bigint;
  agentCount: bigint;
}

/**
 * Agent-side SDK for Self Agent ID.
 *
 * The agent's on-chain identity is its Ethereum address, zero-padded to bytes32:
 *   agentKey = zeroPadValue(address, 32)
 *
 * For off-chain authentication, the agent signs each request with its private key.
 * Services verify the signature, recover the signer address, and check on-chain status.
 *
 * Usage:
 * ```ts
 * // Mainnet (default)
 * const agent = new SelfAgent({ privateKey: "0x..." });
 *
 * // Testnet
 * const agent = new SelfAgent({ privateKey: "0x...", network: "testnet" });
 *
 * const registered = await agent.isRegistered();
 * const response = await agent.fetch("https://api.example.com/data");
 * ```
 */
export class SelfAgent {
  private wallet: ethers.Wallet;
  private registry: ethers.Contract;
  private _agentKey: string;

  constructor(config: SelfAgentConfig) {
    const net = NETWORKS[config.network ?? DEFAULT_NETWORK];
    const provider = new ethers.JsonRpcProvider(config.rpcUrl ?? net.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, provider);
    this.registry = new ethers.Contract(
      config.registryAddress ?? net.registryAddress,
      REGISTRY_ABI,
      provider
    );
    // Agent key = address zero-padded to 32 bytes (matches on-chain derivation)
    this._agentKey = ethers.zeroPadValue(this.wallet.address, 32);
  }

  /** The agent's on-chain key (bytes32) — zero-padded address */
  get agentKey(): string {
    return this._agentKey;
  }

  /** The agent's Ethereum address */
  get address(): string {
    return this.wallet.address;
  }

  /** Check if this agent is registered and verified on-chain */
  async isRegistered(): Promise<boolean> {
    return this.registry.isVerifiedAgent(this._agentKey);
  }

  /** Get full agent info from the registry */
  async getInfo(): Promise<AgentInfo> {
    const agentId: bigint = await this.registry.getAgentId(this._agentKey);
    if (agentId === 0n) {
      return {
        address: this.wallet.address,
        agentKey: this._agentKey,
        agentId: 0n,
        isVerified: false,
        nullifier: 0n,
        agentCount: 0n,
      };
    }

    const [isVerified, nullifier] = await Promise.all([
      this.registry.hasHumanProof(agentId) as Promise<boolean>,
      this.registry.getHumanNullifier(agentId) as Promise<bigint>,
    ]);

    const agentCount: bigint = await this.registry.getAgentCountForHuman(nullifier);

    return {
      address: this.wallet.address,
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
   * The service recovers the signer address from the signature,
   * converts it to a bytes32 agent key, and checks on-chain status.
   *
   * Signature covers: keccak256(timestamp + method + url + bodyHash)
   */
  async signRequest(
    method: string,
    url: string,
    body?: string
  ): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    const bodyHash = body
      ? ethers.keccak256(ethers.toUtf8Bytes(body))
      : ethers.keccak256(ethers.toUtf8Bytes(""));

    const message = ethers.keccak256(
      ethers.toUtf8Bytes(timestamp + method.toUpperCase() + url + bodyHash)
    );

    const signature = await this.wallet.signMessage(ethers.getBytes(message));

    return {
      [HEADERS.ADDRESS]: this.wallet.address,
      [HEADERS.SIGNATURE]: signature,
      [HEADERS.TIMESTAMP]: timestamp,
    };
  }

  /**
   * Wrapper around global fetch that automatically adds agent signature headers.
   */
  async fetch(
    url: string,
    options: RequestInit = {}
  ): Promise<Response> {
    const method = (options.method || "GET").toUpperCase();
    const body = typeof options.body === "string" ? options.body : undefined;
    const headers = await this.signRequest(method, url, body);

    return globalThis.fetch(url, {
      ...options,
      method,
      headers: {
        ...Object.fromEntries(
          Object.entries(options.headers || {})
        ),
        ...headers,
      },
    });
  }
}
