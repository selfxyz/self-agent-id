import { ethers } from "ethers";
import {
  REGISTRY_ABI,
  HEADERS,
  DEFAULT_MAX_AGE_MS,
  DEFAULT_CACHE_TTL_MS,
  NETWORKS,
  DEFAULT_NETWORK,
} from "./constants";
import type { NetworkName } from "./constants";
import { canonicalizeSigningUrl, computeSigningMessage } from "./signing";

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
}

interface CacheEntry {
  isVerified: boolean;
  agentId: bigint;
  agentCount: bigint;
  nullifier: bigint;
  providerAddress: string;
  expiresAt: number;
}

interface ReplayEntry {
  expiresAt: number;
}

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
  private cache = new Map<string, CacheEntry>();
  private replayCache = new Map<string, ReplayEntry>();
  private selfProviderCache: { address: string; expiresAt: number } | null = null;

  constructor(config: VerifierConfig = {}) {
    const net = NETWORKS[config.network ?? DEFAULT_NETWORK];
    const provider = new ethers.JsonRpcProvider(config.rpcUrl ?? net.rpcUrl);
    this.registry = new ethers.Contract(
      config.registryAddress ?? net.registryAddress,
      REGISTRY_ABI,
      provider
    );
    this.maxAgeMs = config.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
    this.cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.maxAgentsPerHuman = config.maxAgentsPerHuman ?? 1;
    this.includeCredentials = config.includeCredentials ?? false;
    this.requireSelfProvider = config.requireSelfProvider ?? true;
    this.enableReplayProtection = config.enableReplayProtection ?? true;
    this.replayCacheMaxEntries = config.replayCacheMaxEntries ?? 10_000;
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
    const message = computeSigningMessage(timestamp, method, canonicalUrl, body);

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
    const { isVerified, agentId, agentCount, nullifier, providerAddress } =
      await this.checkOnChain(agentKey);

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
    if (this.maxAgentsPerHuman > 0 && agentCount > BigInt(this.maxAgentsPerHuman)) {
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

    return { valid: true, agentAddress: signerAddress, agentKey, agentId, agentCount, nullifier, credentials };
  }

  /**
   * Check on-chain agent status with caching.
   */
  private async checkOnChain(
    agentKey: string
  ): Promise<{ isVerified: boolean; agentId: bigint; agentCount: bigint; nullifier: bigint; providerAddress: string }> {
    const cached = this.cache.get(agentKey);
    if (cached && cached.expiresAt > Date.now()) {
      return {
        isVerified: cached.isVerified,
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

    // Fetch sybil data and provider address if agent exists
    let agentCount = 0n;
    let nullifier = 0n;
    let providerAddress = "";
    if (agentId > 0n) {
      const promises: Promise<unknown>[] = [];

      if (this.maxAgentsPerHuman > 0) {
        promises.push(
          this.registry.getHumanNullifier(agentId).then(async (n: bigint) => {
            nullifier = n;
            agentCount = await this.registry.getAgentCountForHuman(n);
          })
        );
      }

      if (this.requireSelfProvider) {
        promises.push(
          (this.registry.getProofProvider(agentId) as Promise<string>).then((addr) => {
            providerAddress = addr;
          })
        );
      }

      await Promise.all(promises);
    }

    this.cache.set(agentKey, {
      isVerified,
      agentId,
      agentCount,
      nullifier,
      providerAddress,
      expiresAt: Date.now() + this.cacheTtlMs,
    });

    return { isVerified, agentId, agentCount, nullifier, providerAddress };
  }

  /**
   * Get Self Protocol's own proof provider address from the registry.
   * Cached separately since it rarely changes.
   */
  private async getSelfProviderAddress(): Promise<string> {
    if (this.selfProviderCache && this.selfProviderCache.expiresAt > Date.now()) {
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
  private async fetchCredentials(agentId: bigint): Promise<AgentCredentials | undefined> {
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

  private checkAndRecordReplay(signature: string, message: string, ts: number): string | null {
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
      (a, b) => a[1].expiresAt - b[1].expiresAt
    );
    for (let i = 0; i < overflow; i++) {
      this.replayCache.delete(sorted[i][0]);
    }
  }

  /**
   * Express/Connect middleware that verifies agent requests.
   *
   * Adds `req.agent` with `{ address, agentKey, agentId }` on success.
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
        res.status(401).json({ error: result.error });
        return;
      }

      req.agent = {
        address: result.agentAddress,
        agentKey: result.agentKey,
        agentId: result.agentId,
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
