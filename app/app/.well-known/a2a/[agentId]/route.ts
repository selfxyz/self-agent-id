// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { CORS_HEADERS, corsResponse, errorResponse, validateAgentId } from "@/lib/api-helpers";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { DEFAULT_NETWORK, NETWORKS } from "@/lib/network";

function resolveChainId(req: NextRequest): string {
  const fromQuery = req.nextUrl.searchParams.get("chain")
    ?? req.nextUrl.searchParams.get("chainId");

  if (fromQuery) return fromQuery;

  const fallback = NETWORKS[DEFAULT_NETWORK];
  return String(fallback.chainId);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  const { agentId } = await params;

  const id = validateAgentId(agentId);
  if (id === null) return errorResponse("Invalid agent ID", 400);

  const chainId = resolveChainId(req);
  if (!CHAIN_CONFIG[chainId]) {
    return errorResponse(`Unsupported chain: ${chainId}`, 400);
  }

  const target = new URL(`/api/cards/${chainId}/${id.toString()}`, req.nextUrl.origin);

  return NextResponse.redirect(target, {
    status: 307,
    headers: CORS_HEADERS,
  });
}

export async function OPTIONS() {
  return corsResponse();
}
