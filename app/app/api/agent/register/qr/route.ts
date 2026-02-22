// GET /api/agent/register/qr?token=<encrypted_token>
//
// Returns QR code data for the registration deep link.
// Provides the deep link plus a URL to a public QR image API
// so the caller can display a scannable QR without extra dependencies.

import { NextRequest } from "next/server";
import { getUniversalLink } from "@selfxyz/qrcode";
import type { SelfApp } from "@selfxyz/qrcode";
import {
  decryptAndValidateSession,
  jsonResponse,
  errorResponse,
  corsResponse,
} from "@/lib/agent-api-helpers";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return errorResponse("Missing token query parameter", 400);
  }

  let session;
  try {
    const result = decryptAndValidateSession(token);
    session = result.session;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("expired")) {
      return errorResponse("Session expired", 410);
    }
    return errorResponse(`Invalid session token: ${msg}`, 401);
  }

  if (session.type !== "register" && session.type !== "deregister") {
    return errorResponse("Token is not for a registration/deregistration session", 400);
  }

  if (session.stage !== "qr-ready") {
    return errorResponse(
      `QR code not available at stage: ${session.stage}`,
      409,
    );
  }

  const qrData = session.qrData as SelfApp | undefined;
  if (!qrData) {
    return errorResponse("No QR data in session. Re-initiate registration.", 400);
  }

  const deepLink = getUniversalLink(qrData);
  const size = 400;
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(deepLink)}`;

  return jsonResponse({
    deepLink,
    qrImageUrl,
    selfApp: qrData,
  });
}

export async function OPTIONS() {
  return corsResponse();
}
