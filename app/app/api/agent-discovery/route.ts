// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent-discovery — discovery document (modes, networks, endpoints,
 * SDK packages).
 *
 * Auth: none. Rate limit: none.
 * Returns JSON (cacheable for 1 h). Also served at "/" via Accept negotiation
 * (see middleware.ts).
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAgentDiscoveryJSON } from "@/lib/agent-discovery";
import {
  AGENT_CORS_HEADERS,
  corsResponse,
  getAppBaseUrl,
} from "@/lib/agent-api-helpers";

/**
 * Serve the discovery document.
 *
 * @param req - Incoming request (used for the base URL).
 * @returns 200 discovery JSON, `Vary: Accept`.
 */
export function GET(req: NextRequest) {
  return NextResponse.json(getAgentDiscoveryJSON(getAppBaseUrl(req)), {
    headers: {
      ...AGENT_CORS_HEADERS,
      "Cache-Control": "public, max-age=3600",
      // Also served at "/" via Accept negotiation (see middleware.ts).
      Vary: "Accept",
    },
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
