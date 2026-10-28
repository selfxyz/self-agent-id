// SPDX-License-Identifier: MIT

/**
 * Verification tools: check an agent against a policy, and verify a signed
 * request from an agent (ECDSA only).
 *
 * Both are public and read the registry directly (no REST route).
 */

import { ethers } from "ethers";
import {
  SelfAgentVerifier,
  isProofExpiringSoon,
  computeSigningMessage,
} from "@selfxyz/agent-sdk";
import { registryFor, rpcUrlFor, type ServerConfig } from "../config.js";
import {
  disclosed,
  INVALID_AGENT_ADDRESS_ERROR,
  parseAddress,
  safeErrorDescription,
  toolError,
  toolSuccess,
} from "../utils.js";

/** Verification policy shared by self_verify_agent and self_verify_request. */
export interface VerifyPolicyArgs {
  network?: "mainnet" | "testnet";
  require_age?: 0 | 18 | 21;
  require_ofac?: boolean;
  require_self_provider?: boolean;
  max_agents_per_human?: number;
}

/** Arguments of self_verify_agent. */
export interface VerifyAgentArgs extends VerifyPolicyArgs {
  agent_address: string;
}

/** Arguments of self_verify_request: the x-self-agent-* headers + request. */
export interface VerifyRequestArgs extends VerifyPolicyArgs {
  agent_address: string;
  agent_signature: string;
  agent_timestamp: string;
  method: string;
  path: string;
  body?: string;
}

// Same defaults as SelfAgentVerifier.
const DEFAULT_MAX_AGENTS_PER_HUMAN = 1;
const MAX_AGE_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const MAX_REPLAY_ENTRIES = 10_000;

/**
 * Check an agent against a verification policy, reading the registry.
 *
 * Fails when there is no fresh human proof (hasHumanProof && isProofFresh),
 * or a policy check fails; all failures are joined into `reason`.
 *
 * @param args.agent_address - Agent's EVM address.
 * @param args.network - Network (default: the configured network).
 * @param args.require_age - Minimum verified age (default 0 = none).
 * @param args.require_ofac - Require OFAC clear (default false).
 * @param args.require_self_provider - Require Self's proof provider (default true).
 * @param args.max_agents_per_human - Max agents for the human (default 1; 0 = no limit).
 * @param config - Server config.
 * @returns Tool success `{ verified, agent_id, reason?, credentials,
 *   sybil_count, verification_strength, registered_at_block, proof_* }`
 *   (`verified: false` with a reason when unregistered); tool error for a
 *   malformed agent_address (checked before any RPC call) or on RPC failure.
 */
export async function handleVerifyAgent(
  args: VerifyAgentArgs,
  config: ServerConfig,
) {
  const {
    network = config.network,
    require_age = 0,
    require_ofac = false,
    require_self_provider = true,
    max_agents_per_human = DEFAULT_MAX_AGENTS_PER_HUMAN,
  } = args;
  const agent_address = parseAddress(args.agent_address);
  if (!agent_address) return toolError(INVALID_AGENT_ADDRESS_ERROR);

  try {
    const registry = registryFor(config, network);

    const agentId = await registry.getAgentId(
      ethers.zeroPadValue(agent_address, 32),
    );
    if (agentId === 0n) {
      return toolSuccess({
        verified: false,
        agent_address,
        reason: "Agent is not registered on-chain.",
        network,
      });
    }

    const [
      hasHumanProof,
      isProofFresh,
      expiresAtSecs,
      nullifier,
      proofProvider,
      selfProvider,
      registeredAt,
      rawCredentials,
    ] = await Promise.all([
      registry.hasHumanProof(agentId),
      registry.isProofFresh(agentId),
      registry.proofExpiresAt(agentId),
      registry.getHumanNullifier(agentId),
      registry.getProofProvider(agentId),
      registry.selfProofProvider(),
      registry.agentRegisteredAt(agentId),
      registry.getAgentCredentials(agentId),
    ]);
    const agentCount = await registry.getAgentCountForHuman(nullifier);

    const credentials = {
      nationality: disclosed(rawCredentials.nationality),
      older_than: Number(rawCredentials.olderThan),
      ofac_clear: rawCredentials.ofac?.[0] === true,
    };
    const isSelfProvider =
      proofProvider.toLowerCase() === selfProvider.toLowerCase();

    const failures: string[] = [];
    if (!hasHumanProof) {
      failures.push("Agent has no proof-of-human.");
    } else if (!isProofFresh) {
      failures.push(
        "Agent's proof-of-human has expired. Re-authentication required.",
      );
    }
    if (require_self_provider && !isSelfProvider) {
      failures.push(
        `Agent's proof provider (${proofProvider}) does not match Self Protocol provider (${selfProvider}).`,
      );
    }
    if (max_agents_per_human > 0 && agentCount > BigInt(max_agents_per_human)) {
      failures.push(
        `Human has ${agentCount} agents (max ${max_agents_per_human}).`,
      );
    }
    if (require_age > 0 && credentials.older_than < require_age) {
      failures.push(
        `Agent's verified age (${credentials.older_than}+) does not meet minimum age requirement (${require_age}+).`,
      );
    }
    if (require_ofac && !credentials.ofac_clear) {
      failures.push("Agent has not passed OFAC screening.");
    }

    let verification_strength = "unknown";
    if (isSelfProvider) {
      verification_strength = "self-protocol";
    } else if (proofProvider !== ethers.ZeroAddress) {
      verification_strength = "third-party";
    }

    const expiryInfo: Record<string, unknown> = {};
    if (expiresAtSecs > 0n) {
      const proofExpiresAt = new Date(Number(expiresAtSecs) * 1000);
      expiryInfo.proof_expires_at = proofExpiresAt.toISOString();
      expiryInfo.proof_expired = !isProofFresh;
      if (isProofFresh && isProofExpiringSoon(proofExpiresAt)) {
        expiryInfo.proof_expiring_soon = true;
        expiryInfo.expiry_warning =
          "Proof expires within 30 days. Agent should re-authenticate soon.";
      }
    }

    return toolSuccess({
      verified: failures.length === 0,
      agent_address,
      agent_id: Number(agentId),
      ...(failures.length > 0 ? { reason: failures.join(" ") } : {}),
      credentials,
      sybil_count: Number(agentCount),
      verification_strength,
      registered_at_block: Number(registeredAt),
      ...expiryInfo,
      network,
    });
  } catch (err) {
    console.error(
      "[self-agent-mcp] verify agent failed:",
      safeErrorDescription(err),
    );
    return toolError("Failed to verify agent: RPC error");
  }
}

