// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Service-side verification of signed agent requests (`SelfAgentVerifier`),
 * its builder, the Express `auth()` middleware and the standalone `verifyAgent()`.
 *
 * Caches (on-chain status, replay, rate limits) are in-memory and per process.
 */

import * as ed from "@noble/ed25519";
import { createHash } from "node:crypto";
import { ethers } from "ethers";

// @noble/ed25519 v3 requires a SHA-512 implementation for sync methods.
if (!ed.hashes.sha512) {
  ed.hashes.sha512 = (message: Uint8Array) =>
    new Uint8Array(createHash("sha512").update(message).digest());
}
import {
  HEADERS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_CACHE_TTL_MS,
  NETWORKS,
  DEFAULT_NETWORK,
  REAUTH_BASE_URL,
  CHAIN_IDS,
} from "./constants";
import type { NetworkName } from "./constants";
import { canonicalizeSigningUrl, computeSigningMessage } from "./signing";
import type { VerifyResult } from "./types";
import { isProofExpiringSoon } from "./types";

import { typedRegistry, type TypedRegistryContract } from "./contract-types";

/** Constructor options for `SelfAgentVerifier`. Every field is optional. */
export interface VerifierConfig {
  /** Network to use: "mainnet" (default) or "testnet" */
  network?: NetworkName;
  /** Override: custom registry address (takes precedence over network) */
  registryAddress?: string;
  /** Override: custom RPC URL (takes precedence over network) */
  rpcUrl?: string;
  /** Max age for signed timestamps (default: 5 min) */
  maxAgeMs?: number;
  /** TTL for on-chain status cache (default: 1 min) */
  cacheTtlMs?: number;
  /** Max agents allowed per human (default: 1 = sybil resistant). Set to 0 to disable. */
  maxAgentsPerHuman?: number;
  /** Include ZK-attested credentials in verification result (default: false) */
  includeCredentials?: boolean;
  /**
   * Require that the agent's proof-of-human was provided by Self Protocol.
   *
   * When true (default), the verifier checks that `getProofProvider(agentId)`
   * matches the registry's `selfProofProvider()` address. This prevents agents
   * verified by third-party providers from being accepted.
   *
   * Set to false only if you intentionally want to accept agents verified by
   * any approved provider on the registry.
   */
  requireSelfProvider?: boolean;
  /**
   * Reject duplicate signatures within the validity window (default: true).
   * Uses an in-memory replay cache per process.
   */
  enableReplayProtection?: boolean;
  /** Max replay cache entries before pruning (default: 10k) */
  replayCacheMaxEntries?: number;
  /** Minimum age for agent's human (credential check, default: disabled). Requires `includeCredentials`. */
  minimumAge?: number;
  /** Require OFAC screening passed (credential check, default: false). Requires `includeCredentials`. */
  requireOFACPassed?: boolean;
  /** Require nationality in list (credential check, default: disabled). Requires `includeCredentials`. */
  allowedNationalities?: string[];
  /** In-memory per-agent rate limiting */
  rateLimitConfig?: RateLimitConfig;
}

/** Rate limit configuration for per-agent request throttling */
export interface RateLimitConfig {
  /** Max requests per agent per minute */
  perMinute?: number;
  /** Max requests per agent per hour */
  perHour?: number;
}

/**
 * Flat config for `SelfAgentVerifier.fromConfig()`. Field names mirror the
 * builder methods; any credential requirement turns on credential fetching.
 */
export interface VerifierFromConfig {
  network?: NetworkName;
  registryAddress?: string;
  rpcUrl?: string;
  /** Minimum age (maps to `minimumAge`) */
  requireAge?: number;
  /** Require OFAC screening passed */
  requireOFAC?: boolean;
  /** Allowed nationality codes */
  requireNationality?: string[];
  requireSelfProvider?: boolean;
  /** Max agents per human (default 1; 0 disables) */
  sybilLimit?: number;
  rateLimit?: RateLimitConfig;
  /** Replay protection (default true) */
  replayProtection?: boolean;
  maxAgeMs?: number;
  cacheTtlMs?: number;
}

/** ZK-attested credential claims stored on-chain for an agent (empty strings when not disclosed). */
export interface AgentCredentials {
  issuingState: string;
  name: string[];
  idNumber: string;
  nationality: string;
  dateOfBirth: string;
  gender: string;
  expiryDate: string;
  olderThan: bigint;
  ofac: boolean[];
}

/** Outcome of `SelfAgentVerifier.verify()`. Identity fields are zero when the signature check failed. */
export interface VerificationResult {
  /** True only if every check passed */
  valid: boolean;
  /** The agent's Ethereum address (recovered from signature) */
  agentAddress: string;
  /** The agent's on-chain key (bytes32) */
  agentKey: string;
  /** On-chain agent ID; 0n if not registered */
  agentId: bigint;
  /** Number of agents registered by the same human (0n when the sybil check is disabled) */
  agentCount: bigint;
  /** Human's nullifier, for rate limiting by human (0n when the sybil check is disabled) */
  nullifier: bigint;
  /** ZK-attested credentials (only populated when includeCredentials is true) */
  credentials?: AgentCredentials;
  /** Why verification failed (unset when valid) */
  error?: string;
  /** Milliseconds until the rate limit resets (only set when rate limited) */
  retryAfterMs?: number;
  /** When the agent's human proof expires (undefined if no expiry set) */
  proofExpiresAt?: Date;
  /** Number of days until the proof expires (undefined if no expiry set, negative if already expired) */
  daysUntilExpiry?: number;
  /** Whether the proof has not expired yet but expires within 30 days */
  isExpiringSoon?: boolean;
}

