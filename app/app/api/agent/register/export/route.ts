// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/agent/register/export — export the server-generated agent key.
 *
 * Auth: session token, as `Authorization: Bearer` (preferred) or
 * `{ "token": ... }` in the JSON body, never the query string.
 * Rate limit: 120/min per IP.
 * Returns the private key of a completed linked, wallet-free, privy or
 * smartwallet registration. Every response, errors included, is sent with
 * Cache-Control: no-store.
 */

import type { NextRequest, NextResponse } from "next/server";
import {
  jsonResponse,
  errorResponse,
  corsResponse,
  extractBearerToken,
  getClientIp,
  rateLimitResponse,
  readJsonObjectBody,
  requireSession,
} from "@/lib/agent-api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Return the private key held in a completed registration session, with
 * Cache-Control: no-store on every response.
 *
 * @param req - Bearer session token, or JSON body {token}.
 * @returns 200 {privateKey, agentAddress, agentId, network, mode};
 *   400 {error} no token, wrong session type or an ed25519 session (no
 *   server-held key); 401 {error} invalid token; 409 {error} not completed
 *   (use the rotated token from the completing status poll); 410 {error}
 *   expired; 413 {error} body too large; 429 {error, retryAfterMs};
 *   500 {error} SESSION_SECRET unset.
 */
export async function POST(req: NextRequest) {
  const res = await exportKey(req);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * Authenticate the session and build the export response (see POST).
 *
 * @param req - Bearer session token, or JSON body {token}.
 * @returns The response POST sends, before the no-store header is added.
 */
async function exportKey(req: NextRequest): Promise<NextResponse> {
  const rl = await checkRateLimit({
    key: `register-export:${getClientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  let token = extractBearerToken(req.headers.get("authorization"));
  if (!token) {
    const parsed = await readJsonObjectBody(req, undefined, {
      allowEmpty: true,
    });
    if (!parsed.ok) return parsed.response;
    if (typeof parsed.body.token === "string" && parsed.body.token) {
      token = parsed.body.token;
    }
  }
  if (!token) {
    return errorResponse(
      'Missing session token. Provide Authorization: Bearer <sessionToken> or { "token": ... } in the body.',
      400,
    );
  }

  const auth = requireSession(req, "register", { token });
  if (auth instanceof Response) return auth;
  const { session } = auth;

  if (session.stage !== "completed") {
    return errorResponse(
      `Cannot export key until registration is complete. Current stage: ${session.stage}`,
      409,
    );
  }

  if (!session.agentPrivateKey) {
    return errorResponse(
      "No private key to export: in ed25519 and ed25519-linked modes the agent holds its own Ed25519 key.",
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

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
