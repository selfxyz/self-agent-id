// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /agents.json — link index of the machine-readable entry points.
 *
 * Auth: none. Rate limit: none.
 * Returns links (registration, discovery, a2a, llms.txt, agent card,
 * well-known), not a list of agents. Cacheable for 1 h.
 */

import { type NextRequest, NextResponse } from "next/server";
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
 * Serve the link index.
 *
 * @param req - Incoming request (used for the base URL).
 * @returns 200 {name, description, registration, discovery, a2a, llms_txt,
 *   agent_card, well_known}.
 */
export function GET(req: NextRequest) {
  const BASE = getAppBaseUrl(req);
  return NextResponse.json(
    {
      name: "Self Agent ID",
      description:
        "On-chain AI agent identity registry with proof-of-human verification",
      registration: `${BASE}/api/agent/bootstrap`,
      discovery: `${BASE}/api/agent-discovery`,
      a2a: `${BASE}/api/a2a`,
      llms_txt: `${BASE}/llms.txt`,
      agent_card: `${BASE}/.well-known/agent-card.json`,
      well_known: `${BASE}/.well-known/self-agent-id.json`,
    },
    {
      headers: {
        ...AGENT_CORS_HEADERS,
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