/** The verified agent that {@link SelfAgentVerifier.auth} attaches as `req.agent`. */
export interface VerifiedAgent {
  /** Agent address (recovered from the signature, or derived from the Ed25519 key) */
  address: string;
  agentKey: string;
  agentId: bigint;
  agentCount: bigint;
  nullifier: bigint;
  credentials?: AgentCredentials;
}

declare global {
  // Types `req.agent` for Express users (merges with @types/express).
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `SelfAgentVerifier.auth()` once the request is verified. */
      agent?: VerifiedAgent;
    }
  }
}

/** Cached on-chain status for one agent key. */
interface CacheEntry {
  isVerified: boolean;
  isProofFresh: boolean;
  agentId: bigint;
  agentCount: bigint;
  nullifier: bigint;
  providerAddress: string;
  proofExpiresAtTimestamp: bigint;
  /** Cache entry expiry (ms since epoch) */
  expiresAt: number;
}

/** Replay-cache entry; `expiresAt` is the signed timestamp + maxAgeMs. */
interface ReplayEntry {
  expiresAt: number;
}

// ── Rate limiter: sliding window, keyed by agent address ────────────────────

/** Request timestamps (ms) for one agent within the last hour. */
interface RateBucket {
  timestamps: number[];
}

/** In-memory sliding-window rate limiter (per minute and/or per hour). */
class RateLimiter {
  private perMinute: number;
  private perHour: number;
  private buckets = new Map<string, RateBucket>();

  /**
   * @param config - Limits; an unset or 0 limit is not enforced.
   */
  constructor(config: RateLimitConfig) {
    this.perMinute = config.perMinute ?? 0;
    this.perHour = config.perHour ?? 0;
  }

  /**
   * Check the limits for an agent and record the request if allowed.
   *
   * @param agentAddress - Agent address (case-insensitive key).
   * @returns null if allowed, or `{ error, retryAfterMs }` if rate limited.
   */
  check(agentAddress: string): { error: string; retryAfterMs: number } | null {
    const now = Date.now();
    const key = agentAddress.toLowerCase();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // Prune timestamps older than 1 hour (the longest window).
    const oneHourAgo = now - 60 * 60 * 1000;
    bucket.timestamps = bucket.timestamps.filter((t) => t > oneHourAgo);

    if (this.perMinute > 0) {
      const oneMinuteAgo = now - 60 * 1000;
      const recentMinute = bucket.timestamps.filter((t) => t > oneMinuteAgo);
      if (recentMinute.length >= this.perMinute) {
        const oldest = recentMinute[0];
        const retryAfterMs = oldest + 60 * 1000 - now;
        return {
          error: `Rate limit exceeded (${this.perMinute}/min)`,
          retryAfterMs: Math.max(1, retryAfterMs),
        };
      }
    }

    if (this.perHour > 0) {
      if (bucket.timestamps.length >= this.perHour) {
        const oldest = bucket.timestamps[0];
        const retryAfterMs = oldest + 60 * 60 * 1000 - now;
        return {
          error: `Rate limit exceeded (${this.perHour}/hr)`,
          retryAfterMs: Math.max(1, retryAfterMs),
        };
      }
    }

    bucket.timestamps.push(now);
    return null;
  }
}

// ── VerifierBuilder: chainable builder API ──────────────────────────────────

/**
 * Chainable builder for `SelfAgentVerifier` (get one from `SelfAgentVerifier.create()`).
 * Every setter returns the builder; unset options keep the verifier defaults.
 */
export class VerifierBuilder {
  private _network?: NetworkName;
  private _registryAddress?: string;
  private _rpcUrl?: string;
  private _maxAgeMs?: number;
  private _cacheTtlMs?: number;
  private _maxAgentsPerHuman?: number;
  private _includeCredentials?: boolean;
  private _requireSelfProvider?: boolean;
  private _enableReplayProtection?: boolean;
  private _minimumAge?: number;
  private _requireOFACPassed?: boolean;
  private _allowedNationalities?: string[];
  private _rateLimitConfig?: RateLimitConfig;

  /**
   * Set the network.
   *
   * @param name - "mainnet" or "testnet".
   * @returns This builder.
   */
  network(name: NetworkName): this {
    this._network = name;
    return this;
  }

  /**
   * Set a custom registry address (overrides the network's).
   *
   * @param addr - Registry contract address.
   * @returns This builder.
   */
  registry(addr: string): this {
    this._registryAddress = addr;
    return this;
  }

  /**
   * Set a custom RPC URL (overrides the network's).
   *
   * @param url - JSON-RPC endpoint.
   * @returns This builder.
   */
  rpc(url: string): this {
    this._rpcUrl = url;
    return this;
  }

  /**
   * Require the agent's human to be at least `n` years old (enables credential fetching).
   *
   * @param n - Minimum age, compared with the on-chain `olderThan`.
   * @returns This builder.
   */
  requireAge(n: number): this {
    this._minimumAge = n;
    return this;
  }

  /**
   * Require OFAC screening passed (enables credential fetching).
   *
   * @returns This builder.
   */
  requireOFAC(): this {
    this._requireOFACPassed = true;
    return this;
  }

