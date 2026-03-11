// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /api/agent/refresh/status
//
// Poll proof refresh status. Checks on-chain whether the agent's proof
// expiry has been updated (isProofFresh), and returns the new expiry
// timestamp when complete.

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  decryptAndValidateSession,
  getNetworkConfig,
  sessionResponse,
  errorResponse,
  corsResponse,
  readSessionTokenFromRequest,
  type ApiNetwork,
} from "@/lib/agent-api-helpers";
import { typedRegistry } from "@/lib/contract-types";

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

  if (session.type !== "refresh") {
    return errorResponse("Token is not for a proof refresh session", 400);
  }

  // If already completed or failed, return current state
  if (session.stage === "completed" || session.stage === "failed") {
    return sessionResponse(session, secret, {
      agentId: session.agentId,
      proofExpiresAt: session.proofExpiresAt,
      humanInstructions:
        session.stage === "completed"
          ? [
              "Proof refresh complete. Your agent's human proof has been renewed.",
            ]
          : ["Proof refresh failed. Check the error details and try again."],
    });
  }

  // Check on-chain status
  try {
    const networkConfig = getNetworkConfig(session.network as ApiNetwork);
    const agentId = session.agentId;
    if (agentId == null) {
      return errorResponse("Session missing agentId", 500);
    }

    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = typedRegistry(networkConfig.registryAddress, provider);

    // Read the current on-chain proof expiry
    const expiryTimestamp = await registry.proofExpiresAt(BigInt(agentId));

    // Compare against the expiry stored at session creation. If the on-chain
    // expiry has increased, the refresh was processed successfully.
    // Falls back to isProofFresh() if originalProofExpiry is not in the session
    // (shouldn't happen, but defensive).
    const originalExpiry = session.originalProofExpiry
      ? BigInt(session.originalProofExpiry as string)
      : 0n;
    const refreshed =
      originalExpiry > 0n
        ? expiryTimestamp > originalExpiry
        : await registry.isProofFresh(BigInt(agentId));

    if (refreshed) {
      const proofExpiresAt = new Date(
        Number(expiryTimestamp) * 1000,
      ).toISOString();

      session.stage = "completed";
      session.proofExpiresAt = proofExpiresAt;

      return sessionResponse(session, secret, {
        agentId,
        proofExpiresAt,
        humanInstructions: [
          "Proof refresh complete. Your agent's human proof has been renewed.",
        ],
      });
    }

    // Not yet refreshed — return current stage
    const stageInstructions: Record<string, string[]> = {
      "qr-ready": [
        "Open the Self app on your phone.",
        "Scan the QR code to refresh your agent's proof.",
        "Follow the prompts to scan your passport.",
        "Wait for the updated proof to be recorded on-chain.",
      ],
      "proof-received": [
        "Proof received from Self app.",
        "Waiting for on-chain confirmation...",
      ],
      pending: ["Session created. Awaiting QR generation."],
    };

    return sessionResponse(session, secret, {
      agentId,
      humanInstructions:
        stageInstructions[session.stage as string] ??
        stageInstructions["qr-ready"],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Refresh status check failed: ${msg}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
