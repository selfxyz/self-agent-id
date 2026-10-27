// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Shared on-chain reads for the public per-agent routes.
 *
 * REST (info / verify / verify-status / reputation / cards), the agent card
 * and A2A all read agents through here so "exists", "verified" (=
 * hasHumanProof && isProofFresh), credentials and block numbers mean the same
 * thing on every route. Also holds the per-IP read rate limits.
 */

import type { NextResponse } from "next/server";
import { ethers } from "ethers";
import { getProviderLabel } from "@selfxyz/agent-sdk";
import { CHAIN_CONFIG, type ChainConfig } from "@/lib/chain-config";
import {
  ERRORS,
  errorResponse,
  getClientIp,
  rateLimitResponse,
  validateAgentId,
} from "@/lib/agent-api-helpers";
import { deriveEd25519Address } from "@/lib/ed25519";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  typedProvider,
  typedRegistry,
  type AgentCredentials,
  type TypedRegistryContract,
} from "@/lib/contract-types";

/** Thrown when an agent ID was never minted or has been burned. */
export class AgentNotFoundError extends Error {
  /** Create the error with message "Agent not found". */
  constructor() {
    super("Agent not found");
  }
}

/**
 * Per-IP budgets for the public read routes, per minute. A single-agent read
 * costs 6-10 RPC calls; a scan (agents by wallet / nullifier) up to 40
 * multicall pages. Buckets are shared across routes of the same kind.
 */
const READ_LIMITS = { read: 120, scan: 20 } as const;

/**
 * Count one read against the caller's per-IP budget.
 *
 * @param ip - Client IP.
 * @param kind - Bucket: "read" (120/min, default) or "scan" (20/min).
 * @returns The rate-limit result (allowed, remaining, retryAfterMs).
 */
export function checkReadLimit(
  ip: string,
  kind: keyof typeof READ_LIMITS = "read",
) {
  return checkRateLimit({
    key: `${kind}:${ip}`,
    limit: READ_LIMITS[kind],
    windowMs: 60_000,
  });
}

/**
 * Apply the per-IP read budget to a request.
 *
 * @param req - Request (only its headers are read, for the client IP).
 * @param kind - Bucket: "read" (default) or "scan".
 * @returns A 429 response if the caller is over budget, else null.
 */
export async function readRateLimited(
  req: { headers: { get(name: string): string | null } },
  kind: keyof typeof READ_LIMITS = "read",
): Promise<NextResponse | null> {
  const rl = await checkReadLimit(getClientIp(req), kind);
  return rl.allowed ? null : rateLimitResponse(rl.retryAfterMs);
}

/** A validated chain + agent ID from the URL. */
export interface AgentTarget {
  chainId: number;
  config: ChainConfig;
  agentId: bigint;
}

/**
 * Validate `chainId` / `agentId` path params.
 *
 * Registry IDs are sequential, so IDs above Number.MAX_SAFE_INTEGER cannot
 * exist and are a 404 (never echoed back through Number()).
 *
 * @param chainId - chainId path param.
 * @param agentId - agentId path param.
 * @returns `{ ok: true, target }`, or `{ ok: false, response }` with 400
 *   "Unsupported chain", 400 "Invalid agent ID", or 404 "Agent not found".
 */
export function parseAgentTarget(
  chainId: string,
  agentId: string,
): { ok: true; target: AgentTarget } | { ok: false; response: NextResponse } {
  const config = CHAIN_CONFIG[chainId];
  if (!config) {
    return {
      ok: false,
      response: errorResponse(ERRORS.unsupportedChain, 400),
    };
  }
  const id = validateAgentId(agentId);
  if (id === null) {
    return { ok: false, response: errorResponse(ERRORS.invalidAgentId, 400) };
  }
  if (id > BigInt(Number.MAX_SAFE_INTEGER)) {
    return { ok: false, response: errorResponse(ERRORS.agentNotFound, 404) };
  }
  return {
    ok: true,
    target: { chainId: Number(chainId), config, agentId: id },
  };
}