  /**
   * Require the human's nationality to be one of `codes` (enables credential fetching).
   *
   * @param codes - Allowed nationality codes, as stored on-chain.
   * @returns This builder.
   */
  requireNationality(...codes: string[]): this {
    this._allowedNationalities = codes;
    return this;
  }

  /**
   * Require (or stop requiring) Self Protocol as proof provider. Required by default.
   *
   * @param enabled - Pass `false` to accept any proof provider (default true).
   * @returns This builder.
   */
  requireSelfProvider(enabled = true): this {
    this._requireSelfProvider = enabled;
    return this;
  }

  /**
   * Set the max agents per human.
   *
   * @param n - Limit (default 1; 0 disables the check).
   * @returns This builder.
   */
  sybilLimit(n: number): this {
    this._maxAgentsPerHuman = n;
    return this;
  }

  /**
   * Enable in-memory per-agent rate limiting.
   *
   * @param config - Per-minute and/or per-hour limits.
   * @returns This builder.
   */
  rateLimit(config: RateLimitConfig): this {
    this._rateLimitConfig = config;
    return this;
  }

  /**
   * Enable or disable replay protection (default: on).
   *
   * @param enabled - False to accept repeated signatures.
   * @returns This builder.
   */
  replayProtection(enabled = true): this {
    this._enableReplayProtection = enabled;
    return this;
  }

  /**
   * Include ZK credentials in the verification result.
   *
   * @returns This builder.
   */
  includeCredentials(): this {
    this._includeCredentials = true;
    return this;
  }

  /**
   * Set the max signed-timestamp age.
   *
   * @param ms - Window in milliseconds (default 5 minutes).
   * @returns This builder.
   */
  maxAge(ms: number): this {
    this._maxAgeMs = ms;
    return this;
  }

  /**
   * Set the on-chain status cache TTL.
   *
   * @param ms - TTL in milliseconds (default 1 minute).
   * @returns This builder.
   */
  cacheTtl(ms: number): this {
    this._cacheTtlMs = ms;
    return this;
  }

  /**
   * Build the verifier. Credential fetching is enabled automatically when any
   * credential requirement is set.
   *
   * @returns A configured `SelfAgentVerifier`.
   */
  build(): SelfAgentVerifier {
    const needsCredentials =
      this._minimumAge != null ||
      this._requireOFACPassed ||
      (this._allowedNationalities && this._allowedNationalities.length > 0);

    return new SelfAgentVerifier({
      network: this._network,
      registryAddress: this._registryAddress,
      rpcUrl: this._rpcUrl,
      maxAgeMs: this._maxAgeMs,
      cacheTtlMs: this._cacheTtlMs,
      maxAgentsPerHuman: this._maxAgentsPerHuman,
      includeCredentials:
        needsCredentials || this._includeCredentials || undefined,
      requireSelfProvider: this._requireSelfProvider,
      enableReplayProtection: this._enableReplayProtection,
      minimumAge: this._minimumAge,
      requireOFACPassed: this._requireOFACPassed,
      allowedNationalities: this._allowedNationalities,
      rateLimitConfig: this._rateLimitConfig,
    });
  }
}

// ── SelfAgentVerifier ───────────────────────────────────────────────────────

/**
 * Service-side verifier for Self Agent ID requests.
 *
 * Checks, in order: timestamp freshness, signature (ECDSA recovery or Ed25519),
 * replay, on-chain registration, proof freshness, Self proof provider, sybil
 * limit, credential requirements, rate limit.
 *
 * The signer address is RECOVERED from the signature, never trusted from headers,
 * so you can't claim to be an agent without holding its private key.
 * Configure with `new SelfAgentVerifier(config)`, `create()` (builder) or `fromConfig()`.
 *
 * @example
 * ```ts
 * const verifier = SelfAgentVerifier.create().network("testnet").requireAge(18).build();
 * // auth() needs the exact body bytes: keep them while parsing JSON.
 * app.use(express.json({ verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } }));
 * app.use("/api", verifier.auth()); // sets req.agent on success
 * ```
 */
export class SelfAgentVerifier {
  private registry: TypedRegistryContract;
  private maxAgeMs: number;
  private cacheTtlMs: number;
  private maxAgentsPerHuman: number;
  private includeCredentials: boolean;
  private requireSelfProvider: boolean;
  private enableReplayProtection: boolean;
  private replayCacheMaxEntries: number;
  private minimumAge: number | undefined;
  private requireOFACPassed: boolean;
  private allowedNationalities: string[] | undefined;
  private rateLimiter: RateLimiter | null;
  private cache = new Map<string, CacheEntry>();
  private replayCache = new Map<string, ReplayEntry>();
  private selfProviderCache: { address: string; expiresAt: number } | null =
    null;

  /**
   * Create a verifier. With no config it verifies against mainnet with
   * sybil limit 1, replay protection and the Self provider check on.
   *
   * @param config - Optional overrides (see `VerifierConfig`).
   */
  constructor(config: VerifierConfig = {}) {
    const net = NETWORKS[config.network ?? DEFAULT_NETWORK];
    const provider = new ethers.JsonRpcProvider(config.rpcUrl ?? net.rpcUrl);
    this.registry = typedRegistry(
      config.registryAddress ?? net.registryAddress,
      provider,
    );
    this.maxAgeMs = config.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxAgentsPerHuman = config.maxAgentsPerHuman ?? 1;
    this.includeCredentials = config.includeCredentials ?? false;
    this.requireSelfProvider = config.requireSelfProvider ?? true;
    this.enableReplayProtection = config.enableReplayProtection ?? true;
    this.replayCacheMaxEntries = config.replayCacheMaxEntries ?? 10_000;
    this.minimumAge = config.minimumAge;
    this.requireOFACPassed = config.requireOFACPassed ?? false;
    this.allowedNationalities = config.allowedNationalities;
    this.rateLimiter = config.rateLimitConfig
      ? new RateLimiter(config.rateLimitConfig)
      : null;
  }

