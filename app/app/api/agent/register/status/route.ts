// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/register/status — poll a registration session.
 *
 * Auth: session token (Authorization: Bearer). Rate limit: 120/min per IP.
 * Checks on-chain whether the agent has its human proof and returns a rotated
 * session token. The poll that first observes completion resets expiresAt to
 * 30 minutes from then, the window for POST /api/agent/register/export.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  ERRORS,
  getNetworkConfig,
  checkAgentOnChain,
  sessionResponse,
  humanInstructions,
  errorResponse,
  corsResponse,
  requireSession,
  getClientIp,
  rateLimitResponse,
  type ApiNetwork,
} from "@/lib/agent-api-helpers";
import { disclosed, publicCredentials } from "@/lib/agent-read";
import { checkRateLimit } from "@/lib/rate-limit";
import { typedRegistry } from "@/lib/contract-types";

/** Time the client gets to export the key once completion is observed. */
const EXPORT_WINDOW_MS = 30 * 60_000;

/**
 * How long past expiry a registration that holds a server-generated key may
 * still be polled. The Self deep link itself never expires, so a scan can land
 * after the session did; without this the generated key would be lost.
 */
const KEY_RECOVERY_GRACE_MS = 24 * 60 * 60_000;

/**
 * Check the registry for the session's agent and advance the session to
 * "completed" once it has its human proof.
 *
 * A pending session holding a server-generated key can still be polled up to
 * 24 h after expiry, so a late scan does not lose the key.
 *
 * @param req - Request carrying the session token as a bearer.
 * @returns 200 {sessionToken, stage, expiresAt, timeRemainingMs, agentAddress,
 *   humanInstructions, agentId? (when completed), credentials? (only on the
 *   poll that first observes completion)}; 400/401/410 {error} session
 *   problems; 429 {error, retryAfterMs}; 500 {error} SESSION_SECRET unset;
 *   502 {error} RPC failure.
 */
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `register-status:${getClientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfterMs);
  }

  const auth = requireSession(req, "register", {
    graceMs: KEY_RECOVERY_GRACE_MS,
  });
  if (auth instanceof Response) return auth;
  const { session, secret } = auth;

  // Only a pending session holding a generated key gets the grace period;
  // everything else expires on time.
  const expired = new Date(session.expiresAt!).getTime() < Date.now();
  if (expired && (session.stage === "completed" || !session.agentPrivateKey)) {
    return errorResponse("Session expired", 410);
  }

  // Already completed: keep answering from the token until it expires.
  if (session.stage === "completed") {
    return sessionResponse(session, secret, {
      agentAddress: session.agentAddress,
      agentId: session.agentId,
      humanInstructions: humanInstructions("completed"),
    });
  }

  const agentAddress = session.agentAddress;
  if (!agentAddress) {
    return errorResponse("Invalid session token", 401);
  }
  const networkConfig = getNetworkConfig(session.network as ApiNetwork);

  // Both Ed25519 modes register the raw 32-byte pubkey as the agentKey.
  // Wallet-based agents use the zero-padded address.
  const ed25519Pubkey =
    session.mode === "ed25519" || session.mode === "ed25519-linked"
      ? (session.ed25519Pubkey as string | undefined)
      : undefined;

  let hasHumanProof: boolean;
  let agentId: bigint;
  try {
    ({ hasHumanProof, agentId } = ed25519Pubkey
      ? await checkAgentOnChain("0x" + ed25519Pubkey, networkConfig, true)
      : await checkAgentOnChain(agentAddress, networkConfig));
  } catch (err) {
    console.error("register/status: on-chain check failed", err);
    return errorResponse(ERRORS.rpc, 502);
  }

  if (!hasHumanProof) {
    if (expired) return errorResponse("Session expired", 410);
    return sessionResponse(session, secret, {
      agentAddress,
      humanInstructions: humanInstructions(
        session.stage as "qr-ready" | "proof-received" | "pending",
      ),
    });
  }

  // Credentials are informational: an RPC failure here must not hold up the
  // completion (and the key export it unlocks).
  let credentials: Record<string, unknown> | undefined;
  try {
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = typedRegistry(networkConfig.registryAddress, provider);
    const raw = await registry.getAgentCredentials(agentId);
    credentials = {
      ...publicCredentials(raw),
      issuingState: disclosed(raw.issuingState),
      dateOfBirth: disclosed(raw.dateOfBirth),
      gender: disclosed(raw.gender),
      expiryDate: disclosed(raw.expiryDate),
    };
  } catch (err) {
    console.error("register/status: credentials read failed", err);
  }

  // First observation of completion: restart the clock so the client has a
  // full export window for the generated key.
  session.stage = "completed";
  session.agentId = Number(agentId);
  session.expiresAt = new Date(Date.now() + EXPORT_WINDOW_MS).toISOString();

  return sessionResponse(session, secret, {
    agentAddress,
    agentId: session.agentId,
    ...(credentials ? { credentials } : {}),
    humanInstructions: humanInstructions("completed"),
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
