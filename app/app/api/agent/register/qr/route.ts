// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /api/agent/register/qr
//
// Returns QR code data for the registration deep link.
// Provides the deep link plus a URL to a public QR image API
// so the caller can display a scannable QR without extra dependencies.

import type { NextRequest } from "next/server";
import { getUniversalLink } from "@selfxyz/qrcode";
import type { SelfApp } from "@selfxyz/qrcode";
import {
  decryptAndValidateSession,
  jsonResponse,
  errorResponse,
  corsResponse,
  readSessionTokenFromRequest,
} from "@/lib/agent-api-helpers";

export function GET(req: NextRequest) {
  const tokenResult = readSessionTokenFromRequest(req);
  if (!tokenResult.token) {
    return errorResponse(tokenResult.error || "Missing session token", 400);
  }
  const token = tokenResult.token;

  let session;
  try {
    const result = decryptAndValidateSession(token);
    session = result.session;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("expired")) {
      return errorResponse("Session expired", 410);
    }
    return errorResponse("Invalid session token", 401);
  }

  if (session.type !== "register" && session.type !== "deregister") {
    return errorResponse(
      "Token is not for a registration/deregistration session",
      400,
    );
  }

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

  // QR code should be generated client-side to avoid leaking registration
  // metadata to external services (previously used api.qrserver.com).
  return jsonResponse({
    deepLink,
    selfApp: qrData,
  });
}

export function OPTIONS() {
  return corsResponse();
}
