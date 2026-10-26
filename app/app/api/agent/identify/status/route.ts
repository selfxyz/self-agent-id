// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/identify/status — poll an identify session.
 *
 * Auth: session token (Authorization: Bearer). Rate limit: 120/min per IP.
 * Scans NullifierIdentified events and picks the one whose transaction
 * carries this session's random userId (inside the Hub userContextData). Once
 * found, returns the nullifier and agent count. The rotated session token
 * records the last block scanned, so each poll only scans blocks added since
 * the previous poll (plus a small overlap); always send the latest token.
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
import { REGISTRY_ABI } from "@/lib/constants";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Blocks re-scanned before the start block and before the last scanned block
 * (reorgs, and RPC nodes behind a load balancer lagging each other).
 */
const RESCAN_MARGIN = 5;
/** Mainnet Forno caps eth_getLogs at 5000 blocks (~80 min of ~1s blocks). */
const MAX_LOG_RANGE = 5_000;

/**
 * Look for this session's NullifierIdentified event and report the stage.
 *
 * Each poll costs one block-number call, one log query per 5000 new blocks
 * and one getTransaction per event in range; only blocks since the token's
 * `scannedToBlock` (minus RESCAN_MARGIN) are scanned.
 *
 * @param req - Request carrying the session token as a bearer.
 * @returns 200 {sessionToken, stage ("qr-ready" | "completed"), expiresAt,
 *   timeRemainingMs, humanInstructions, nullifier? and agentCount? (when
 *   completed)}; 400 {error} session problems or a pre-upgrade session;
 *   401/410 {error} invalid / expired token; 429 {error, retryAfterMs};
 *   500 {error} SESSION_SECRET unset; 502 {error} RPC failure.
 */
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `identify-status:${getClientIp(req)}`,
    limit: 120,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimitResponse(rl.retryAfterMs);

  const auth = requireSession(req, "identify");
  if (auth instanceof Response) return auth;
  const { session, secret } = auth;
  const { identifyUserId, startBlock, scannedToBlock } = session;
  if (typeof identifyUserId !== "string" || typeof startBlock !== "number") {
    return errorResponse(
      "Identify session predates this API version; start a new one",
      400,
    );
  }

  const respond = () =>
    sessionResponse(session, secret, {
      ...(session.stage === "completed"
        ? { nullifier: session.nullifier, agentCount: session.agentCount }
        : {}),
      humanInstructions: humanInstructions(
        session.stage as RegistrationStage,
        "identification",
      ),
    });

  if (session.stage === "completed") return respond();

  try {
    const networkConfig = getNetworkConfig(session.network as ApiNetwork);
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = new ethers.Contract(
      networkConfig.registryAddress,
      REGISTRY_ABI,
      provider,
    );

    const latest = await provider.getBlockNumber();
    // Resume after the last poll's scan; the margin re-checks recent blocks.
    const resumeFrom =
      typeof scannedToBlock === "number"
        ? Math.max(startBlock, scannedToBlock + 1)
        : startBlock;
    const events: ethers.EventLog[] = [];
    for (
      let from = Math.max(0, resumeFrom - RESCAN_MARGIN);
      from <= latest;
      from += MAX_LOG_RANGE
    ) {
      const to = Math.min(latest, from + MAX_LOG_RANGE - 1);
      const logs = await registry.queryFilter(
        registry.filters.NullifierIdentified(),
        from,
        to,
      );
      events.push(...(logs as ethers.EventLog[]));
    }

    // The proof tx calldata contains userContextData = destChainId ‖ userId ‖
    // userDefinedData, so this session's userId appears verbatim in tx.data.
    const needle = identifyUserId.slice(2).toLowerCase();
    const txs = await Promise.all(
      events.map((e) => provider.getTransaction(e.transactionHash)),
    );
    const match = events.find((_, i) =>
      txs[i]?.data.toLowerCase().includes(needle),
    );

    if (match) {
      session.stage = "completed";
      session.nullifier = (match.args[0] as bigint).toString();
      session.agentCount = Number(match.args[1] as bigint);
    } else if (typeof scannedToBlock !== "number" || latest > scannedToBlock) {
      // Carried in the rotated token, so the next poll starts here.
      session.scannedToBlock = latest;
    }
    return respond();
  } catch (err) {
    console.error("[identify/status] check failed:", err);
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
