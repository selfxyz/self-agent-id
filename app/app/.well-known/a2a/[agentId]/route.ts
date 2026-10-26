// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /.well-known/a2a/{agentId} — redirect to that agent's A2A card.
 *
 * Auth: none. Rate limit: none (no on-chain read here; the target counts).
 * Returns a 307 to /api/cards/{chainId}/{agentId}.
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  AGENT_CORS_HEADERS,
  corsResponse,
  getAppBaseUrl,
} from "@/lib/agent-api-helpers";
import { parseAgentTarget } from "@/lib/agent-read";
import { DEFAULT_NETWORK, NETWORKS } from "@/lib/network";

/**
 * Redirect to /api/cards/{chainId}/{agentId}, chain from `?chain` or
 * `?chainId` (default network otherwise).
 *
 * Validates the ids only; existence is checked by the card route.
 *
 * @param req - Incoming request (query: `chain` / `chainId`).
 * @param context.params - Path params: `agentId`.
 * @returns 307 redirect; 400 {error} bad chain or agent ID; 404 {error} for
 *   agent IDs above Number.MAX_SAFE_INTEGER.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> },
) {
  const { agentId } = await params;
  const chainId =
    req.nextUrl.searchParams.get("chain") ??
    req.nextUrl.searchParams.get("chainId") ??
    String(NETWORKS[DEFAULT_NETWORK].chainId);
  const parsed = parseAgentTarget(chainId, agentId);
  if (!parsed.ok) return parsed.response;

  return NextResponse.redirect(
    `${getAppBaseUrl(req)}/api/cards/${chainId}/${agentId}`,
    { status: 307, headers: AGENT_CORS_HEADERS },
  );
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
