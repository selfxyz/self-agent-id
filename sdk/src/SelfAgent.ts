import { ethers } from "ethers";
import {
  REGISTRY_ABI,
  PROVIDER_ABI,
  HEADERS,
  NETWORKS,
  DEFAULT_NETWORK,
} from "./constants";
import type { NetworkName } from "./constants";
import type { A2AAgentCard, AgentSkill } from "./agentCard";
import { buildAgentCard } from "./agentCard";
import { computeSigningMessage } from "./signing";

export interface SelfAgentConfig {
  /** Agent's private key (hex, with or without 0x). Required unless signer is provided. */
  privateKey?: string;
  /** An ethers Signer (e.g. browser wallet). Required unless privateKey is provided. */
  signer?: ethers.Signer;
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
  private wallet: ethers.Signer & { address: string };
  private registry: ethers.Contract;
  private _agentKey: string;

  constructor(config: SelfAgentConfig) {
    if (!config.privateKey && !config.signer) {
      throw new Error("Either privateKey or signer must be provided");
    }

    const net = NETWORKS[config.network ?? DEFAULT_NETWORK];
    const provider = new ethers.JsonRpcProvider(config.rpcUrl ?? net.rpcUrl);

    if (config.signer) {
      this.wallet = config.signer as ethers.Signer & { address: string };
    } else {
      this.wallet = new ethers.Wallet(config.privateKey!, provider);
    }

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
   * Signature covers: keccak256(timestamp + method + canonicalPathAndQuery + bodyHash)
   */
  async signRequest(
    method: string,
    url: string,
    body?: string
  ): Promise<Record<string, string>> {
    const timestamp = Date.now().toString();
    const message = computeSigningMessage(timestamp, method, url, body);

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

  // ─── A2A Agent Card Methods ──────────────────────────────────────────────

  /** Read the A2A Agent Card from on-chain metadata (if set) */
  async getAgentCard(): Promise<A2AAgentCard | undefined> {
    const agentId: bigint = await this.registry.getAgentId(this._agentKey);
    if (agentId === 0n) return undefined;

    const raw: string = await this.registry.getAgentMetadata(agentId);
    if (!raw) return undefined;

    try {
      const parsed = JSON.parse(raw);
      if (parsed.a2aVersion) return parsed as A2AAgentCard;
    } catch (err) {
      console.warn("[SelfAgent] Failed to parse agent card metadata:", err);
    }
    return undefined;
  }

  /**
   * Build and write an A2A Agent Card to on-chain metadata.
   * Auto-populates selfProtocol fields from on-chain data.
   * Returns the transaction hash.
   */
  async setAgentCard(fields: {
    name: string;
    description?: string;
    url?: string;
    skills?: AgentSkill[];
  }): Promise<string> {
    const agentId: bigint = await this.registry.getAgentId(this._agentKey);
    if (agentId === 0n) throw new Error("Agent not registered");

    const providerAddr: string = await this.registry.getProofProvider(agentId);
    if (!providerAddr || providerAddr === ethers.ZeroAddress) {
      throw new Error("Agent has no proof provider — cannot build card");
    }
    const provider = new ethers.Contract(
      providerAddr,
      PROVIDER_ABI,
      this.registry.runner
    );

    const card = await buildAgentCard(
      Number(agentId),
      this.registry,
      provider,
      fields
    );

    const registryWithSigner = this.registry.connect(this.wallet) as ethers.Contract;
    const tx = await registryWithSigner.updateAgentMetadata(
      agentId,
      JSON.stringify(card)
    );
    await tx.wait();
    return tx.hash;
  }

  /** Returns a data: URI containing the base64-encoded Agent Card JSON */
  async toAgentCardDataURI(): Promise<string> {
    const card = await this.getAgentCard();
    if (!card) throw new Error("No A2A Agent Card set");
    const json = JSON.stringify(card);
    const encoded = btoa(json);
    return `data:application/json;base64,${encoded}`;
  }

  /** Read ZK-attested credentials for this agent from on-chain */
  async getCredentials(): Promise<Record<string, unknown> | undefined> {
    const agentId: bigint = await this.registry.getAgentId(this._agentKey);
    if (agentId === 0n) return undefined;

    try {
      return await this.registry.getAgentCredentials(agentId);
    } catch {
      return undefined;
    }
  }

  /** Read the verification strength score from the provider that verified this agent */
  async getVerificationStrength(): Promise<number> {
    const agentId: bigint = await this.registry.getAgentId(this._agentKey);
    if (agentId === 0n) return 0;

    const providerAddr: string = await this.registry.getProofProvider(agentId);
    if (providerAddr === ethers.ZeroAddress) return 0;

    const provider = new ethers.Contract(
      providerAddr,
      PROVIDER_ABI,
      this.registry.runner
    );
    const strength: number = await provider.verificationStrength();
    return Number(strength);
  }
}
