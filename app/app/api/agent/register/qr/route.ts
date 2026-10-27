// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/register/qr — re-fetch the QR of a pending registration.
 *
 * Auth: session token (Authorization: Bearer). Rate limit: 120/min per IP.
 * Returns the Self app request (qrData), its deep link and a fresh scanUrl
 * that serves the QR as a PNG, so callers need no QR library.
 */

import type { NextRequest } from "next/server";
import { getUniversalLink } from "@selfxyz/sdk-common";
import type { SelfApp } from "@selfxyz/sdk-common";
import {
  jsonResponse,
  errorResponse,
  corsResponse,
  requireSession,
  getAppBaseUrl,
  getClientIp,
  rateLimitResponse,
} from "@/lib/agent-api-helpers";
import { createQrToken } from "@/lib/session-token";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Rebuild the deep link and scan URL for a session still at "qr-ready".
 *
 * @param req - Request carrying the session token as a bearer.
 * @returns 200 {deepLink, qrData, scanUrl}; 400 {error} missing token, wrong
 *   session type or no QR data; 401 {error} invalid token; 409 {error} stage
 *   is no longer "qr-ready"; 410 {error} expired; 429 {error, retryAfterMs};
 *   500 {error} SESSION_SECRET unset.
 */
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `register-qr:${getClientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const auth = requireSession(req, "register");
  if (auth instanceof Response) return auth;
  const { session, secret } = auth;

  if (session.stage !== "qr-ready") {
    return errorResponse(
      `QR code not available at stage: ${session.stage}`,
      409,
    );
  }

  const qrData = session.qrData as SelfApp | undefined;
  if (!qrData) {
    return errorResponse(
      "No QR data in session. Re-initiate registration.",
      400,
    );
  }

  const deepLink = getUniversalLink(qrData);
  const qrToken = createQrToken(deepLink, session.expiresAt!, secret);

  return jsonResponse({
    deepLink,
    qrData,
    scanUrl: `${getAppBaseUrl(req)}/api/qr/${qrToken}`,
  });
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
