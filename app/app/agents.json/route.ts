// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextResponse } from "next/server";
import { CORS_HEADERS, corsResponse } from "@/lib/api-helpers";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://app.ai.self.xyz";

export function OPTIONS() {
  return corsResponse();
}

export function GET() {
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
        ...CORS_HEADERS,
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
