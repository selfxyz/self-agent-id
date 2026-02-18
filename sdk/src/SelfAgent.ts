import { ethers } from "ethers";
import { REGISTRY_ABI, HEADERS } from "./constants";

export interface SelfAgentConfig {
  /** Agent's secp256k1 private key (hex, with or without 0x) */
  privateKey: string;
  /** Deployed SelfAgentRegistry contract address */
  registryAddress: string;
  /** JSON-RPC URL for reading contract state */
  rpcUrl: string;
}

export interface AgentInfo {
  pubkey: string;
  agentId: bigint;
  isVerified: boolean;
  nullifier: bigint;
  agentCount: bigint;
}

/**
 * Agent-side SDK for Self Agent ID.
 *
 * Usage:
 * ```ts
 * const agent = new SelfAgent({
 *   privateKey: "0x...",
 *   registryAddress: "0x...",
 *   rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
 * });
 *
 * // Check registration
 * const registered = await agent.isRegistered();
 *
 * // Sign a request
 * const headers = await agent.signRequest("GET", "/api/data");
 *
 * // Fetch with automatic signing
 * const response = await agent.fetch("https://api.example.com/data");
 * ```
 */
export class SelfAgent {
  private wallet: ethers.Wallet;
  private registry: ethers.Contract;
  private _pubkeyHash: string;

  constructor(config: SelfAgentConfig) {
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);
    this.wallet = new ethers.Wallet(config.privateKey, provider);
    this.registry = new ethers.Contract(
      config.registryAddress,
      REGISTRY_ABI,
      provider
    );
    // keccak256 of the compressed public key as the on-chain identifier
    this._pubkeyHash = ethers.keccak256(this.wallet.signingKey.compressedPublicKey);
  }

  /** The agent's public key hash (bytes32) registered on-chain */
  get pubkeyHash(): string {
    return this._pubkeyHash;
  }

  /** The agent's Ethereum address (derived from private key) */
  get address(): string {
    return this.wallet.address;
  }

  /** Check if this agent is registered and verified on-chain */
  async isRegistered(): Promise<boolean> {
    return this.registry.isVerifiedAgent(this._pubkeyHash);
  }

  /** Get full agent info from the registry */
  async getInfo(): Promise<AgentInfo> {
    const agentId: bigint = await this.registry.getAgentId(this._pubkeyHash);
    if (agentId === 0n) {
      return {
        pubkey: this._pubkeyHash,
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
      pubkey: this._pubkeyHash,
      agentId,
      isVerified,
      nullifier,
      agentCount,
    };
  }

  /** Sign arbitrary data with the agent's private key */
  async sign(data: string | Uint8Array): Promise<string> {
    const hash =
      typeof data === "string"
        ? ethers.keccak256(ethers.toUtf8Bytes(data))
        : ethers.keccak256(data);
    return this.wallet.signMessage(ethers.getBytes(hash));
  }

  /**
   * Generate authentication headers for a request.
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
      [HEADERS.PUBKEY]: this._pubkeyHash,
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
