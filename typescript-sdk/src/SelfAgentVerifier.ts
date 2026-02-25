// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { ethers } from "ethers";
import {
  REGISTRY_ABI,
  HEADERS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_CACHE_TTL_MS,
  NETWORKS,
  DEFAULT_NETWORK,
  REAUTH_BASE_URL,
} from "./constants";
import type { NetworkName } from "./constants";
import { canonicalizeSigningUrl, computeSigningMessage } from "./signing";
import type { VerifyResult } from "./types";

export interface VerifierConfig {
  /** Network to use: "mainnet" (default) or "testnet" */
  network?: NetworkName;
  /** Override: custom registry address (takes precedence over network) */
  registryAddress?: string;
  /** Override: custom RPC URL (takes precedence over network) */
  rpcUrl?: string;
  /** Max age for signed timestamps (default: 5 min) */
  maxAgeMs?: number;
  /** TTL for on-chain status cache (default: 5 min) */
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
  /** Minimum age for agent's human (credential check, default: disabled) */
  minimumAge?: number;
  /** Require OFAC screening passed (credential check, default: false) */
  requireOFACPassed?: boolean;
  /** Require nationality in list (credential check, default: disabled) */
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

/** Config object for the `fromConfig` static factory */
export interface VerifierFromConfig {
  network?: NetworkName;
  registryAddress?: string;
  rpcUrl?: string;
  requireAge?: number;
  requireOFAC?: boolean;
  requireNationality?: string[];
  requireSelfProvider?: boolean;
  sybilLimit?: number;
  rateLimit?: RateLimitConfig;
  replayProtection?: boolean;
  maxAgeMs?: number;
  cacheTtlMs?: number;
}

/** ZK-attested credential claims stored on-chain for an agent */
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

export interface VerificationResult {
  valid: boolean;
  /** The agent's Ethereum address (recovered from signature) */
  agentAddress: string;
  /** The agent's on-chain key (bytes32) */
  agentKey: string;
  agentId: bigint;
  /** Number of agents registered by the same human */
  agentCount: bigint;
  /** Human's nullifier (for rate limiting by human identity) */
  nullifier: bigint;
  /** ZK-attested credentials (only populated when includeCredentials is true) */
  credentials?: AgentCredentials;
  error?: string;
  /** Milliseconds until the rate limit resets (only set when rate limited) */
  retryAfterMs?: number;
}

interface CacheEntry {
  isVerified: boolean;
  isProofFresh: boolean;
  agentId: bigint;
  agentCount: bigint;
  nullifier: bigint;
  providerAddress: string;
  expiresAt: number;
}

interface ReplayEntry {
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Rate limiter — sliding window, keyed by agent address
// ---------------------------------------------------------------------------

interface RateBucket {
  timestamps: number[];
}

class RateLimiter {
  private perMinute: number;
  private perHour: number;
  private buckets = new Map<string, RateBucket>();

  constructor(config: RateLimitConfig) {
    this.perMinute = config.perMinute ?? 0;
    this.perHour = config.perHour ?? 0;
  }

  /** Returns null if allowed, or { error, retryAfterMs } if rate limited. */
  check(agentAddress: string): { error: string; retryAfterMs: number } | null {
    const now = Date.now();
    const key = agentAddress.toLowerCase();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // Prune timestamps older than 1 hour (longest window we care about)
    const oneHourAgo = now - 60 * 60 * 1000;
    bucket.timestamps = bucket.timestamps.filter((t) => t > oneHourAgo);

    // Check per-minute limit
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

    // Check per-hour limit
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

    // Record this request
    bucket.timestamps.push(now);
    return null;
  }
}

// ---------------------------------------------------------------------------
// VerifierBuilder — chainable builder API
// ---------------------------------------------------------------------------

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

  /** Set the network: "mainnet" or "testnet" */
  network(name: NetworkName): this {
    this._network = name;
    return this;
  }

  /** Set a custom registry address */
  registry(addr: string): this {
    this._registryAddress = addr;
    return this;
  }

  /** Set a custom RPC URL */
  rpc(url: string): this {
    this._rpcUrl = url;
    return this;
  }

  /** Require the agent's human to be at least `n` years old */
  requireAge(n: number): this {
    this._minimumAge = n;
    return this;
  }

  /** Require OFAC screening passed */
  requireOFAC(): this {
    this._requireOFACPassed = true;
    return this;
  }

  /** Require nationality in the given list */
  requireNationality(...codes: string[]): this {
    this._allowedNationalities = codes;
    return this;
  }

  /** Require Self Protocol as proof provider (default: on) */
  requireSelfProvider(): this {
    this._requireSelfProvider = true;
    return this;
  }

  /** Max agents per human (default: 1) */
  sybilLimit(n: number): this {
    this._maxAgentsPerHuman = n;
    return this;
  }

