// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /.well-known/self-agent-id.json — discovery document (well-known path).
 *
 * Auth: none. Rate limit: none.
 * Returns the same JSON as GET /api/agent-discovery (cacheable for 1 h).
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
 * @returns 200 discovery JSON.
 */
export function GET(req: NextRequest) {
  return NextResponse.json(getAgentDiscoveryJSON(getAppBaseUrl(req)), {
    headers: {
      ...AGENT_CORS_HEADERS,
      "Cache-Control": "public, max-age=3600",
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