  /**
   * Start a chainable builder.
   *
   * @returns A new `VerifierBuilder`.
   */
  static create(): VerifierBuilder {
    return new VerifierBuilder();
  }

  /**
   * Create a verifier from a flat config object. Credential fetching is
   * enabled automatically when any credential requirement is set.
   *
   * @param cfg - Flat options (see `VerifierFromConfig`).
   * @returns A configured verifier.
   */
  static fromConfig(cfg: VerifierFromConfig): SelfAgentVerifier {
    const needsCredentials =
      cfg.requireAge != null ||
      cfg.requireOFAC ||
      (cfg.requireNationality && cfg.requireNationality.length > 0);

    return new SelfAgentVerifier({
      network: cfg.network,
      registryAddress: cfg.registryAddress,
      rpcUrl: cfg.rpcUrl,
      maxAgeMs: cfg.maxAgeMs,
      cacheTtlMs: cfg.cacheTtlMs,
      maxAgentsPerHuman: cfg.sybilLimit,
      includeCredentials: needsCredentials || undefined,
      requireSelfProvider: cfg.requireSelfProvider,
      enableReplayProtection: cfg.replayProtection,
      minimumAge: cfg.requireAge,
      requireOFACPassed: cfg.requireOFAC,
      allowedNationalities: cfg.requireNationality,
      rateLimitConfig: cfg.rateLimit,
    });
  }

  /**
   * Verify a signed agent request.
   *
   * The agent's identity is derived from the signature itself — not from
   * any header that could be spoofed. This is the key security property.
   *
   * @param params - Values taken from the request and its `x-self-agent-*` headers.
   * @param params.signature - `x-self-agent-signature`.
   * @param params.timestamp - `x-self-agent-timestamp` (Unix ms).
   * @param params.method - HTTP method.
   * @param params.url - Request URL or path (only path + query are compared).
   * @param params.body - The exact raw body received; never a re-serialised parsed body.
   * @param params.keytype - `x-self-agent-keytype`; "ed25519" selects Ed25519 verification.
   * @param params.agentKey - `x-self-agent-key`; required for Ed25519.
   * @returns A result with `valid` and, on failure, `error` (plus `retryAfterMs` when rate limited).
   * @throws If an on-chain status RPC call fails.
   */
  async verify(params: {
    signature: string;
    timestamp: string;
    method: string;
    url: string;
    body?: string;
    /** Key type indicator — when "ed25519", uses Ed25519 verification */
    keytype?: string;
    /** Agent's public key (required for Ed25519, informational for secp256k1) */
    agentKey?: string;
  }): Promise<VerificationResult> {
    const { signature, timestamp, method, url, body, keytype } = params;
    const empty: VerificationResult = {
      valid: false,
      agentAddress: ethers.ZeroAddress,
      agentKey: ethers.ZeroHash,
      agentId: 0n,
      agentCount: 0n,
      nullifier: 0n,
    };

    // 1. Timestamp freshness
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > this.maxAgeMs) {
      return { ...empty, error: "Timestamp expired or invalid" };
    }

    // 2. Reconstruct the signed message
    const canonicalUrl = canonicalizeSigningUrl(url);
    const message = computeSigningMessage(
      timestamp,
      method,
      canonicalUrl,
      body,
    );

    let signerAddress: string;
    let agentKey: string;

    if (keytype === "ed25519") {
      // 3a. Ed25519: verify against the supplied public key.
      if (!params.agentKey) {
        return {
          ...empty,
          error: "Missing agent key for Ed25519 verification",
        };
      }

      try {
        const msgBytes = ethers.getBytes(message); // 32-byte keccak256 hash
        const sigBytes = ethers.getBytes(signature); // 64-byte Ed25519 signature
        const pubkeyBytes = ethers.getBytes(params.agentKey); // 32-byte Ed25519 pubkey
        const valid = await ed.verifyAsync(sigBytes, msgBytes, pubkeyBytes);
        if (!valid) {
          return { ...empty, error: "Invalid Ed25519 signature" };
        }
      } catch {
        return { ...empty, error: "Invalid Ed25519 signature" };
      }

      agentKey = params.agentKey;
      // Matches Ed25519Verifier.deriveAddress on-chain.
      const pubkeyBytes = ethers.getBytes(params.agentKey);
      const hash = ethers.keccak256(pubkeyBytes);
      signerAddress = ethers.getAddress("0x" + hash.slice(-40));
    } else {
      // 3b. secp256k1: recover the signer address from the signature.
      try {
        signerAddress = ethers.verifyMessage(
          ethers.getBytes(message),
          signature,
        );
      } catch {
        return { ...empty, error: "Invalid signature" };
      }

      agentKey = ethers.zeroPadValue(signerAddress, 32);
    }

