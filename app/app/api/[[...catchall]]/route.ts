// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * ANY /api and /api/* (unknown paths) — JSON 404 pointing at discovery.
 *
 * Auth: none. Rate limit: none.
 * Optional catch-all, so the bare /api prefix is covered too. Also re-exported
 * by /.well-known/[...path].
 */

import { type NextRequest, NextResponse } from "next/server";
import {
  AGENT_CORS_HEADERS,
  corsResponse,
  getAppBaseUrl,
} from "@/lib/agent-api-helpers";

/**
 * Build the JSON 404 with links to the discovery entry points.
 *
 * @param req - Incoming request (used for the base URL).
 * @returns 404 {error, message, discovery: {bootstrap, agent_discovery, a2a,
 *   docs, llms_txt}}.
 */
function notFound(req: NextRequest) {
  const base = getAppBaseUrl(req);
  return NextResponse.json(
    {
      error: "Not found",
      message: "This API endpoint does not exist.",
      discovery: {
        bootstrap: `${base}/api/agent/bootstrap`,
        agent_discovery: `${base}/api/agent-discovery`,
        a2a: `${base}/api/a2a`,
        docs: "https://docs.self.xyz/agent-id",
        llms_txt: `${base}/llms.txt`,
      },
    },
    { status: 404, headers: AGENT_CORS_HEADERS },
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

/** GET, POST, PUT, DELETE and PATCH all answer with the JSON 404. */
export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const DELETE = notFound;
export const PATCH = notFound;

/**
 * Answer HEAD with a bodiless 404.
 *
 * @returns 404 with CORS headers and no body.
 */
export function HEAD() {
  return new NextResponse(null, { status: 404, headers: AGENT_CORS_HEADERS });
}
