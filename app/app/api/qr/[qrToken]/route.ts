// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/qr/{qrToken} — QR code PNG behind a session's scanUrl.
 *
 * Auth: the QR token in the path (session tokens are rejected here, and QR
 * tokens everywhere else). Rate limit: 60/min per IP.
 * Returns the deep link's QR as an uncached PNG. A QR token holds nothing but
 * the deep link and an expiry (see createQrToken).
 */

import type { NextRequest } from "next/server";
import {
  errorResponse,
  corsResponse,
  getClientIp,
  pngResponse,
  requireSessionSecret,
  rateLimitResponse,
  ERRORS,
} from "@/lib/agent-api-helpers";
import { readQrToken } from "@/lib/session-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { renderQrPng } from "@/lib/render-qr";

/**
 * Decrypt the QR token and render its deep link as a PNG.
 *
 * @param req - Incoming request (counted against the per-IP limit).
 * @param context.params - Path params: `qrToken`.
 * @returns 200 image/png; 401 {error} not a valid QR token; 410 {error}
 *   expired; 429 {error, retryAfterMs}; 500 {error} render failure or
 *   SESSION_SECRET unset.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ qrToken: string }> },
) {
  const rl = await checkRateLimit({
    key: `qr-image:${getClientIp(req)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfterMs);
  }

  const { qrToken } = await params;
  const secret = requireSessionSecret();
  if (secret instanceof Response) return secret;

  let deepLink: string;
  try {
    ({ deepLink } = readQrToken(qrToken, secret));
  } catch (err) {
    if (err instanceof Error && err.message === "Session expired") {
      return errorResponse("Session expired", 410);
    }
    return errorResponse("Invalid QR token", 401);
  }

  let png: Buffer;
  try {
    png = await renderQrPng(deepLink);
  } catch (err) {
    console.error("qr: render failed", err);
    return errorResponse(ERRORS.qrRender, 500);
  }

  return pngResponse(png, "self-agent-id-qr.png");
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
