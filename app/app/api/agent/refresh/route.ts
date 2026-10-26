// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/agent/refresh — start a proof refresh session.
 * GET /api/agent/refresh — shareable refresh link (302 to the Self app).
 *
 * Auth: none (the human authorises by re-proving in the Self app).
 * Rate limit: POST 10/min per IP; GET 20/min per IP.
 * Only agents with a stored verification config (non-zero configId) can be
 * refreshed. userDefinedData is ACTION_REFRESH (0x46) + config index + agent
 * ID; POST returns a session token and QR, GET redirects to the deep link.
 */

import type { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { getRegistrationConfigIndex } from "@selfxyz/agent-sdk";
import { getUniversalLink } from "@selfxyz/qrcode";
import { renderQrBase64 } from "@/lib/render-qr";
import {
  createQrToken,
  createSessionToken,
  encryptSession,
} from "@/lib/session-token";
import {
  AGENT_CORS_HEADERS,
  ERRORS,
  requireSessionSecret,
  getNetworkConfig,
  isValidNetwork,
  networkForChainId,
  parseAgentIdField,
  validateAgentId,
  jsonResponse,
  errorResponse,
  corsResponse,
  getAppBaseUrl,
  getClientIp,
  rateLimitResponse,
  readJsonObjectBody,
  parseDisclosures,
  humanInstructions,
  type ApiNetwork,
  type ParsedDisclosures,
} from "@/lib/agent-api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { typedRegistry } from "@/lib/contract-types";
import { buildSelfApp } from "@/lib/self-app";

/** Self Hub V2 action byte for proof refresh ('F' = 0x46). */
const ACTION_REFRESH = 0x46;

/** Inverse of toConfigIndex (SDK): config index → the disclosures it encodes. */
const INDEX_TO_DISCLOSURES: Record<
  number,
  { minimumAge: 0 | 18 | 21; ofac: boolean }
> = {
  0: { minimumAge: 0, ofac: false },
  1: { minimumAge: 18, ofac: false },
  2: { minimumAge: 21, ofac: false },
  3: { minimumAge: 0, ofac: true },
  4: { minimumAge: 18, ofac: true },
  5: { minimumAge: 21, ofac: true },
};

/**
 * Build userDefinedData for ACTION_REFRESH, or null if this agentId can't be
 * encoded.
 *
 * Layout (34 bytes): [0] 'F', [1] config index as ASCII digit, [2..33] agentId
 * as a big-endian uint256 that the contract reads with a raw mload.
 *
 * Self's SDK turns the userDefinedData string into bytes with UTF-8, so a char
 * ≥ 0x80 becomes two bytes and the contract would read a different agentId
 * (e.g. 128 → 194). Ids with any such byte can't be refreshed on the deployed
 * registry.
 *
 * @param agentId - Agent to refresh.
 * @param configIndex - The agent's verification config index (0-5).
 * @returns The userDefinedData string, or null if the agent ID has a byte
 *   ≥ 0x80.
 */
function buildRefreshUserData(
  agentId: bigint,
  configIndex: number,
): string | null {
  const idBytes = ethers.getBytes(ethers.toBeHex(agentId, 32));
  if (idBytes.some((b) => b >= 0x80)) return null;
  return (
    String.fromCharCode(ACTION_REFRESH) +
    String(configIndex) +
    String.fromCharCode(...idBytes)
  );
}

/** On-chain facts needed to build a refresh request for one agent. */
interface RefreshTarget {
  configIndex: number;
  nftOwner: string;
  currentExpiry: bigint;
  userDefinedData: string;
}

/**
 * Read everything needed to build a refresh QR for an agent.
 *
 * @param network - Network whose registry to read.
 * @param agentId - Agent to refresh.
 * @returns The refresh target, or an error response: 404 unknown agent,
 *   400 not refreshable (no stored config, or config not resolvable),
 *   422 agent ID cannot be encoded.
 * @throws On RPC failures.
 */
async function loadRefreshTarget(
  network: ApiNetwork,
  agentId: bigint,
): Promise<RefreshTarget | NextResponse> {
  // Registry ids are sequential; anything this large was never minted.
  if (agentId > BigInt(Number.MAX_SAFE_INTEGER)) {
    return errorResponse(ERRORS.agentNotFound, 404);
  }
  const networkConfig = getNetworkConfig(network);
  const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
  const registry = typedRegistry(networkConfig.registryAddress, provider);

  // The agent key is cleared when an agent is burned, so zero = no such agent.
  if ((await registry.agentIdToAgentKey(agentId)) === ethers.ZeroHash) {
    return errorResponse(ERRORS.agentNotFound, 404);
  }

  const [configId, nftOwner, currentExpiry, ...slotIds] = await Promise.all([
    registry.agentConfigId(agentId),
    registry.ownerOf(agentId),
    registry.proofExpiresAt(agentId),
    ...[0n, 1n, 2n, 3n, 4n, 5n].map((i) => registry.configIds(i)),
  ]);
  // configId 0: the registry stored no Self verification config for this
  // agent (registered before config tracking, or via an external proof
  // provider), and its refresh action reverts with RefreshNotSupported.
  if (configId === ethers.ZeroHash) {
    return errorResponse(
      "This agent has no stored verification config (it was registered " +
        "before config tracking or through an external proof provider), so " +
        "its proof can't be refreshed in place. Deregister it and register " +
        "again to renew its proof.",
      400,
    );
  }
  const configIndex = slotIds.indexOf(configId);
  if (configIndex < 0) {
    return errorResponse(
      "Could not resolve the agent's verification config",
      400,
    );
  }

  const userDefinedData = buildRefreshUserData(agentId, configIndex);
  if (!userDefinedData) {
    return errorResponse(
      `Proof refresh is not available for agent ${agentId} until the registry ` +
        "is upgraded (this agent id cannot be encoded in a Self refresh " +
        "proof). To renew this agent's proof, deregister it and register again.",
      422,
    );
  }
  return {
    configIndex,
    nftOwner,
    currentExpiry,
    userDefinedData,
  };
}

/**
 * Build the Self app request for a refresh, addressed to the NFT owner.
 *
 * @param network - Target network.
 * @param target - Loaded refresh target (owner and userDefinedData).
 * @param disclosures - Disclosures to request; must match the agent's config.
 * @returns The Self app request object.
 */
function buildRefreshSelfApp(
  network: ApiNetwork,
  target: RefreshTarget,
  disclosures: Partial<ParsedDisclosures>,
) {
  return buildSelfApp({
    network,
    userId: target.nftOwner,
    userDefinedData: target.userDefinedData,
    disclosures,
  });
}

/**
 * Open a refresh session for an agent at stage "qr-ready".
 *
 * Records the current proof expiry so the status route can detect the
 * refresh landing on-chain.
 *
 * @param req - JSON body: {agentId, network, disclosures? (defaults to the
 *   agent's on-chain config; if given, must select the same config)}.
 * @returns 200 {sessionToken, stage: "qr-ready", deepLink, qrImageBase64,
 *   scanUrl, expiresAt, timeRemainingMs, humanInstructions, qrData, agentId,
 *   network, configIndex}; 400 {error} validation, not refreshable or
 *   disclosure mismatch; 404 {error} agent not found; 413 {error} body too
 *   large; 422 {error} agent ID cannot be encoded; 429 {error, retryAfterMs};
 *   500 {error} SESSION_SECRET unset, or ERRORS.qrRender;
 *   502 {error} RPC failure.
 */
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `refresh:${getClientIp(req)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const parsedBody = await readJsonObjectBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  const agentId = parseAgentIdField(body.agentId);
  if (agentId === null) {
    return errorResponse(ERRORS.invalidAgentId, 400);
  }

  if (typeof body.network !== "string" || !isValidNetwork(body.network)) {
    return errorResponse(ERRORS.invalidNetwork, 400);
  }
  const network = body.network;

  // Omitted disclosures → use the agent's on-chain config.
  const requested = parseDisclosures(body.disclosures);
  if (!requested.ok) return errorResponse(requested.error, 400);

  const secret = requireSessionSecret();
  if (secret instanceof Response) return secret;

  try {
    const target = await loadRefreshTarget(network, agentId);
    if (target instanceof Response) return target;

    let disclosures: Partial<ParsedDisclosures> =
      INDEX_TO_DISCLOSURES[target.configIndex];
    if (body.disclosures !== undefined) {
      if (
        getRegistrationConfigIndex(requested.disclosures) !== target.configIndex
      ) {
        return errorResponse(
          "Disclosure mismatch: the provided disclosures do not match the agent's " +
            "on-chain verification config. Omit disclosures to use the agent's config.",
          400,
        );
      }
      disclosures = requested.disclosures;
    }

    const selfApp = buildRefreshSelfApp(network, target, disclosures);
    const deepLink = getUniversalLink(selfApp);
    let qrImageBase64: string;
    try {
      qrImageBase64 = await renderQrBase64(deepLink);
    } catch (err) {
      console.error("[refresh] QR render failed:", err);
      return errorResponse(ERRORS.qrRender, 500);
    }

    const { data: sessionData } = createSessionToken(
      { type: "refresh", network, humanAddress: target.nftOwner },
      secret,
    );
    // originalProofExpiry lets the status endpoint detect when the expiry changes.
    const sessionToken = encryptSession(
      {
        ...sessionData,
        stage: "qr-ready",
        agentId: Number(agentId),
        originalProofExpiry: target.currentExpiry.toString(),
      },
      secret,
    );

    const expiresAt = sessionData.expiresAt!;
    return jsonResponse({
      sessionToken,
      stage: "qr-ready",
      deepLink,
      qrImageBase64,
      scanUrl: `${getAppBaseUrl(req)}/api/qr/${createQrToken(deepLink, expiresAt, secret)}`,
      expiresAt,
      timeRemainingMs: Math.max(0, new Date(expiresAt).getTime() - Date.now()),
      humanInstructions: humanInstructions("qr-ready", "refresh"),
      qrData: selfApp,
      agentId: Number(agentId),
      network,
      configIndex: target.configIndex,
    });
  } catch (err) {
    console.error("[refresh] init failed:", err);
    return errorResponse(ERRORS.rpc, 502);
  }
}

/**
 * Redirect to the Self universal link that refreshes an agent's proof.
 *
 * Clickable re-auth entry point (the SDK's reauth URL): the config comes from
 * the agent's on-chain configId, so no disclosures are needed. On mobile the
 * link opens the Self app; on desktop Self's page renders a QR. Completion is
 * detected on-chain; no session is created.
 *
 * @param req - Query: `agentId`, `network` and/or `chainId` (must agree),
 *   `registry`? (must equal this service's registry for the chain).
 * @returns 302 to the Self universal link (with CORS headers); 400 {error} bad agent ID, network
 *   or registry, or not refreshable; 404 {error} agent not found; 422 {error}
 *   agent ID cannot be encoded; 429 {error, retryAfterMs}; 502 {error} RPC
 *   failure.
 */
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `refresh-get:${getClientIp(req)}`,
    limit: 20,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const sp = req.nextUrl.searchParams;
  const agentId = validateAgentId(sp.get("agentId") ?? "");
  if (agentId === null) {
    return errorResponse(ERRORS.invalidAgentId, 400);
  }

  // Accept ?network= and/or ?chainId= (the SDK reauth URL sends chainId).
  const networkParam = sp.get("network");
  const chainId = sp.get("chainId");
  const chainNetwork =
    chainId === null
      ? null
      : /^[1-9][0-9]*$/.test(chainId)
        ? (networkForChainId(chainId) ?? "")
        : "";
  const network = networkParam ?? chainNetwork;
  if (
    !network ||
    !isValidNetwork(network) ||
    chainNetwork === "" ||
    (chainNetwork !== null && chainNetwork !== network)
  ) {
    return errorResponse(
      "Provide a valid ?network=mainnet|testnet or ?chainId=42220|11142220 (they must agree if both are given)",
      400,
    );
  }
  const networkConfig = getNetworkConfig(network);

  // The SDK appends ?registry=<address> — the contract it verified the agent
  // against. This hosted service only serves its own canonical registries, so
  // if a registry is supplied it must match the one configured for this chain.
  // Otherwise we'd silently query a different contract (wrong agent/token id).
  // Self-hosters who redeploy a registry must front the API with their own
  // reauthBaseUrl, whose network config points at that registry.
  const registryParam = sp.get("registry");
  if (
    registryParam &&
    registryParam.toLowerCase() !== networkConfig.registryAddress.toLowerCase()
  ) {
    return errorResponse(
      `registry "${registryParam}" does not match this service's registry for ` +
        `${network} (${networkConfig.registryAddress}). This hosted endpoint ` +
        "only serves its canonical registry; self-hosted registries must front " +
        "the API with a matching reauthBaseUrl.",
      400,
    );
  }

  try {
    const target = await loadRefreshTarget(network, agentId);
    if (target instanceof Response) return target;

    const selfApp = buildRefreshSelfApp(
      network,
      target,
      INDEX_TO_DISCLOSURES[target.configIndex],
    );
    return new Response(null, {
      status: 302,
      headers: {
        ...AGENT_CORS_HEADERS,
        Location: getUniversalLink(selfApp),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("[refresh] reauth link generation failed:", err);
    return errorResponse(ERRORS.rpc, 502);
  }
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
