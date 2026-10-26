// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * `SelfAgent`: agent-side SDK for secp256k1 (Ethereum key) agents.
 *
 * Signs outgoing HTTP requests, reads on-chain status and manages the A2A
 * Agent Card. Ed25519 agents use `Ed25519Agent` instead.
 */

import { ethers } from "ethers";
import { HEADERS, NETWORKS, DEFAULT_NETWORK } from "./constants";
import type { NetworkName } from "./constants";
import type { A2AAgentCard, AgentSkill } from "./agentCard";
import { buildAgentCard } from "./agentCard";
import { computeSigningMessage, withAgentHeaders } from "./signing";
import type {
  RegistrationRequest,
  RegistrationDisclosureRequest,
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
import { readAgentInfo, type AgentInfo } from "./agent-info";

/** Constructor options for `SelfAgent`. Provide `privateKey` or `signer`. */
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

/**
 * Agent-side SDK for Self Agent ID.
 *
 * The agent's on-chain identity is its Ethereum address, zero-padded to bytes32:
 *   agentKey = zeroPadValue(address, 32)
 *
 * For off-chain authentication, the agent signs each request with its private key.
 * Services verify the signature, recover the signer address, and check on-chain status.
 *
 * @example
 * ```ts
 * const agent = new SelfAgent({ privateKey: "0x...", network: "testnet" });
 * const { isVerified } = await agent.getInfo();
 * const res = await agent.fetch("https://api.example.com/data", {
 *   method: "POST",
 *   body: JSON.stringify({ q: "hello" }),
 * });
 * ```
 */
export class SelfAgent {
  private wallet: ethers.Signer & { address: string };
  private registry: TypedRegistryContract;
  private _agentKey: string;

  /**
   * Create an agent bound to a registry and RPC endpoint.
   *
   * @param config - Key (`privateKey` or `signer`) plus optional network / registry / RPC overrides.
   * @throws If neither `privateKey` nor `signer` is given, or the private key is invalid.
   */
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
    this._agentKey = ethers.zeroPadValue(this.wallet.address, 32);
  }

  /** The agent's on-chain key (bytes32): its address zero-padded to 32 bytes. */
  get agentKey(): string {
    return this._agentKey;
  }

  /** The agent's Ethereum address. */
  get address(): string {
    return this.wallet.address;
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
    return readAgentInfo(this.registry, this.wallet.address, this._agentKey);
  }

  /**
   * Generate authentication headers for a request.
   *
   * The service recovers the signer address from the signature,
   * converts it to a bytes32 agent key, and checks on-chain status.
   * Signature covers: keccak256(timestamp + method + canonicalPathAndQuery + bodyHash).
   *
   * @param method - HTTP method.
   * @param url - Request URL (absolute or path; only path + query are signed).
   * @param body - Request body exactly as it will be sent, if any.
   * @returns The address, signature and timestamp headers.
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

  // ─── A2A Agent Card Methods ──────────────────────────────────────────────

  /**
   * Read the A2A Agent Card from this agent's on-chain metadata.
   *
   * @returns The parsed card, or undefined if unregistered, unset or not a card.
   * @throws If an RPC call fails.
   */
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
   * Build an A2A Agent Card and write it to on-chain metadata.
   * Auto-populates selfProtocol fields from on-chain data.
   *
   * The registry only accepts metadata updates from the agent NFT's owner,
   * which is the agent key only for wallet-free agents. For linked, privy and
   * smartwallet agents the human's wallet owns the NFT, so this throws before
   * sending a transaction; build the card with `buildAgentCard()` and submit
   * `updateAgentMetadata` from the owner wallet instead.
   *
   * @param fields - Card name plus optional description, url and skills.
   * @returns The transaction hash, after the transaction is mined.
   * @throws If the agent is unregistered, is not the NFT owner, has no proof
   *   provider, or the transaction fails.
   */
  async setAgentCard(fields: {
    name: string;
    description?: string;
    url?: string;
    skills?: AgentSkill[];
  }): Promise<string> {
    const agentId: bigint = await this.registry.getAgentId(this._agentKey);
    if (agentId === 0n) throw new Error("Agent not registered");

    const owner: string = await this.registry.ownerOf(agentId);
    if (owner.toLowerCase() !== this.wallet.address.toLowerCase()) {
      throw new Error(
        `setAgentCard must be sent by the agent NFT owner (${owner}), not the agent key. ` +
          "For linked, privy and smartwallet agents the owner is the human's wallet: " +
          "build the card with buildAgentCard() and call updateAgentMetadata from that wallet.",
      );
    }

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

  /**
   * Encode the on-chain Agent Card as a base64 `data:` URI.
   *
   * The JSON is UTF-8 encoded first, so any Unicode (e.g. names, emoji) works.
   *
   * @returns `data:application/json;base64,...`.
   * @throws If no card is set, or the registry RPC call fails.
   */
  async toAgentCardDataURI(): Promise<string> {
    const card = await this.getAgentCard();
    if (!card) throw new Error("No A2A Agent Card set");
    const json = JSON.stringify(card);
    // ethers' helpers work in Node and browsers, unlike btoa (Latin-1 only)
    // or Buffer (Node only).
    const encoded = ethers.encodeBase64(ethers.toUtf8Bytes(json));
    return `data:application/json;base64,${encoded}`;
  }

  /**
   * Read this agent's ZK-attested credentials from the registry.
   *
   * @returns The raw credentials struct, or undefined if unregistered or the call reverts.
   */
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

  /**
   * Read the verification strength score from the provider that verified this agent.
   *
   * @returns The provider's strength (0-100), or 0 if unregistered or no provider.
   * @throws If an RPC call fails.
   */
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
   * Same as the standalone `requestRegistration()`.
   *
   * @param opts - Mode, network, disclosures and mode-specific fields.
   * @returns A session with a deep link / QR URL, `waitForCompletion()` and `exportKey()`.
   * @throws RegistrationError if the API rejects the request.
   *
   * @example
   * ```ts
   * const session = await SelfAgent.requestRegistration({
   *   mode: "linked",
   *   disclosures: { minimumAge: 18, ofac: true },
   *   humanAddress: "0x...",
   * });
   * await session.waitForCompletion();
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
   *
   * @param agentId - On-chain agent ID.
   * @param opts - Optional `network` and `apiBase`.
   * @returns The agent record.
   * @throws RegistrationError (status 404 if the agent does not exist).
   */
  static async getAgentInfo(
    agentId: number,
    opts?: { network?: NetworkName; apiBase?: string },
  ): Promise<ApiAgentInfo> {
    return _getAgentInfo(agentId, opts);
  }

  /**
   * Get all agents registered for a human address from the public REST API.
   *
   * @param address - The human's wallet address.
   * @param opts - Optional `network` and `apiBase`.
   * @returns The agents list (empty when none).
   * @throws RegistrationError on API errors.
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
   * The network is inferred from the registry address (custom registries fall back to mainnet).
   *
   * @param opts.disclosures - Disclosures used at registration.
   * @param opts.apiBase - API base URL override.
   * @returns A session with a deep link / QR URL and `waitForCompletion()`.
   * @throws RegistrationError if the API rejects the request.
   */
  async requestDeregistration(opts?: {
    /** Credential disclosures (should match the original registration) */
    disclosures?: RegistrationDisclosureRequest;
    apiBase?: string;
  }): Promise<DeregistrationSession> {
    const network = this.networkName();
    return _requestDeregistration({
      network,
      agentAddress: this.wallet.address,
      disclosures: opts?.disclosures,
      apiBase: opts?.apiBase,
    });
  }

  /**
   * Fetch this agent's credentials from the public REST API.
   *
   * @param opts.apiBase - API base URL override.
   * @returns The credentials, or null if unregistered, absent, or on any error.
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

  /**
   * Resolve the network name from the registry address.
   *
   * @returns The matching network, or the default (mainnet) for a custom registry.
   */
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