    // 4. Replay cache check (after signature validity to avoid cache poisoning)
    if (this.enableReplayProtection) {
      const replayError = this.checkAndRecordReplay(signature, message, ts);
      if (replayError) {
        return {
          ...empty,
          agentAddress: signerAddress,
          agentKey,
          error: replayError,
        };
      }
    }

    // 5. On-chain status (cached)
    const {
      isVerified,
      isProofFresh,
      agentId,
      agentCount,
      nullifier,
      providerAddress,
      proofExpiresAtTimestamp,
    } = await this.checkOnChain(agentKey);

    const proofExpiresAt =
      proofExpiresAtTimestamp > 0n
        ? new Date(Number(proofExpiresAtTimestamp) * 1000)
        : undefined;
    const now = Math.floor(Date.now() / 1000);
    const daysUntilExpiry =
      proofExpiresAtTimestamp > 0n
        ? Math.floor((Number(proofExpiresAtTimestamp) - now) / 86400)
        : undefined;
    const isExpiringSoon =
      proofExpiresAt !== undefined && isProofExpiringSoon(proofExpiresAt);

    if (!isVerified) {
      return {
        valid: false,
        agentAddress: signerAddress,
        agentKey,
        agentId,
        agentCount,
        nullifier,
        proofExpiresAt,
        daysUntilExpiry,
        isExpiringSoon,
        error: "Agent not verified on-chain",
      };
    }

    // 6. Proof freshness: an expired proof does not verify.
    if (!isProofFresh) {
      return {
        valid: false,
        agentAddress: signerAddress,
        agentKey,
        agentId,
        agentCount,
        nullifier,
        proofExpiresAt,
        daysUntilExpiry,
        isExpiringSoon,
        error: "Agent's human proof has expired",
      };
    }

    // 7. Proof provider must be Self Protocol's
    if (this.requireSelfProvider && agentId > 0n) {
      let selfProvider: string;
      try {
        selfProvider = await this.getSelfProviderAddress();
      } catch {
        return {
          valid: false,
          agentAddress: signerAddress,
          agentKey,
          agentId,
          agentCount,
          nullifier,
          proofExpiresAt,
          daysUntilExpiry,
          isExpiringSoon,
          error: "Unable to verify proof provider — RPC error",
        };
      }
      if (providerAddress.toLowerCase() !== selfProvider.toLowerCase()) {
        return {
          valid: false,
          agentAddress: signerAddress,
          agentKey,
          agentId,
          agentCount,
          nullifier,
          proofExpiresAt,
          daysUntilExpiry,
          isExpiringSoon,
          error: "Agent was not verified by Self — proof provider mismatch",
        };
      }
    }

    // 8. Sybil resistance: reject if human has too many agents
    if (
      this.maxAgentsPerHuman > 0 &&
      agentCount > BigInt(this.maxAgentsPerHuman)
    ) {
      return {
        valid: false,
        agentAddress: signerAddress,
        agentKey,
        agentId,
        agentCount,
        nullifier,
        proofExpiresAt,
        daysUntilExpiry,
        isExpiringSoon,
        error: `Human has ${agentCount} agents (max ${this.maxAgentsPerHuman})`,
      };
    }

    // 9. Credentials (if requested)
    let credentials: AgentCredentials | undefined;
    if (this.includeCredentials && agentId > 0n) {
      credentials = await this.fetchCredentials(agentId);
    }

    // 10. Credential requirements (skipped if credentials could not be read)
    if (credentials) {
      if (
        this.minimumAge != null &&
        credentials.olderThan < BigInt(this.minimumAge)
      ) {
        return {
          valid: false,
          agentAddress: signerAddress,
          agentKey,
          agentId,
          agentCount,
          nullifier,
          credentials,
          proofExpiresAt,
          daysUntilExpiry,
          isExpiringSoon,
          error: `Agent's human does not meet minimum age (required: ${this.minimumAge}, got: ${credentials.olderThan})`,
        };
      }

      if (this.requireOFACPassed && !credentials.ofac?.[0]) {
        return {
          valid: false,
          agentAddress: signerAddress,
          agentKey,
          agentId,
          agentCount,
          nullifier,
          credentials,
          proofExpiresAt,
          daysUntilExpiry,
          isExpiringSoon,
          error: "Agent's human did not pass OFAC screening",
        };
      }

      if (this.allowedNationalities && this.allowedNationalities.length > 0) {
        if (!this.allowedNationalities.includes(credentials.nationality)) {
          return {
            valid: false,
            agentAddress: signerAddress,
            agentKey,
            agentId,
            agentCount,
            nullifier,
            credentials,
            proofExpiresAt,
            daysUntilExpiry,
            isExpiringSoon,
            error: `Nationality "${credentials.nationality}" not in allowed list`,
          };
        }
      }
    }

    // 11. Rate limiting (per-agent, in-memory sliding window)
    if (this.rateLimiter) {
      const limited = this.rateLimiter.check(signerAddress);
      if (limited) {
        return {
          valid: false,
          agentAddress: signerAddress,
          agentKey,
          agentId,
          agentCount,
          nullifier,
          credentials,
          proofExpiresAt,
          daysUntilExpiry,
          isExpiringSoon,
          error: limited.error,
          retryAfterMs: limited.retryAfterMs,
        };
      }
    }

