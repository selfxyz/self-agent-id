// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /api/agent/register/status?token=<encrypted_token>
//
// Poll registration status. Checks on-chain whether the agent is verified,
// and returns updated session state.

import type { NextRequest } from "next/server";
import {
  decryptAndValidateSession,
  getNetworkConfig,
  checkAgentOnChain,
  sessionResponse,
  humanInstructions,
  errorResponse,
  corsResponse,
  type ApiNetwork,
} from "@/lib/agent-api-helpers";
import { REGISTRY_ABI } from "@/lib/constants";
import { ethers } from "ethers";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return errorResponse("Missing token query parameter", 400);
  }

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

  if (session.type !== "register") {
    return errorResponse("Token is not for a registration session", 400);
  }

  // If already completed or failed, return current state
  if (session.stage === "completed" || session.stage === "failed") {
    return sessionResponse(session, secret, {
      agentAddress: session.agentAddress,
      agentId: session.agentId,
      humanInstructions: humanInstructions(session.stage),
    });
  }

  // Check on-chain status
  try {
    const networkConfig = getNetworkConfig(session.network as ApiNetwork);
    const agentAddress = session.agentAddress;
    if (!agentAddress) {
      return errorResponse("Session missing agentAddress", 500);
    }

    const { isVerified, agentId } = await checkAgentOnChain(
      agentAddress,
      networkConfig,
    );

    if (isVerified) {
      // Fetch credentials if available
      let credentials = null;
      try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
        const registry = new ethers.Contract(
          networkConfig.registryAddress,
          REGISTRY_ABI,
          provider,
        );
        const rawCreds = await registry.getAgentCredentials(agentId);
        credentials = {
          nationality: rawCreds.nationality || undefined,
          issuingState: rawCreds.issuingState || undefined,
          olderThan: Number(rawCreds.olderThan) || undefined,
          ofac: rawCreds.ofac ? Array.from(rawCreds.ofac) : undefined,
          dateOfBirth: rawCreds.dateOfBirth || undefined,
          gender: rawCreds.gender || undefined,
          expiryDate: rawCreds.expiryDate || undefined,
        };
      } catch {
        // Credentials may not be available for all configs
      }

      session.stage = "completed";
      session.agentId = Number(agentId);

      return sessionResponse(session, secret, {
        agentAddress,
        agentId: Number(agentId),
        credentials,
        humanInstructions: humanInstructions("completed"),
      });
    }

    // Not yet verified — return current stage
    return sessionResponse(session, secret, {
      agentAddress,
      humanInstructions: humanInstructions(
        session.stage as "qr-ready" | "proof-received" | "pending",
      ),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Status check failed: ${msg}`, 500);
  }
}

export async function OPTIONS() {
  return corsResponse();
}
