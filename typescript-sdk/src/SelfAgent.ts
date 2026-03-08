// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";
import { HEADERS, NETWORKS, DEFAULT_NETWORK } from "./constants";
import type { NetworkName } from "./constants";
import type { A2AAgentCard, AgentSkill } from "./agentCard";
import { buildAgentCard } from "./agentCard";
import { computeSigningMessage } from "./signing";
import type {
  RegistrationRequest,
  RegistrationSession,
  DeregistrationSession,
  ApiAgentInfo,
  ApiAgentsForHuman,
} from "./registration-flow";
import {
  requestRegistration as _requestRegistration,
  requestDeregistration as _requestDeregistration,
  getAgentInfo as _getAgentInfo,
  getAgentsForHuman as _getAgentsForHuman,
} from "./registration-flow";

import {
  typedProvider,
  typedRegistry,
  type TypedRegistryContract,
} from "./contract-types";
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
  private registry: TypedRegistryContract;
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

    this.registry = typedRegistry(
      config.registryAddress ?? net.registryAddress,
      provider,
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
      this.registry.hasHumanProof(agentId),
      this.registry.getHumanNullifier(agentId),
    ]);

    const agentCount: bigint =
      await this.registry.getAgentCountForHuman(nullifier);

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
    body?: string,
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

  // ─── A2A Agent Card Methods ──────────────────────────────────────────────

  /** Read the A2A Agent Card from on-chain metadata (if set) */
  async getAgentCard(): Promise<A2AAgentCard | undefined> {
    const agentId: bigint = await this.registry.getAgentId(this._agentKey);
    if (agentId === 0n) return undefined;

    const raw: string = await this.registry.getAgentMetadata(agentId);
    if (!raw) return undefined;

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!parsed || typeof parsed !== "object") return undefined;
      if (
        ("type" in parsed &&
          parsed.type ===
            "https://eips.ethereum.org/EIPS/eip-8004#registration-v1") ||
        "a2aVersion" in parsed
      ) {
        return parsed as A2AAgentCard;
      }
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
    const provider = typedProvider(providerAddr, this.registry.runner!);

    const card = await buildAgentCard(
      Number(agentId),
      this.registry,
      provider,
      fields,
    );

    const registryWithSigner = this.registry.connect(
      this.wallet,
    ) as ethers.Contract;
    const tx = (await registryWithSigner.updateAgentMetadata(
      agentId,
      JSON.stringify(card),
    )) as ethers.ContractTransactionResponse;
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
      return (await this.registry.getAgentCredentials(
        agentId,
      )) as unknown as Record<string, unknown>;
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

    const provider = typedProvider(providerAddr, this.registry.runner!);
    const strength: number = await provider.verificationStrength();
    return Number(strength);
  }

  // ─── Registration & Deregistration (REST API) ─────────────────────────────

  /**
   * Request agent registration through the Self Agent ID REST API.
   *
   * Returns a session with a QR code / deep link for the human to scan,
   * plus a `waitForCompletion()` method that polls until on-chain verification.
   *
   * ```ts
   * const session = await SelfAgent.requestRegistration({
   *   mode: "linked",
   *   network: "mainnet",
   *   disclosures: { minimumAge: 18, ofac: true },
   *   humanAddress: "0x...",
   * });
   *
   * console.log(session.deepLink);       // open in Self app
   * console.log(session.humanInstructions); // tell human what to do
   *
   * const result = await session.waitForCompletion();
   * const agent = new SelfAgent({ privateKey: await session.exportKey() });
   * ```
   */
  static async requestRegistration(
    opts: RegistrationRequest,
  ): Promise<RegistrationSession> {
    return _requestRegistration(opts);
  }

  /**
   * Get agent info from the public REST API (no private key needed).
   */
  static async getAgentInfo(
    agentId: number,
    opts?: { network?: NetworkName; apiBase?: string },
  ): Promise<ApiAgentInfo> {
    return _getAgentInfo(agentId, opts);
  }

  /**
   * Get all agents registered for a human address from the public REST API.
   */
  static async getAgentsForHuman(
    address: string,
    opts?: { network?: NetworkName; apiBase?: string },
  ): Promise<ApiAgentsForHuman> {
    return _getAgentsForHuman(address, opts);
  }

  /**
   * Request deregistration for this agent through the Self Agent ID REST API.
   *
   * Returns a session with a QR code / deep link for the human to scan,
   * plus a `waitForCompletion()` method that polls until on-chain removal.
   *
   * ```ts
   * const session = await agent.requestDeregistration();
   * console.log(session.deepLink);
   * await session.waitForCompletion();
   * ```
   */
  async requestDeregistration(opts?: {
    apiBase?: string;
  }): Promise<DeregistrationSession> {
    const network = this.networkName();
    return _requestDeregistration({
      network,
      agentAddress: this.wallet.address,
      apiBase: opts?.apiBase,
    });
  }

  /**
   * Fetch this agent's credentials from the public REST API.
   * Returns null if the agent is not registered or has no credentials.
   */
  async getCredentialsFromApi(opts?: {
    apiBase?: string;
  }): Promise<Record<string, unknown> | null> {
    try {
      const info = await this.getInfo();
      if (info.agentId === 0n) return null;

      const network = this.networkName();
      const apiInfo = await _getAgentInfo(Number(info.agentId), {
        network,
        apiBase: opts?.apiBase,
      });
      return apiInfo.credentials ?? null;
    } catch {
      return null;
    }
  }

  /** Resolve the network name from the registry address */
  private networkName(): NetworkName {
    const registryAddr = (this.registry.target as string).toLowerCase();
    for (const [name, config] of Object.entries(NETWORKS)) {
      if (config.registryAddress.toLowerCase() === registryAddr) {
        return name as NetworkName;
      }
    }
    return DEFAULT_NETWORK;
  }
}
