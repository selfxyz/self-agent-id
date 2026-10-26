// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/agent/deregister — start a deregistration session.
 *
 * Auth: none (the human authorises by re-proving in the Self app).
 * Rate limit: 10/min per IP.
 * Returns a session token and the Self app QR; once scanned, the registry
 * burns the agent NFT. Ed25519 agents cannot be removed this way.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  buildSimpleDeregisterUserDataAscii,
  buildAdvancedDeregisterUserDataAscii,
  getRegistrationConfigIndex,
} from "@selfxyz/agent-sdk";
import { getUniversalLink } from "@selfxyz/qrcode";
import { renderQrBase64 } from "@/lib/render-qr";
import {
  createQrToken,
  createSessionToken,
  encryptSession,
} from "@/lib/session-token";
import {
  ERRORS,
  requireSessionSecret,
  getNetworkConfig,
  isValidNetwork,
  parseAddress,
  parseAgentIdField,
  checkAgentOnChain,
  jsonResponse,
  errorResponse,
  corsResponse,
  getAppBaseUrl,
  getClientIp,
  rateLimitResponse,
  readJsonObjectBody,
  parseDisclosures,
  humanInstructions,
} from "@/lib/agent-api-helpers";
import { agentAddressFromKey } from "@/lib/agent-read";
import { checkRateLimit } from "@/lib/rate-limit";
import { typedRegistry } from "@/lib/contract-types";
import { buildSelfApp } from "@/lib/self-app";

/**
 * Resolve the agent, pick the deregister action from its NFT owner, and open
 * a deregistration session at stage "qr-ready".
 *
 * @param req - JSON body: {network, agentAddress? and/or agentId? (at least
 *   one; must agree if both), disclosures?}.
 * @returns 200 {sessionToken, stage: "qr-ready", deepLink, qrImageBase64,
 *   scanUrl, expiresAt, timeRemainingMs, humanInstructions, qrData,
 *   agentAddress, agentId, network, configIndex}; 400 {error} validation,
 *   mismatch or Ed25519 agent; 404 {error} agent not found or no human proof;
 *   413 {error} body too large; 429 {error, retryAfterMs}; 500 {error}
 *   SESSION_SECRET unset, or ERRORS.qrRender; 502 {error} RPC
 *   failure.
 */
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `deregister:${getClientIp(req)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const parsedBody = await readJsonObjectBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  // ── Validate network ─────────────────────────────────────────────────────
  if (typeof body.network !== "string" || !isValidNetwork(body.network)) {
    return errorResponse(ERRORS.invalidNetwork, 400);
  }
  const network = body.network;
  const networkConfig = getNetworkConfig(network);

  // ── Identify the agent: agentAddress and/or agentId ──────────────────────
  let agentAddress: string | undefined;
  if (body.agentAddress !== undefined) {
    const parsed = parseAddress(body.agentAddress);
    if (!parsed) {
      return errorResponse(`${ERRORS.invalidAddress} (agentAddress)`, 400);
    }
    agentAddress = parsed;
  }
  let requestedId: bigint | null = null;
  if (body.agentId !== undefined) {
    requestedId = parseAgentIdField(body.agentId);
    if (requestedId === null) {
      return errorResponse(ERRORS.invalidAgentId, 400);
    }
  }
  if (!agentAddress && requestedId === null) {
    return errorResponse("agentAddress or agentId is required", 400);
  }

  const parsedDisclosures = parseDisclosures(body.disclosures);
  if (!parsedDisclosures.ok) {
    return errorResponse(parsedDisclosures.error, 400);
  }
  const disclosures = parsedDisclosures.disclosures;

  const secret = requireSessionSecret();
  if (secret instanceof Response) return secret;

  try {
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = typedRegistry(networkConfig.registryAddress, provider);

    if (requestedId !== null) {
      if (requestedId > BigInt(Number.MAX_SAFE_INTEGER)) {
        return errorResponse(ERRORS.agentNotFound, 404);
      }
      const agentKey = await registry.agentIdToAgentKey(requestedId);
      if (agentKey === ethers.ZeroHash) {
        return errorResponse(ERRORS.agentNotFound, 404);
      }
      // The Self-proof deregister actions (D/X) look agents up by an EVM
      // address key (the address left-padded to 32 bytes), so an Ed25519 key
      // can't be removed through this flow.
      const keyAddress = agentAddressFromKey(agentKey);
      if (ethers.zeroPadValue(keyAddress, 32) !== agentKey.toLowerCase()) {
        return errorResponse(
          "This is an Ed25519 agent. Ed25519 agents can't be deregistered with a " +
            "passport scan; the agent's guardian must call guardianRevoke(agentId), " +
            "or the NFT owner selfDeregister(agentId), on the registry contract.",
          400,
        );
      }
      if (agentAddress && agentAddress !== keyAddress) {
        return errorResponse("agentAddress does not match agentId", 400);
      }
      agentAddress = keyAddress;
    }

    // ── Verify agent is registered on-chain ──────────────────────────────
    const address = agentAddress!;
    const { hasHumanProof, agentId } = await checkAgentOnChain(
      address,
      networkConfig,
    );
    if (!hasHumanProof) {
      return errorResponse(ERRORS.agentNotFound, 404);
    }

    // ── Determine the deregister action from the NFT owner ───────────────
    // If the agent owns its own NFT, action D with userId = agent address
    // removes key pad(agentAddress). Otherwise the NFT owner is the human's
    // wallet: action X names the agent address and userId is the owner.
    const nftOwner: string = await registry.ownerOf(agentId);
    const isSimple = ethers.getAddress(nftOwner) === address;

    const userDefinedData = isSimple
      ? buildSimpleDeregisterUserDataAscii(disclosures)
      : buildAdvancedDeregisterUserDataAscii({
          agentAddress: address,
          disclosures,
        });
    const humanAddress = isSimple ? address : nftOwner;

    const selfApp = buildSelfApp({
      network,
      userId: humanAddress,
      userDefinedData,
      disclosures,
    });

    const deepLink = getUniversalLink(selfApp);
    let qrImageBase64: string;
    try {
      qrImageBase64 = await renderQrBase64(deepLink);
    } catch (err) {
      console.error("[deregister] QR render failed:", err);
      return errorResponse(ERRORS.qrRender, 500);
    }

    // ── Create encrypted session token ───────────────────────────────────
    const { data: sessionData } = createSessionToken(
      { type: "deregister", network, humanAddress, agentAddress: address },
      secret,
    );
    const sessionToken = encryptSession(
      { ...sessionData, stage: "qr-ready", agentId: Number(agentId) },
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
      humanInstructions: [
        ...humanInstructions("qr-ready", "deregistration"),
        "Deregistering burns the agent NFT and removes its on-chain verification.",
      ],
      qrData: selfApp,
      agentAddress: address,
      agentId: Number(agentId),
      network,
      configIndex: getRegistrationConfigIndex(disclosures),
    });
  } catch (err) {
    console.error("[deregister] init failed:", err);
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