/**
 * Connect to a chain's registry.
 *
 * Uses a static network, so there is no chain-ID auto-detect round trip.
 *
 * @param chainId - Chain ID.
 * @param config - The chain's config.
 * @returns The JSON-RPC provider and typed registry contract.
 */
export function connectRegistry(chainId: number, config: ChainConfig) {
  const rpc = new ethers.JsonRpcProvider(config.rpc, chainId, {
    staticNetwork: true,
  });
  return { rpc, registry: typedRegistry(config.registry, rpc) };
}

/**
 * Map a read error to a response.
 *
 * @param err - Error thrown by a read.
 * @param route - Route label for the log line.
 * @returns 404 "Agent not found" for AgentNotFoundError; otherwise 502
 *   "RPC error" (details logged).
 */
export function readErrorResponse(err: unknown, route: string): NextResponse {
  if (err instanceof AgentNotFoundError) {
    return errorResponse(ERRORS.agentNotFound, 404);
  }
  console.error(`[${route}] RPC error:`, err);
  return errorResponse(ERRORS.rpc, 502);
}

/**
 * Derive the agent address from an agent key.
 *
 * ECDSA keys are the address left-padded to 32 bytes; anything else is an
 * Ed25519 pubkey, whose address is derived the same way the contract does
 * (low 20 bytes of keccak256(pubkey)).
 *
 * @param agentKey - 0x-prefixed 32-byte agent key from the registry.
 * @returns The checksummed agent address.
 */
export function agentAddressFromKey(agentKey: string): string {
  return /^0x0{24}/i.test(agentKey)
    ? ethers.getAddress("0x" + agentKey.slice(-40))
    : deriveEd25519Address(agentKey.slice(2));
}

/**
 * Convert a unix-seconds proof expiry to ISO.
 *
 * @param expiry - proofExpiresAt value.
 * @returns ISO string, or null when unset (0).
 */
function toIsoExpiry(expiry: bigint): string | null {
  return expiry > 0n ? new Date(Number(expiry) * 1000).toISOString() : null;
}

/**
 * Normalise a credential field, mapping undisclosed values to null.
 *
 * Undisclosed fields come back NUL-padded ("\0\0\0", "\0\0-\0\0-\0\0") or as
 * "UNAVAILABLE".
 *
 * @param value - Raw credential string.
 * @returns The trimmed value, or null if it has no letter/digit or is
 *   "UNAVAILABLE".
 */
export function disclosed(value: string | undefined | null): string | null {
  const v = (value ?? "").replace(/\0/g, "").trim();
  if (!/[\p{L}\p{N}]/u.test(v) || v.toUpperCase() === "UNAVAILABLE") {
    return null;
  }
  return v;
}

/** Core on-chain state of one agent. */
interface AgentState {
  agentId: number;
  chainId: number;
  agentKey: string;
  agentAddress: string;
  /** hasHumanProof && isProofFresh — the only meaning of "verified". */
  isVerified: boolean;
  hasHumanProof: boolean;
  isProofFresh: boolean;
  proofExpiresAt: string | null;
  proofProvider: string;
  /** Block number of registration (agentRegisteredAt stores block.number). */
  registeredAtBlock: number;
}

/**
 * Read the core state of one agent (6 RPC calls in parallel).
 *
 * @param registry - Registry contract.
 * @param target - Validated chain + agent ID.
 * @returns The agent's state.
 * @throws AgentNotFoundError if never minted or burned; RPC errors as-is.
 */
export async function readAgentState(
  registry: TypedRegistryContract,
  target: AgentTarget,
): Promise<AgentState> {
  const id = target.agentId;
  const [agentKey, hasHumanProof, isProofFresh, expiry, proofProvider, block] =
    await Promise.all([
      registry.agentIdToAgentKey(id),
      registry.hasHumanProof(id),
      registry.isProofFresh(id),
      registry.proofExpiresAt(id),
      registry.getProofProvider(id),
      registry.agentRegisteredAt(id),
    ]);
  if (agentKey === ethers.ZeroHash) throw new AgentNotFoundError();
  return {
    agentId: Number(id),
    chainId: target.chainId,
    agentKey,
    agentAddress: agentAddressFromKey(agentKey),
    isVerified: hasHumanProof && isProofFresh,
    hasHumanProof,
    isProofFresh,
    proofExpiresAt: toIsoExpiry(expiry),
    proofProvider,
    registeredAtBlock: Number(block),
  };
}

