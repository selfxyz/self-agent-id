// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /api/agent/deregister/status
//
// Poll deregistration status. Checks on-chain whether the agent is
// no longer verified, and returns updated session state.

import type { NextRequest } from "next/server";
import {
  decryptAndValidateSession,
  getNetworkConfig,
  checkAgentOnChain,
  sessionResponse,
  humanInstructions,
  errorResponse,
  corsResponse,
  readSessionTokenFromRequest,
  type ApiNetwork,
} from "@/lib/agent-api-helpers";

export async function GET(req: NextRequest) {
  const tokenResult = readSessionTokenFromRequest(req);
  if (!tokenResult.token) {
    return errorResponse(tokenResult.error || "Missing session token", 400);
  }
  const token = tokenResult.token;

  let session;
  let secret: string;
  try {
    const result = decryptAndValidateSession(token);
    session = result.session;
    secret = result.secret;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("expired")) {
      return errorResponse("Session expired", 410);
    }
    return errorResponse(`Invalid session token: ${msg}`, 401);
  }

  if (session.type !== "deregister") {
    return errorResponse("Token is not for a deregistration session", 400);
  }

  // If already completed or failed, return current state
  if (session.stage === "completed" || session.stage === "failed") {
    return sessionResponse(session, secret, {
      agentAddress: session.agentAddress,
      agentId: session.agentId,
      humanInstructions: humanInstructions(session.stage),
    });
  }

  // Check on-chain: agent should no longer be verified
  try {
    const networkConfig = getNetworkConfig(session.network as ApiNetwork);
    const agentAddress = session.agentAddress;
    if (!agentAddress) {
      return errorResponse("Session missing agentAddress", 500);
    }

    const { isVerified } = await checkAgentOnChain(agentAddress, networkConfig);

    if (!isVerified) {
      // Agent is no longer verified — deregistration complete
      session.stage = "completed";
      return sessionResponse(session, secret, {
        agentAddress,
        agentId: session.agentId,
        humanInstructions: [
          "Deregistration complete.",
          "Your agent has been removed from the on-chain registry.",
        ],
      });
    }

    // Still verified — deregistration not yet processed
    return sessionResponse(session, secret, {
      agentAddress,
      agentId: session.agentId,
      humanInstructions: humanInstructions(
        session.stage as "qr-ready" | "proof-received" | "pending",
      ),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Status check failed: ${msg}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
