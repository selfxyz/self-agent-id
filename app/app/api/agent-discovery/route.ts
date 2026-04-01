// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextResponse } from "next/server";
import { getAgentDiscoveryJSON } from "@/lib/agent-discovery";
import { CORS_HEADERS, corsResponse } from "@/lib/api-helpers";

export function GET() {
  return NextResponse.json(getAgentDiscoveryJSON(), {
    headers: {
      ...CORS_HEADERS,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export function OPTIONS() {
  return corsResponse();
}