/**
 * Read a proof provider's verification strength.
 *
 * @param rpc - Provider to read with.
 * @param providerAddress - Proof provider contract.
 * @returns Strength (0-100) and its label; 0 / "None" for the zero address.
 * @throws On RPC errors.
 */
export async function readProviderStrength(
  rpc: ethers.ContractRunner,
  providerAddress: string,
): Promise<{ verificationStrength: number; strengthLabel: string }> {
  if (providerAddress === ethers.ZeroAddress) {
    return { verificationStrength: 0, strengthLabel: "None" };
  }
  const strength = Number(
    await typedProvider(providerAddress, rpc).verificationStrength(),
  );
  return {
    verificationStrength: strength,
    strengthLabel: getProviderLabel(strength),
  };
}

/**
 * Pick the public subset of ZK-attested credentials.
 *
 * @param c - Credentials from getAgentCredentials.
 * @returns `{ nationality, olderThan, ofac }`, undisclosed nationality as null.
 */
export function publicCredentials(c: AgentCredentials) {
  return {
    nationality: disclosed(c.nationality),
    olderThan: Number(c.olderThan),
    ofac: [...c.ofac],
  };
}

// ── Agent card ───────────────────────────────────────────────────────────────

/**
 * Build the ERC-8004 / A2A card for one agent.
 *
 * Agent-declared fields come from the on-chain metadata the agent wrote (if
 * any); `selfProtocol` is always rebuilt from live contract state so stale or
 * self-asserted trust data never shows. The registry's own A2A endpoint is
 * listed as `registry-a2a`: it answers questions about the agent but is not
 * the agent's endpoint.
 *
 * @param rpc - Provider to read with.
 * @param registry - Registry contract.
 * @param target - Validated chain + agent ID.
 * @param baseUrl - Public base URL (getAppBaseUrl) for the registry-a2a link.
 * @returns The card JSON.
 * @throws AgentNotFoundError if never minted or burned; RPC errors as-is.
 */
export async function buildAgentCard(
  rpc: ethers.ContractRunner,
  registry: TypedRegistryContract,
  target: AgentTarget,
  baseUrl: string,
): Promise<Record<string, unknown>> {
  const [state, rawMetadata, credentials] = await Promise.all([
    readAgentState(registry, target),
    registry.getAgentMetadata(target.agentId),
    registry.getAgentCredentials(target.agentId),
  ]);
  const [strength, providerName] = await Promise.all([
    readProviderStrength(rpc, state.proofProvider),
    state.proofProvider === ethers.ZeroAddress
      ? Promise.resolve("unknown")
      : typedProvider(state.proofProvider, rpc).providerName(),
  ]);

  let declared: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawMetadata) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      declared = parsed as Record<string, unknown>;
    }
  } catch {
    // No metadata, or not JSON: the card is built from contract state alone.
  }

  const creds = publicCredentials(credentials);
  const services: unknown[] = Array.isArray(declared.services)
    ? declared.services
    : [];
  return {
    ...declared,
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name:
      typeof declared.name === "string" && declared.name
        ? declared.name
        : `Agent #${state.agentId}`,
    description:
      typeof declared.description === "string" && declared.description
        ? declared.description
        : "Human-verified AI agent on Self Protocol",
    services: [
      ...services,
      {
        name: "registry-a2a",
        endpoint: `${baseUrl}/api/a2a`,
        version: "0.3.0",
        description:
          "Self Agent ID registry A2A endpoint (lookups about this agent; not the agent's own endpoint)",
      },
    ],
    selfProtocol: {
      agentId: state.agentId,
      registry: target.config.registry,
      chainId: state.chainId,
      agentKey: state.agentKey,
      agentAddress: state.agentAddress,
      isVerified: state.isVerified,
      proofExpiresAt: state.proofExpiresAt,
      registeredAtBlock: state.registeredAtBlock,
      proofProvider: state.proofProvider,
      providerName,
      verificationStrength: strength.verificationStrength,
      trustModel: {
        proofType: strength.strengthLabel,
        sybilResistant: state.hasHumanProof,
        ofacScreened: creds.ofac[0] === true,
        minimumAgeVerified: creds.olderThan,
      },
      credentials: {
        nationality: creds.nationality,
        issuingState: disclosed(credentials.issuingState),
        olderThan: creds.olderThan,
        ofacClean: creds.ofac[0] === true,
        hasName: credentials.name.some((n) => disclosed(n) !== null),
        hasDateOfBirth: disclosed(credentials.dateOfBirth) !== null,
        hasGender: disclosed(credentials.gender) !== null,
        documentExpiry: disclosed(credentials.expiryDate),
      },
    },
  };
}

