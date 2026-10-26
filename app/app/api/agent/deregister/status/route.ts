// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/deregister/status — poll a deregistration session.
 *
 * Auth: session token (Authorization: Bearer). Rate limit: 120/min per IP.
 * Returns a rotated session token; stage is "completed" once the agent has
 * lost its human proof on-chain (burned).
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
 * Re-check the agent's human proof and report the deregistration stage.
 *
 * @param req - Request carrying the session token as a bearer.
 * @returns 200 {sessionToken, stage ("qr-ready" | "completed"), expiresAt,
 *   timeRemainingMs, agentAddress, agentId, humanInstructions};
 *   400/401/410 {error} session problems; 429 {error, retryAfterMs};
 *   500 {error} SESSION_SECRET unset; 502 {error} RPC failure.
 */
export async function GET(req: NextRequest) {
  // Generous: each poll costs an RPC call; clients poll every few seconds.
  const rl = await checkRateLimit({
    key: `deregister-status:${getClientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const auth = requireSession(req, "deregister");
  if (auth instanceof Response) return auth;
  const { session, secret } = auth;

  const respond = () =>
    sessionResponse(session, secret, {
      agentAddress: session.agentAddress,
      agentId: session.agentId,
      humanInstructions: humanInstructions(
        session.stage as RegistrationStage,
        "deregistration",
      ),
    });

  if (session.stage === "completed") return respond();

  try {
    const networkConfig = getNetworkConfig(session.network as ApiNetwork);
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = typedRegistry(networkConfig.registryAddress, provider);

    // Burning the agent clears its human proof flag. The chain is the only
    // source of truth, so any stage other than "completed" is re-checked.
    session.stage = (await registry.hasHumanProof(BigInt(session.agentId!)))
      ? "qr-ready"
      : "completed";
    return respond();
  } catch (err) {
    console.error("[deregister/status] check failed:", err);
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
