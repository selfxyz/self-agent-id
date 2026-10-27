// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /llms.txt — plain-text usage guide for LLMs.
 *
 * Auth: none. Rate limit: none.
 * Returns text/plain (cacheable for 1 h). Also served at "/" via Accept
 * negotiation (see middleware.ts).
 */

import { type NextRequest, NextResponse } from "next/server";
import { getAgentDiscoveryText } from "@/lib/agent-discovery";
import {
  AGENT_CORS_HEADERS,
  corsResponse,
  getAppBaseUrl,
} from "@/lib/agent-api-helpers";

/**
 * Serve the plain-text guide.
 *
 * @param req - Incoming request (used for the base URL).
 * @returns 200 text/plain, `Vary: Accept`.
 */
export function GET(req: NextRequest) {
  return new NextResponse(getAgentDiscoveryText(getAppBaseUrl(req)), {
    headers: {
      ...AGENT_CORS_HEADERS,
      "Content-Type": "text/plain; charset=utf-8",
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