    return {
      valid: true,
      agentAddress: signerAddress,
      agentKey,
      agentId,
      agentCount,
      nullifier,
      credentials,
      proofExpiresAt,
      daysUntilExpiry,
      isExpiringSoon,
    };
  }

  /**
   * Read on-chain agent status, cached per agent key for `cacheTtlMs`.
   * Sybil and provider fields are only fetched when those checks are enabled.
   *
   * @param agentKey - bytes32 agent key.
   * @returns Registration, freshness, sybil, provider and expiry data.
   * @throws If an RPC call fails.
   */
  private async checkOnChain(agentKey: string): Promise<{
    isVerified: boolean;
    isProofFresh: boolean;
    agentId: bigint;
    agentCount: bigint;
    nullifier: bigint;
    providerAddress: string;
    proofExpiresAtTimestamp: bigint;
  }> {
    const cached = this.cache.get(agentKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        isVerified: cached.isVerified,
        isProofFresh: cached.isProofFresh,
        agentId: cached.agentId,
        agentCount: cached.agentCount,
        nullifier: cached.nullifier,
        providerAddress: cached.providerAddress,
        proofExpiresAtTimestamp: cached.proofExpiresAtTimestamp,
      };
    }

    const [isVerified, agentId] = await Promise.all([
      this.registry.isVerifiedAgent(agentKey),
      this.registry.getAgentId(agentKey),
    ]);

    let agentCount = 0n;
    let nullifier = 0n;
    let providerAddress = "";
    let isProofFresh = false;
    let proofExpiresAtTimestamp = 0n;
    if (agentId > 0n) {
      const promises: Promise<unknown>[] = [];

      promises.push(
        this.registry.isProofFresh(agentId).then((fresh) => {
          isProofFresh = fresh;
        }),
      );

      promises.push(
        this.registry.proofExpiresAt(agentId).then((ts) => {
          proofExpiresAtTimestamp = ts;
        }),
      );

      if (this.maxAgentsPerHuman > 0) {
        promises.push(
          this.registry.getHumanNullifier(agentId).then(async (n: bigint) => {
            nullifier = n;
            agentCount = await this.registry.getAgentCountForHuman(n);
          }),
        );
      }

      if (this.requireSelfProvider) {
        promises.push(
          this.registry.getProofProvider(agentId).then((addr) => {
            providerAddress = addr;
          }),
        );
      }

      await Promise.all(promises);
    }

    this.cache.set(agentKey, {
      isVerified,
      isProofFresh,
      agentId,
      agentCount,
      nullifier,
      providerAddress,
      proofExpiresAtTimestamp,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return {
      isVerified,
      isProofFresh,
      agentId,
      agentCount,
      nullifier,
      providerAddress,
      proofExpiresAtTimestamp,
    };
  }

  /**
   * Get Self Protocol's own proof provider address from the registry.
   * Cached for 12x `cacheTtlMs` since it rarely changes.
   *
   * @returns The provider address.
   * @throws If the RPC call fails (callers fail closed).
   */
  private async getSelfProviderAddress(): Promise<string> {
    if (
      this.selfProviderCache &&
      this.selfProviderCache.expiresAt > Date.now()
    ) {
      return this.selfProviderCache.address;
    }

    // No try/catch — let RPC errors propagate to fail closed
    const address: string = await this.registry.selfProofProvider();
    this.selfProviderCache = {
      address,
      expiresAt: Date.now() + this.cacheTtlMs * 12,
    };
    return address;
  }

  /**
   * Fetch ZK-attested credentials for an agent, filling missing fields with empty values.
   *
   * @param agentId - On-chain agent ID.
   * @returns The credentials, or undefined if the call fails.
   */
  private async fetchCredentials(
    agentId: bigint,
  ): Promise<AgentCredentials | undefined> {
    try {
      const raw = await this.registry.getAgentCredentials(agentId);
      return {
        issuingState: raw.issuingState ?? "",
        name: raw.name ?? [],
        idNumber: raw.idNumber ?? "",
        nationality: raw.nationality ?? "",
        dateOfBirth: raw.dateOfBirth ?? "",
        gender: raw.gender ?? "",
        expiryDate: raw.expiryDate ?? "",
        olderThan: raw.olderThan ?? 0n,
        ofac: raw.ofac ?? [false, false, false],
      };
    } catch {
      return undefined;
    }
  }

  /**
   * Clear the on-chain status, Self provider and replay caches.
   * Clearing the replay cache lets already-seen signatures through again until they age out.
   */
  clearCache(): void {
    this.cache.clear();
    this.selfProviderCache = null;
    this.replayCache.clear();
  }

  /**
   * Reject a signature seen before within its validity window, else record it.
   *
   * @param signature - Request signature.
   * @param message - Signed message hash.
   * @param ts - Signed timestamp (ms); the entry lives until `ts + maxAgeMs`.
   * @returns "Replay detected", or null if new.
   */
  private checkAndRecordReplay(
    signature: string,
    message: string,
    ts: number,
  ): string | null {
    const now = Date.now();
    this.pruneReplayCache(now);

    const key = `${signature.toLowerCase()}:${message.toLowerCase()}`;
    const existing = this.replayCache.get(key);
    if (existing && existing.expiresAt > now) {
      return "Replay detected";
    }

    const expiresAt = ts + this.maxAgeMs;
    this.replayCache.set(key, { expiresAt });
    return null;
  }

  /**
   * Drop expired replay entries, then the soonest-expiring ones if still over the size cap.
   *
   * @param now - Current time in ms.
   */
  private pruneReplayCache(now: number): void {
    for (const [key, entry] of this.replayCache) {
      if (entry.expiresAt <= now) {
        this.replayCache.delete(key);
      }
    }

    if (this.replayCache.size <= this.replayCacheMaxEntries) return;

    // Drop oldest-ish entries by earliest expiration first.
    const overflow = this.replayCache.size - this.replayCacheMaxEntries;
    const sorted = [...this.replayCache.entries()].sort(
      (a, b) => a[1].expiresAt - b[1].expiresAt,
    );
    for (let i = 0; i < overflow; i++) {
      this.replayCache.delete(sorted[i][0]);
    }
  }

  /**
   * Express/Connect middleware that verifies agent requests.
   *
   * Adds `req.agent` ({@link VerifiedAgent}) on success. Returns 401 on
   * failure, 429 when rate limited, 503 when the on-chain lookup fails.
   *
   * The signature covers the exact request body bytes, so the middleware needs
   * the raw body: set `req.rawBody` (string or Buffer), or leave `req.body` as
   * a string/Buffer (e.g. `express.text()` / `express.raw()`). A parsed JSON
   * body is never re-serialised; requests that have a body but no raw body get
   * a 500 and a console error explaining the fix. See the class example for
   * the `express.json({ verify })` setup.
   *
   * @returns An `(req, res, next)` middleware. Responds 401 `{error}` for missing
   *   headers or failed verification, 429 `{error, retryAfterMs}` when rate
   *   limited, 500 `{error}` when the raw body is unavailable, 503 `{error}`
   *   (and logs) when verification itself fails (e.g. an RPC error).
   */
  auth() {
    type MiddlewareReq = {
      headers?: Record<string, unknown>;
      method?: string;
      originalUrl?: string;
      url?: string;
      rawBody?: unknown;
      body?: unknown;
      agent?: VerifiedAgent;
    };
    type MiddlewareRes = {
      status: (code: number) => {
        json: (payload: Record<string, unknown>) => void;
      };
    };
    type MiddlewareNext = () => void;

    return async (
      req: MiddlewareReq,
      res: MiddlewareRes,
      next: MiddlewareNext,
    ) => {
      const signatureHeader = req.headers?.[HEADERS.SIGNATURE];
      const timestampHeader = req.headers?.[HEADERS.TIMESTAMP];
      const keytypeHeader = req.headers?.[HEADERS.KEYTYPE];
      const keyHeader = req.headers?.[HEADERS.KEY];
      const signature =
        typeof signatureHeader === "string" ? signatureHeader : undefined;
      const timestamp =
        typeof timestampHeader === "string" ? timestampHeader : undefined;
      const keytype =
        typeof keytypeHeader === "string" ? keytypeHeader : undefined;
      const agentKey = typeof keyHeader === "string" ? keyHeader : undefined;

      if (!signature || !timestamp) {
        res.status(401).json({ error: "Missing agent authentication headers" });
        return;
      }

      const method = typeof req.method === "string" ? req.method : "GET";
      const url =
        typeof req.originalUrl === "string"
          ? req.originalUrl
          : typeof req.url === "string"
            ? req.url
            : "/";
      const raw = req.rawBody ?? req.body;
      let body: string | undefined;
      if (typeof raw === "string") {
        body = raw;
      } else if (Buffer.isBuffer(raw)) {
        body = raw.toString("utf8");
      } else if (hasRequestBody(req.headers)) {
        // Re-serialising a parsed body (JSON.stringify(req.body)) rarely
        // reproduces the signed bytes, so refuse instead of failing obscurely.
        console.error(
          "[SelfAgentVerifier] auth() needs the raw request body to verify the " +
            "signature. Keep it with express.json({ verify: (req, _res, buf) => " +
            "{ req.rawBody = buf; } }), or use express.text() / express.raw().",
        );
        res.status(500).json({
          error: "Raw request body unavailable for signature verification",
        });
        return;
      }

      let result: VerificationResult;
      try {
        result = await this.verify({
          signature,
          timestamp,
          method,
          url,
          body,
          keytype,
          agentKey,
        });
      } catch (err) {
        // verify() throws on RPC failures; answer instead of leaving the
        // request hanging (Express 4 does not catch async rejections).
        console.error("[SelfAgentVerifier] auth() verification failed:", err);
        res.status(503).json({
          error: "Agent verification unavailable, try again later",
        });
        return;
      }

      if (!result.valid) {
        const status = result.retryAfterMs ? 429 : 401;
        const body: Record<string, unknown> = { error: result.error };
        if (result.retryAfterMs) {
          body.retryAfterMs = result.retryAfterMs;
        }
        res.status(status).json(body);
        return;
      }

      req.agent = {
        address: result.agentAddress,
        agentKey: result.agentKey,
        agentId: result.agentId,
        agentCount: result.agentCount,
        nullifier: result.nullifier,
        credentials: result.credentials,
      };
      next();
    };
  }

  /**
   * Alias of `auth()`.
   *
   * @deprecated Use `auth()` instead.
   * @returns The same middleware as `auth()`.
   */
  expressMiddleware() {
    return this.auth();
  }
}

