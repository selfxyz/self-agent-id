// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextResponse } from "next/server";
import { CORS_HEADERS, corsResponse } from "@/lib/api-helpers";

const BASE = process.env.NEXT_PUBLIC_APP_URL || "https://app.ai.self.xyz";

const body = {
  error: "Not found",
  message: "This API endpoint does not exist.",
  discovery: {
    bootstrap: `${BASE}/api/agent/bootstrap`,
    agent_discovery: `${BASE}/api/agent-discovery`,
    a2a: `${BASE}/api/a2a`,
    docs: `${BASE}/api-docs`,
    llms_txt: `${BASE}/llms.txt`,
  },
};

export function OPTIONS() {
  return corsResponse();
}

export function GET() {
  return NextResponse.json(body, { status: 404, headers: CORS_HEADERS });
}

export function POST() {
  return NextResponse.json(body, { status: 404, headers: CORS_HEADERS });
}

export function PUT() {
  return NextResponse.json(body, { status: 404, headers: CORS_HEADERS });
}

export function DELETE() {
  return NextResponse.json(body, { status: 404, headers: CORS_HEADERS });
}

export function PATCH() {
  return NextResponse.json(body, { status: 404, headers: CORS_HEADERS });
}

export function HEAD() {
  return new NextResponse(null, { status: 404, headers: CORS_HEADERS });
}
