// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /api/agent/identify/status
//
// Poll identify status. Scans recent blocks for the NullifierIdentified event
// emitted by the contract. Once found, returns the nullifier and agentCount
// so the frontend can call getAgentsForNullifier().

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
import { REGISTRY_ABI } from "@/lib/constants";

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

  if (session.type !== "identify") {
    return errorResponse("Token is not for an identify session", 400);
  }

  // Already completed
  if (session.stage === "completed") {
    return sessionResponse(session, secret, {
      nullifier: session.nullifier,
      agentCount: session.agentCount,
      humanInstructions: [
        "Identification complete. Your agents are shown below.",
      ],
    });
  }

  try {
    const networkConfig = getNetworkConfig(session.network as ApiNetwork);
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = new ethers.Contract(
      networkConfig.registryAddress,
      REGISTRY_ABI,
      provider,
    );

    // Scan recent blocks for NullifierIdentified events.
    // Use a window based on session creation time — look from ~1 block before
    // session creation to current block.
    const currentBlock = await provider.getBlockNumber();
    const sessionCreated = session.createdAt
      ? new Date(session.createdAt).getTime()
      : Date.now() - 30 * 60_000;
    // Celo: ~5s blocks → ~12 blocks/min → 360 blocks for 30 min session
    const elapsedMs = Date.now() - sessionCreated;
    const estimatedBlocks = Math.ceil(elapsedMs / 5000) + 10; // +10 buffer
    const fromBlock = Math.max(0, currentBlock - estimatedBlocks);

    const filter = registry.filters.NullifierIdentified();
    const events = await registry.queryFilter(filter, fromBlock, currentBlock);

    if (events.length > 0) {
      // Take the most recent event — if multiple identify calls happened,
      // we want the latest one from this session's time window.
      const latest = events[events.length - 1];
      const log = latest as ethers.EventLog;
      const nullifier = log.args[0].toString();
      const agentCount = Number(log.args[1]);

      session.stage = "completed";
      session.nullifier = nullifier;
      session.agentCount = agentCount;

      return sessionResponse(session, secret, {
        nullifier,
        agentCount,
        humanInstructions: [
          "Identification complete. Your agents are shown below.",
        ],
      });
    }

    // Not yet identified
    return sessionResponse(session, secret, {
      humanInstructions: [
        "Open the Self app on your phone.",
        "Scan the QR code to identify yourself.",
        "Follow the prompts to scan your passport.",
        "Waiting for passport verification...",
      ],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return errorResponse(`Identify status check failed: ${msg}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
