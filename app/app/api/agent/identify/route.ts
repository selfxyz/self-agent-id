// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/agent/identify — start an identify session (find a human's
 * agents by passport scan).
 *
 * Auth: none. Rate limit: 10/min per IP.
 * Returns a session token and a Self app QR for ACTION_IDENTIFY (0x49): the
 * registry emits NullifierIdentified(nullifier, agentCount) and changes no
 * state. Poll GET /api/agent/identify/status for the nullifier, then list the
 * agents with GET /api/agent/agents-by-nullifier/{chainId}/{nullifier}.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import { getUniversalLink } from "@selfxyz/sdk-common";
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
  jsonResponse,
  errorResponse,
  corsResponse,
  getAppBaseUrl,
  getClientIp,
  rateLimitResponse,
  readJsonObjectBody,
  humanInstructions,
} from "@/lib/agent-api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildSelfApp } from "@/lib/self-app";

/**
 * userDefinedData for ACTION_IDENTIFY: 'I' (0x49) followed by the config
 * index as an ASCII digit ('0' = 0x30; the contract also accepts raw 0x00).
 * The identify action ignores the config but the parser requires the byte.
 */
const IDENTIFY_USER_DATA = "I0";

/**
 * Open an identify session with a random per-session userId and the current
 * block as the event-scan start.
 *
 * @param req - JSON body: {network}.
 * @returns 200 {sessionToken, stage: "qr-ready", deepLink, qrImageBase64,
 *   scanUrl, expiresAt, timeRemainingMs, humanInstructions, qrData, network};
 *   400 {error} bad network; 413 {error} body too large; 429 {error,
 *   retryAfterMs}; 500 {error} SESSION_SECRET unset, or "Failed to render
 *   QR code"; 502 {error} RPC failure.
 */
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `identify:${getClientIp(req)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const parsedBody = await readJsonObjectBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const { network } = parsedBody.body;
  if (typeof network !== "string" || !isValidNetwork(network)) {
    return errorResponse(ERRORS.invalidNetwork, 400);
  }
  const networkConfig = getNetworkConfig(network);

  const secret = requireSessionSecret();
  if (secret instanceof Response) return secret;

  try {
    // The contract ignores the userId for identify, but the Hub transaction
    // carries it in userContextData. A random per-session id lets the status
    // endpoint find this session's NullifierIdentified event. It is address-
    // sized, like the userIds of every other flow.
    const identifyUserId = ethers.hexlify(ethers.randomBytes(20));
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const startBlock = await provider.getBlockNumber();

    const selfApp = buildSelfApp({
      network,
      userId: identifyUserId,
      userDefinedData: IDENTIFY_USER_DATA,
    });

    const deepLink = getUniversalLink(selfApp);
    let qrImageBase64: string;
    try {
      qrImageBase64 = await renderQrBase64(deepLink);
    } catch (err) {
      console.error("[identify] QR render failed:", err);
      return errorResponse(ERRORS.qrRender, 500);
    }

    const { data: sessionData } = createSessionToken(
      { type: "identify", network },
      secret,
    );
    const sessionToken = encryptSession(
      { ...sessionData, stage: "qr-ready", identifyUserId, startBlock },
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
      humanInstructions: humanInstructions("qr-ready", "identification"),
      qrData: selfApp,
      network,
    });
  } catch (err) {
    console.error("[identify] init failed:", err);
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