// ── ID scans ─────────────────────────────────────────────────────────────────

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const MULTICALL_ABI = [
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) view returns ((bool success, bytes returnData)[])",
];
const SCAN_PAGE = 250;
const SCAN_MAX_PAGES = 40;

/**
 * Find agent IDs whose `fn(id)` equals `expected`, via Multicall3.
 *
 * One eth_call per page of 250 IDs. IDs are sequential from 1; the walk ends
 * after the page holding the last minted ID, once `stopAfter` matches were
 * found, or after 40 pages (10,000 IDs). Callers compare the result with an
 * on-chain count to know whether it is complete. The registry is not
 * ERC721Enumerable and its nullifier index misses agents minted before it
 * existed, so this is the only complete source on-chain.
 *
 * @param rpc - Provider to read with.
 * @param registryAddress - Registry address.
 * @param fn - Getter to compare: "ownerOf" or "getHumanNullifier".
 * @param expected - Owner address (case-insensitive) or nullifier.
 * @param stopAfter - Stop after the page where this many matches are found.
 * @returns Matching agent IDs in ascending order (may exceed stopAfter).
 * @throws On RPC errors.
 */
export async function scanAgentIds(
  rpc: ethers.ContractRunner,
  registryAddress: string,
  fn: "ownerOf" | "getHumanNullifier",
  expected: string | bigint,
  stopAfter: number,
): Promise<bigint[]> {
  const iface = new ethers.Interface([
    "function ownerOf(uint256) view returns (address)",
    "function getHumanNullifier(uint256) view returns (uint256)",
    "function agentRegisteredAt(uint256) view returns (uint256)",
  ]);
  const multicall = new ethers.Contract(MULTICALL3, MULTICALL_ABI, rpc);
  const want = typeof expected === "string" ? expected.toLowerCase() : expected;
  const ids: bigint[] = [];

  for (let page = 0; page < SCAN_MAX_PAGES; page++) {
    const first = BigInt(page * SCAN_PAGE + 1);
    const calls = [];
    for (let i = 0n; i < BigInt(SCAN_PAGE); i++) {
      calls.push({
        target: registryAddress,
        allowFailure: true,
        callData: iface.encodeFunctionData(fn, [first + i]),
      });
    }
    // Ids are minted sequentially: if the page's last id is unminted, so is
    // every later one.
    calls.push({
      target: registryAddress,
      allowFailure: true,
      callData: iface.encodeFunctionData("agentRegisteredAt", [
        first + BigInt(SCAN_PAGE - 1),
      ]),
    });
    const results = (await multicall.aggregate3.staticCall(calls)) as [
      boolean,
      string,
    ][];

    for (let i = 0; i < SCAN_PAGE; i++) {
      const [ok, data] = results[i];
      if (!ok || data === "0x") continue;
      const value = iface.decodeFunctionResult(fn, data)[0] as string | bigint;
      const actual = typeof value === "string" ? value.toLowerCase() : value;
      if (actual === want) ids.push(first + BigInt(i));
    }
    const [lastOk, lastBlock] = results[SCAN_PAGE];
    const reachedEnd = !lastOk || BigInt(lastBlock) === 0n;
    if (reachedEnd || ids.length >= stopAfter) break;
  }
  return ids;
}