  /** Enable in-memory per-agent rate limiting */
  rateLimit(config: RateLimitConfig): this {
    this._rateLimitConfig = config;
    return this;
  }

  /** Enable replay protection (default: on) */
  replayProtection(enabled = true): this {
    this._enableReplayProtection = enabled;
    return this;
  }

  /** Include ZK credentials in verification result */
  includeCredentials(): this {
    this._includeCredentials = true;
    return this;
  }

  /** Max signed timestamp age in milliseconds */
  maxAge(ms: number): this {
    this._maxAgeMs = ms;
    return this;
  }

  /** On-chain cache TTL in milliseconds */
  cacheTtl(ms: number): this {
    this._cacheTtlMs = ms;
    return this;
  }

  /** Build the SelfAgentVerifier instance */
  build(): SelfAgentVerifier {
    // Auto-enable credentials if any credential requirement is set
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

// ---------------------------------------------------------------------------
// SelfAgentVerifier
// ---------------------------------------------------------------------------

/**
 * Service-side verifier for Self Agent ID requests.
 *
 * Security chain:
 * 1. Recover signer address from ECDSA signature (cryptographic proof of key ownership)
 * 2. Derive agent key: zeroPadValue(recoveredAddress, 32)
 * 3. Check on-chain: isVerifiedAgent(agentKey) (proof that a human registered this address)
 * 4. Check proof provider: getProofProvider(agentId) matches selfProofProvider()
 * 5. Check timestamp freshness (replay protection)
 *
 * The signer address is RECOVERED from the signature, never trusted from headers.
 * This closes the off-chain verification gap — you can't claim to be an agent
 * without holding its private key.
 *
 * Usage:
 * ```ts
 * // Mainnet (default — no config needed)
 * const verifier = new SelfAgentVerifier();
 *
 * // Testnet
 * const verifier = new SelfAgentVerifier({ network: "testnet" });
 *
 * // Chainable builder
 * const verifier = SelfAgentVerifier.create()
 *   .network("testnet")
 *   .requireAge(18)
 *   .requireOFAC()
 *   .rateLimit({ perMinute: 10 })
 *   .build();
 *
 * // From config object
 * const verifier = SelfAgentVerifier.fromConfig({
 *   network: "testnet",
 *   requireAge: 18,
 *   requireOFAC: true,
 * });
 *
 * const result = await verifier.verify({
 *   signature: req.headers["x-self-agent-signature"],
 *   timestamp: req.headers["x-self-agent-timestamp"],
 *   method: req.method,
 *   url: req.originalUrl,
 *   body: req.body ? JSON.stringify(req.body) : undefined,
 * });
 *
 * if (result.valid) {
 *   console.log("Verified agent:", result.agentAddress);
 * }
 * ```
 */
export class SelfAgentVerifier {
  private registry: ethers.Contract;
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

  constructor(config: VerifierConfig = {}) {
    const net = NETWORKS[config.network ?? DEFAULT_NETWORK];
    const provider = new ethers.JsonRpcProvider(config.rpcUrl ?? net.rpcUrl);
    this.registry = new ethers.Contract(
      config.registryAddress ?? net.registryAddress,
      REGISTRY_ABI,
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

  /** Create a chainable builder for configuring a verifier */
  static create(): VerifierBuilder {
    return new VerifierBuilder();
  }

  /** Create a verifier from a flat config object */
  static fromConfig(cfg: VerifierFromConfig): SelfAgentVerifier {
    // Auto-enable credentials if any credential requirement is set
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
   */
  async verify(params: {
    signature: string;
    timestamp: string;
    method: string;
    url: string;
    body?: string;
  }): Promise<VerificationResult> {
    const { signature, timestamp, method, url, body } = params;
    const empty: VerificationResult = {
      valid: false,
      agentAddress: ethers.ZeroAddress,
      agentKey: ethers.ZeroHash,
      agentId: 0n,
      agentCount: 0n,
      nullifier: 0n,
    };

    // 1. Check timestamp freshness (replay protection)
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

    // 3. Recover signer address from signature (cryptographic — can't be faked)
    let signerAddress: string;
    try {
      signerAddress = ethers.verifyMessage(ethers.getBytes(message), signature);
    } catch {
      return { ...empty, error: "Invalid signature" };
    }

    // 4. Replay cache check (after signature validity to avoid cache poisoning)
    if (this.enableReplayProtection) {
      const replayError = this.checkAndRecordReplay(signature, message, ts);
      if (replayError) {
        return {
          ...empty,
          agentAddress: signerAddress,
          agentKey: ethers.zeroPadValue(signerAddress, 32),
          error: replayError,
        };
      }
    }

    // 5. Derive the on-chain agent key from the recovered address
    const agentKey = ethers.zeroPadValue(signerAddress, 32);

    // 6. Check on-chain status (with cache)
    const {
      isVerified,
      isProofFresh,
      agentId,
      agentCount,
      nullifier,
      providerAddress,
    } = await this.checkOnChain(agentKey);

    if (!isVerified) {
      return {
        valid: false,
        agentAddress: signerAddress,
        agentKey,
        agentId,
        agentCount,
        nullifier,
        error: "Agent not verified on-chain",
      };
    }

    // 6b. Check proof freshness (expired proofs should not pass verification)
    if (!isProofFresh) {
      return {
        valid: false,
        agentAddress: signerAddress,
        agentKey,
        agentId,
        agentCount,
        nullifier,
        error: "Agent's human proof has expired",
      };
    }

    // 7. Provider check: ensure agent was verified by Self Protocol
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
        error: `Human has ${agentCount} agents (max ${this.maxAgentsPerHuman})`,
      };
    }

    // 9. Fetch credentials if requested
    let credentials: AgentCredentials | undefined;
    if (this.includeCredentials && agentId > 0n) {
      credentials = await this.fetchCredentials(agentId);
    }

    // 10. Credential checks (post-verify — only if credentials were fetched)
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
    };
  }

  /**
   * Check on-chain agent status with caching.
   */
  private async checkOnChain(agentKey: string): Promise<{
    isVerified: boolean;
    isProofFresh: boolean;
    agentId: bigint;
    agentCount: bigint;
    nullifier: bigint;
    providerAddress: string;
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
      };
    }

    const [isVerified, agentId] = await Promise.all([
      this.registry.isVerifiedAgent(agentKey) as Promise<boolean>,
      this.registry.getAgentId(agentKey) as Promise<bigint>,
    ]);

    // Fetch sybil data, provider address, and proof freshness if agent exists
    let agentCount = 0n;
    let nullifier = 0n;
    let providerAddress = "";
    let isProofFresh = false;
    if (agentId > 0n) {
      const promises: Promise<unknown>[] = [];

      // Always check proof freshness
      promises.push(
        (this.registry.isProofFresh(agentId) as Promise<boolean>).then(
          (fresh) => {
            isProofFresh = fresh;
          },
        ),
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
          (this.registry.getProofProvider(agentId) as Promise<string>).then(
            (addr) => {
              providerAddress = addr;
            },
          ),
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
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return {
      isVerified,
      isProofFresh,
      agentId,
      agentCount,
      nullifier,
      providerAddress,
    };
  }

  /**
   * Get Self Protocol's own proof provider address from the registry.
   * Cached separately since it rarely changes.
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
      expiresAt: Date.now() + this.cacheTtlMs * 12, // Cache for longer (1 hour at default TTL)
    };
    return address;
  }

  /**
   * Fetch ZK-attested credentials for an agent.
   */
  private async fetchCredentials(
    agentId: bigint,
  ): Promise<AgentCredentials | undefined> {
    try {
      const raw = await this.registry.getAgentCredentials(agentId);
      return {
        issuingState: raw.issuingState ?? raw[0] ?? "",
        name: raw.name ?? raw[1] ?? [],
        idNumber: raw.idNumber ?? raw[2] ?? "",
        nationality: raw.nationality ?? raw[3] ?? "",
        dateOfBirth: raw.dateOfBirth ?? raw[4] ?? "",
        gender: raw.gender ?? raw[5] ?? "",
        expiryDate: raw.expiryDate ?? raw[6] ?? "",
        olderThan: raw.olderThan ?? raw[7] ?? 0n,
        ofac: raw.ofac ?? raw[8] ?? [false, false, false],
      };
    } catch {
      return undefined;
    }
  }

  /** Clear the on-chain status cache */
  clearCache(): void {
    this.cache.clear();
    this.selfProviderCache = null;
    this.replayCache.clear();
  }

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
   * Adds `req.agent` with `{ address, agentKey, agentId, agentCount, nullifier, credentials? }` on success.
   * Returns 401 on failure.
   *
   * Usage:
   * ```ts
   * app.use("/api", verifier.auth());
   * ```
   */
  auth() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (req: any, res: any, next: any) => {
      const signature = req.headers[HEADERS.SIGNATURE];
      const timestamp = req.headers[HEADERS.TIMESTAMP];

      if (!signature || !timestamp) {
        res.status(401).json({ error: "Missing agent authentication headers" });
        return;
      }

      const result = await this.verify({
        signature,
        timestamp,
        method: req.method,
        url: req.originalUrl || req.url,
        body:
          typeof req.rawBody === "string"
            ? req.rawBody
            : Buffer.isBuffer(req.rawBody)
              ? req.rawBody.toString("utf8")
              : typeof req.body === "string"
                ? req.body
                : req.body
                  ? JSON.stringify(req.body)
                  : undefined,
      });

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
   * @deprecated Use `auth()` instead.
   */
  expressMiddleware() {
    return this.auth();
  }
}

// ---------------------------------------------------------------------------
// Standalone verifyAgent() — lightweight proof-expiry-aware check
// ---------------------------------------------------------------------------

/**
 * Build a re-authentication URL that the agent operator can visit to renew
 * their expired (or soon-to-expire) human proof.
 */
function buildReauthUrl(
  agentId: bigint,
  options: { chainId: number; registryAddress: string; reauthBaseUrl?: string },
): string {
  const base = options.reauthBaseUrl ?? REAUTH_BASE_URL;
  return `${base}/reauth?agentId=${agentId}&chainId=${options.chainId}&registry=${options.registryAddress}`;
}

/**
 * Standalone proof-expiry-aware agent verification.
 *
 * Unlike `SelfAgentVerifier.verify()` (which validates ECDSA request
 * signatures), this function performs a direct on-chain lookup to answer
 * the question: "does this agent currently hold a valid, non-expired
 * human proof?"
 *
 * It is the recommended entry point for ERC-8004 compliance checks when
 * you already trust the agent's identity (e.g., during off-chain enrollment
 * or administrative tooling).
 *
 * @param agentKey - The agent's bytes32 on-chain key (zero-padded address)
 * @param options  - `chainId` (used in reauth URL) and `registryAddress`
 * @param rpcUrl   - RPC endpoint to use (default: Celo mainnet)
 *
 * @returns A {@link VerifyResult} discriminated union:
 *   - `{ verified: true, agentId, expiresAt }` — active proof
 *   - `{ verified: false, reason: 'NOT_REGISTERED' }` — unknown key
 *   - `{ verified: false, reason: 'NO_HUMAN_PROOF' }` — key registered but no proof
 *   - `{ verified: false, reason: 'PROOF_EXPIRED', expiredAt, reauthUrl }` — proof lapsed
 *
 * @example
 * ```ts
 * import { verifyAgent, isProofExpiringSoon } from "@selfxyz/agent-sdk";
 *
 * const result = await verifyAgent(agentKey, { chainId: 42220, registryAddress: "0x..." });
 * if (!result.verified) {
 *   if (result.reason === "PROOF_EXPIRED") {
 *     console.warn("Re-auth at:", result.reauthUrl);
 *   }
 *   return;
 * }
 * if (isProofExpiringSoon(result.expiresAt)) {
 *   console.warn("Proof expiring in < 30 days — prompt for renewal");
 * }
 * ```
 */
export async function verifyAgent(
  agentKey: string,
  options: { chainId: number; registryAddress: string; reauthBaseUrl?: string },
  rpcUrl?: string,
): Promise<VerifyResult> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(agentKey)) {
    throw new TypeError(
      `agentKey must be a 0x-prefixed 32-byte hex string; received "${agentKey}"`,
    );
  }

  // Resolve the RPC URL: use the provided override, or fall back to the
  // network whose registry address matches, or finally to Celo mainnet.
  const resolvedRpcUrl =
    rpcUrl ??
    Object.values(NETWORKS).find(
      (n) =>
        n.registryAddress.toLowerCase() ===
        options.registryAddress.toLowerCase(),
    )?.rpcUrl ??
    NETWORKS[DEFAULT_NETWORK].rpcUrl;

  const provider = new ethers.JsonRpcProvider(resolvedRpcUrl);
  const registry = new ethers.Contract(
    options.registryAddress,
    REGISTRY_ABI,
    provider,
  );

  // Step 1: resolve agent key → agentId
  const agentId = (await registry.getAgentId(agentKey)) as bigint;
  if (agentId === 0n) {
    return { verified: false, reason: "NOT_REGISTERED" };
  }

  // Step 2: check whether the agent has a human proof at all
  const hasProof = (await registry.hasHumanProof(agentId)) as boolean;
  if (!hasProof) {
    return { verified: false, reason: "NO_HUMAN_PROOF" };
  }

  // Step 3: check expiry (proofExpiresAt returns 0 if the proof never expires)
  const expiresAtSecs = (await registry.proofExpiresAt(agentId)) as bigint;
  const nowSecs = BigInt(Math.floor(Date.now() / 1000));
  if (expiresAtSecs > 0n && nowSecs >= expiresAtSecs) {
    return {
      verified: false,
      reason: "PROOF_EXPIRED",
      expiredAt: new Date(Number(expiresAtSecs) * 1000),
      reauthUrl: buildReauthUrl(agentId, options),
    };
  }

  return {
    verified: true,
    agentId,
    expiresAt:
      expiresAtSecs > 0n ? new Date(Number(expiresAtSecs) * 1000) : null,
  };
}