/**
 * Check whether the request headers announce a body.
 *
 * Needed because body parsers set `req.body = {}` even when there is none.
 *
 * @param headers - Lower-cased request headers.
 * @returns True if `transfer-encoding` is set or `content-length` is non-zero.
 */
function hasRequestBody(headers: Record<string, unknown> | undefined): boolean {
  const length = headers?.["content-length"];
  return (
    headers?.["transfer-encoding"] !== undefined ||
    (length !== undefined && length !== "0")
  );
}

// ── Standalone verifyAgent(): lightweight proof-expiry-aware check ──────────

/**
 * Build a re-authentication URL for renewing an expired (or soon-to-expire)
 * human proof.
 *
 * The API-only service has no hosted re-auth page, so this points at the
 * `GET /api/agent/refresh` entry point: it mints the proof-refresh deep link
 * server-side (deriving the config from the agent's on-chain configId) and
 * 302-redirects to the Self universal link. Opening it on mobile launches the
 * Self app; on desktop the Self redirect page shows a scannable QR. The human
 * scans to renew the proof; completion is detected on-chain. Override the host
 * with `reauthBaseUrl` if you front the API on a different domain.
 *
 * Exported for unit testing the URL contract; not re-exported from the package
 * entry point, so it stays out of the public API surface.
 *
 * @param agentId - On-chain agent ID.
 * @param options - `chainId`, `registryAddress` and optional `reauthBaseUrl` host override.
 * @returns `<base>/api/agent/refresh?agentId=..&chainId=..&registry=..`.
 */
