// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/health — liveness check.
 *
 * Auth: none. Rate limit: none.
 * Returns {status: "ok", service, timestamp}; never cached.
 */

import { NextResponse } from "next/server";
import { AGENT_CORS_HEADERS, corsResponse } from "@/lib/agent-api-helpers";

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}

/**
 * Report that the service is up.
 *
 * @returns 200 {status: "ok", service: "self-agent-id", timestamp}.
 */
export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "self-agent-id",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        ...AGENT_CORS_HEADERS,
        "Cache-Control": "no-cache, no-store",
      },
    },
  );
}