// ── Verify request ──────────────────────────────────────────────────────────

/** SDK verifiers keyed by policy JSON (cleared when it reaches 64 entries). */
const verifierCache = new Map<string, SelfAgentVerifier>();

/**
 * Get (or create and cache) an SDK verifier for a policy.
 *
 * @param config - Server config (for the RPC URL).
 * @param policy - Fully defaulted verification policy.
 * @returns A SelfAgentVerifier with SDK replay protection off.
 */
function getVerifier(
  config: ServerConfig,
  policy: Required<VerifyPolicyArgs>,
): SelfAgentVerifier {
  const key = JSON.stringify(policy);
  const existing = verifierCache.get(key);
  if (existing) return existing;

  // The SDK replay cache keys on the raw signature string, which has many
  // encodings per signer; replay is enforced below on the signed content.
  const verifier = new SelfAgentVerifier({
    network: policy.network,
    rpcUrl: rpcUrlFor(config, policy.network),
    includeCredentials: true,
    enableReplayProtection: false,
    requireSelfProvider: policy.require_self_provider,
    maxAgentsPerHuman: policy.max_agents_per_human,
    minimumAge: policy.require_age > 0 ? policy.require_age : undefined,
    requireOFACPassed: policy.require_ofac,
  });
  if (verifierCache.size >= 64) verifierCache.clear();
  verifierCache.set(key, verifier);
  return verifier;
}

// Per-process replay cache: key = recovered signer + signed message hash, so
// any re-encoding of the same signature maps to the same entry.
const seenRequests = new Map<string, number>();

/**
 * Check whether verify-request replay protection is on.
 *
 * @returns False only when MCP_VERIFY_REQUEST_REPLAY_PROTECTION is "false".
 */
function replayEnabled(): boolean {
  return process.env.MCP_VERIFY_REQUEST_REPLAY_PROTECTION !== "false";
}

/**
 * Record a verified request in the per-process replay cache.
 *
 * Fails closed when the cache is full of unexpired entries.
 *
 * @param key - Signer + signed message hash.
 * @param expiresAt - When the entry may be forgotten (unix ms).
 * @returns null after recording; "Replay detected" if already seen; or
 *   "Replay cache is full; retry shortly".
 */
export function recordRequest(key: string, expiresAt: number): string | null {
  const now = Date.now();
  const seen = seenRequests.get(key);
  if (seen !== undefined && seen > now) return "Replay detected";
  if (seenRequests.size >= MAX_REPLAY_ENTRIES) {
    for (const [k, exp] of seenRequests) {
      if (exp <= now) seenRequests.delete(k);
    }
    // Fail closed rather than evict live entries an attacker could replay.
    if (seenRequests.size >= MAX_REPLAY_ENTRIES) {
      return "Replay cache is full; retry shortly";
    }
  }
  seenRequests.set(key, expiresAt);
  return null;
}