export function buildReauthUrl(
  agentId: bigint,
  options: { chainId: number; registryAddress: string; reauthBaseUrl?: string },
): string {
  const base = options.reauthBaseUrl ?? REAUTH_BASE_URL;
  return `${base}/api/agent/refresh?agentId=${agentId}&chainId=${options.chainId}&registry=${options.registryAddress}`;
}

/**
 * Standalone proof-expiry-aware agent verification.
 *
 * Unlike `SelfAgentVerifier.verify()` (which validates request signatures),
 * this function performs a direct on-chain lookup to answer the question:
 * "does this agent currently hold a valid, non-expired human proof?"
 * Freshness comes from the registry's `isProofFresh` (not the local clock),
 * so verified = hasHumanProof && isProofFresh, as everywhere else.
 *
 * It is the recommended entry point for ERC-8004 compliance checks when
 * you already trust the agent's identity (e.g., during off-chain enrollment
 * or administrative tooling).
 *
 * @param agentKey - The agent's bytes32 on-chain key (zero-padded address, or Ed25519 public key).
 * @param options.network - "mainnet" (default) or "testnet"; sets the registry, chain ID and RPC.
 * @param options.registryAddress - Override the network's registry (custom deployments).
 * @param options.chainId - Override the chain ID used in the reauth URL.
 * @param options.reauthBaseUrl - Override the host of the reauth URL.
 * @param rpcUrl - RPC endpoint (default: the RPC of the network whose registry matches, else the network's).
 *
 * @returns A {@link VerifyResult} discriminated union:
 *   - `{ verified: true, agentId, expiresAt }` — active proof
 *   - `{ verified: false, reason: 'NOT_REGISTERED' }` — unknown key
 *   - `{ verified: false, reason: 'NO_HUMAN_PROOF' }` — key registered but no proof
 *   - `{ verified: false, reason: 'PROOF_EXPIRED', expiredAt, reauthUrl }` — proof lapsed
 * @throws TypeError if `agentKey` is not 0x + 64 hex chars; any RPC error.
 */
export async function verifyAgent(
  agentKey: string,
  options: {
    network?: NetworkName;
    chainId?: number;
    registryAddress?: string;
    reauthBaseUrl?: string;
  } = {},
  rpcUrl?: string,
): Promise<VerifyResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) {
    throw new TypeError(
      `agentKey must be a 0x-prefixed 32-byte hex string; received "${agentKey}"`,
    );
  }

  const network = options.network ?? DEFAULT_NETWORK;
  const target = {
    chainId: options.chainId ?? CHAIN_IDS[network],
    registryAddress:
      options.registryAddress ?? NETWORKS[network].registryAddress,
    reauthBaseUrl: options.reauthBaseUrl,
  };
  const resolvedRpcUrl =
    rpcUrl ??
    Object.values(NETWORKS).find(
      (n) =>
        n.registryAddress.toLowerCase() ===
        target.registryAddress.toLowerCase(),
    )?.rpcUrl ??
    NETWORKS[network].rpcUrl;

  const provider = new ethers.JsonRpcProvider(resolvedRpcUrl);
  const registry = typedRegistry(target.registryAddress, provider);

  const agentId = await registry.getAgentId(agentKey);
  if (agentId === 0n) {
    return { verified: false, reason: "NOT_REGISTERED" };
  }

  const hasProof = await registry.hasHumanProof(agentId);
  if (!hasProof) {
    return { verified: false, reason: "NO_HUMAN_PROOF" };
  }

  // The registry's isProofFresh is authoritative (verified = hasHumanProof &&
  // isProofFresh); proofExpiresAt is only reported. An unset (0) expiry is
  // not fresh on-chain, so it surfaces as PROOF_EXPIRED with the Unix epoch.
  const [fresh, expiresAtSecs] = await Promise.all([
    registry.isProofFresh(agentId),
    registry.proofExpiresAt(agentId),
  ]);
  if (!fresh) {
    return {
      verified: false,
      reason: "PROOF_EXPIRED",
      expiredAt: new Date(Number(expiresAtSecs) * 1000),
      reauthUrl: buildReauthUrl(agentId, target),
    };
  }

  return {
    verified: true,
    agentId,
    expiresAt:
      expiresAtSecs > 0n ? new Date(Number(expiresAtSecs) * 1000) : null,
  };
}
