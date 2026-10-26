// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /.well-known/agent-registration — registration entry point.
 *
 * Auth: none. Rate limit: none.
 * Returns a 307 to /api/agent/bootstrap.
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  AGENT_CORS_HEADERS,
  corsResponse,
  getAppBaseUrl,
} from "@/lib/agent-api-helpers";

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}

/**
 * Redirect to the bootstrap tool spec.
 *
 * @param req - Incoming request (used for the base URL).
 * @returns 307 redirect to /api/agent/bootstrap.
 */
export function GET(req: NextRequest) {
  return NextResponse.redirect(`${getAppBaseUrl(req)}/api/agent/bootstrap`, {
    status: 307,
    headers: AGENT_CORS_HEADERS,
  });
}