/**
 * Verify a signed HTTP request from an ECDSA (secp256k1) agent.
 *
 * ECDSA only: the x-self-agent-keytype / x-self-agent-key headers are not
 * accepted, so a request signed by an Ed25519 agent always comes back
 * `valid: false`. Verify those with the SDK's SelfAgentVerifier instead.
 *
 * Checks the address, the timestamp (at most 5 minutes old, 30 s in the
 * future), that the signature recovers to agent_address, replay (per process),
 * then the agent's on-chain status against the policy via the SDK verifier.
 *
 * @param args.agent_address - x-self-agent-address header.
 * @param args.agent_signature - x-self-agent-signature header.
 * @param args.agent_timestamp - x-self-agent-timestamp header (unix ms).
 * @param args.method - HTTP method of the request.
 * @param args.path - Path and query that was signed (a full URL also works).
 * @param args.body - Request body, if any.
 * @param config - Server config.
 * @returns Tool success `{ valid: true, agent_address, agent_id, agent_count,
 *   credentials, network, note }` or `{ valid: false, agent_address?, reason }`;
 *   tool error on RPC failure.
 */
export async function handleVerifyRequest(
  args: VerifyRequestArgs,
  config: ServerConfig,
) {
  const {
    agent_address,
    agent_signature,
    agent_timestamp,
    method,
    path,
    body,
  } = args;
  const policy: Required<VerifyPolicyArgs> = {
    network: args.network ?? config.network,
    require_age: args.require_age ?? 0,
    require_ofac: args.require_ofac ?? false,
    require_self_provider: args.require_self_provider ?? true,
    max_agents_per_human:
      args.max_agents_per_human ?? DEFAULT_MAX_AGENTS_PER_HUMAN,
  };
  /**
   * @param reason - Why the request is rejected.
   * @param recovered - Recovered signer, when known.
   * @returns Tool success `{ valid: false, agent_address?, reason }`.
   */
  const invalid = (reason: string, recovered?: string) =>
    toolSuccess({ valid: false, agent_address: recovered, reason });

  if (!ethers.isAddress(agent_address)) {
    return invalid("x-self-agent-address is not a valid Ethereum address.");
  }
  const ts = Number(agent_timestamp);
  const now = Date.now();
  if (
    !/^\d{1,16}$/.test(agent_timestamp) ||
    ts > now + MAX_CLOCK_SKEW_MS ||
    now - ts > MAX_AGE_MS
  ) {
    return invalid("Timestamp expired, in the future, or invalid.");
  }

  const message = computeSigningMessage(agent_timestamp, method, path, body);
  let recovered: string;
  try {
    recovered = ethers.verifyMessage(ethers.getBytes(message), agent_signature);
  } catch {
    return invalid("Invalid signature.");
  }
  if (ethers.getAddress(agent_address) !== recovered) {
    return invalid(
      "x-self-agent-address does not match recovered signature signer.",
      recovered,
    );
  }

  const replayKey = `${recovered}:${message}`;
  const replayProtection = replayEnabled();
  if (replayProtection && (seenRequests.get(replayKey) ?? 0) > now) {
    return invalid("Replay detected", recovered);
  }

  try {
    const result = await getVerifier(config, policy).verify({
      signature: agent_signature,
      timestamp: agent_timestamp,
      method,
      url: path,
      body,
    });
    if (!result.valid) {
      return invalid(result.error || "Verification failed", recovered);
    }

    // Only requests from verified agents are recorded, so filling the cache
    // requires real registered agents; this check-and-set is synchronous.
    if (replayProtection) {
      const replayError = recordRequest(replayKey, ts + MAX_AGE_MS);
      if (replayError) return invalid(replayError, recovered);
    }

    return toolSuccess({
      valid: true,
      agent_address: recovered,
      agent_id: Number(result.agentId),
      agent_count: Number(result.agentCount),
      credentials: result.credentials
        ? {
            nationality: disclosed(result.credentials.nationality),
            older_than: Number(result.credentials.olderThan),
            ofac_clear: result.credentials.ofac?.[0] === true,
          }
        : undefined,
      network: policy.network,
      note: replayProtection
        ? "Replay protection: this MCP server process accepts each signed request once " +
          "within the 5-minute validity window. Other processes do not share this cache, " +
          "so a service that needs strict replay protection must keep its own."
        : "Replay protection is disabled on this MCP server. " +
          "If you are building a service, implement your own nonce or replay cache.",
    });
  } catch (err) {
    console.error(
      "[self-agent-mcp] verify request failed:",
      safeErrorDescription(err),
    );
    return toolError("Failed to verify request: RPC error");
  }
}
