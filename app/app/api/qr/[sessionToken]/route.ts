// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /api/qr/[sessionToken]
//
// Returns the QR code for an active session as a PNG image.
// Decrypts the session to extract the deep link, renders it server-side,
// and serves the image directly — no client-side QR library required.
//
// Used by AI agents and non-browser clients that receive a session token
// and want to display a scannable QR without installing any Self SDK.

import type { NextRequest } from "next/server";
import { getUniversalLink } from "@selfxyz/qrcode";
import type { SelfApp } from "@selfxyz/qrcode";
import {
  decryptAndValidateSession,
  errorResponse,
  corsResponse,
} from "@/lib/agent-api-helpers";
import { renderQrPng } from "@/lib/renderQr";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionToken: string }> },
) {
  const { sessionToken } = await params;

  let session;
  try {
    const result = decryptAndValidateSession(sessionToken);
    session = result.session;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("expired")) {
      return errorResponse("Session expired", 410);
    }
    return errorResponse("Invalid session token", 401);
  }

  const qrData = session.qrData as SelfApp | undefined;
  if (!qrData) {
    return errorResponse("No QR data in session. Re-initiate the flow.", 400);
  }

  const deepLink = getUniversalLink(qrData);

  const png = await renderQrPng(deepLink);

  return new Response(png as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function OPTIONS() {
  return corsResponse();
}
