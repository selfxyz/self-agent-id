// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// POST /api/agent/register/export
//
// Export agent private key after successful registration.
// Only available for modes that generate a keypair (agent-identity, wallet-free).
// Token is sent in the request body (not query string) to avoid leaking via
// server logs, browser history, and Referer headers.

import { NextRequest } from "next/server";
import {
  decryptAndValidateSession,
  jsonResponse,
  errorResponse,
  corsResponse,
} from "@/lib/agent-api-helpers";

export async function POST(req: NextRequest) {
  let body: { token?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const token = body.token;
  if (!token) {
    return errorResponse("Missing token in request body", 400);
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
    return errorResponse("Invalid session token", 401);
  }

  if (session.type !== "register") {
    return errorResponse("Token is not for a registration session", 400);
  }

  if (session.stage !== "completed") {
    return errorResponse(
      `Cannot export key until registration is complete. Current stage: ${session.stage}`,
      409,
    );
  }

  if (!session.agentPrivateKey) {
    return errorResponse(
      "No private key available. Simple/verified-wallet mode does not generate an agent keypair.",
      400,
    );
  }

  return jsonResponse({
    privateKey: session.agentPrivateKey,
    agentAddress: session.agentAddress,
    agentId: session.agentId,
    network: session.network,
    mode: session.mode,
  });
}

export async function OPTIONS() {
  return corsResponse();
}
