// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextResponse } from "next/server";
import { CORS_HEADERS, corsResponse } from "@/lib/api-helpers";

export function OPTIONS() {
  return corsResponse();
}

export function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "self-agent-id",
      timestamp: new Date().toISOString(),
    },
    {
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "no-cache, no-store",
      },
    },
  );
}
