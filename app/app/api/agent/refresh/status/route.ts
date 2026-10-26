// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/refresh/status — poll a proof refresh session.
 *
 * Auth: session token (Authorization: Bearer). Rate limit: 120/min per IP.
 * Stage is "completed" once the on-chain proof expiry moves past the one
 * recorded at session start (with the new proofExpiresAt), "failed" if the
 * agent is burned first.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  ERRORS,
  getNetworkConfig,
  sessionResponse,
  humanInstructions,
  errorResponse,
  corsResponse,
  requireSession,
  getClientIp,
  rateLimitResponse,
  type ApiNetwork,
  type RegistrationStage,
} from "@/lib/agent-api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { typedRegistry } from "@/lib/contract-types";

/**
 * Re-read the agent's proof expiry and report the refresh stage.
 *
 * Generous rate limit: each poll costs RPC calls and clients poll every few
 * seconds.
 *
 * @param req - Request carrying the session token as a bearer.
 * @returns 200 {sessionToken, stage ("qr-ready" | "completed" | "failed"),
 *   expiresAt, timeRemainingMs, agentId, humanInstructions, proofExpiresAt?
 *   (when completed), error? (when failed)}; 400/401/410 {error} session
 *   problems; 429 {error, retryAfterMs}; 500 {error} SESSION_SECRET unset;
 *   502 {error} RPC failure.
 */
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `refresh-status:${getClientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const auth = requireSession(req, "refresh");
  if (auth instanceof Response) return auth;
  const { session, secret } = auth;

  const agentId = session.agentId;
  const respond = () =>
    sessionResponse(session, secret, {
      agentId,
      ...(session.proofExpiresAt
        ? { proofExpiresAt: session.proofExpiresAt }
        : {}),
      ...(session.error ? { error: session.error } : {}),
      humanInstructions: humanInstructions(
        session.stage as RegistrationStage,
        "refresh",
      ),
    });

  if (session.stage === "completed" || session.stage === "failed") {
    return respond();
  }

  try {
    const networkConfig = getNetworkConfig(session.network as ApiNetwork);
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = typedRegistry(networkConfig.registryAddress, provider);

    const [expiry, hasProof] = await Promise.all([
      registry.proofExpiresAt(BigInt(agentId!)),
      registry.hasHumanProof(BigInt(agentId!)),
    ]);

    // The refresh landed once the on-chain expiry moves past the one recorded
    // when the session started.
    if (expiry > BigInt(session.originalProofExpiry as string)) {
      session.stage = "completed";
      session.proofExpiresAt = new Date(Number(expiry) * 1000).toISOString();
    } else if (!hasProof) {
      session.stage = "failed";
      session.error = "Agent was deregistered before the refresh completed.";
    }
  } catch (err) {
    console.error("[refresh/status] check failed:", err);
    return errorResponse(ERRORS.rpc, 502);
  }
  // Outside the try: only the chain reads above are logged on failure, never
  // the token rotation that uses SESSION_SECRET.
  return respond();
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
