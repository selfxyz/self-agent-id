// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { CORS_HEADERS, corsResponse } from "@/lib/api-helpers";

export function OPTIONS() {
  return corsResponse();
}

export function GET(req: NextRequest) {
  const target = new URL("/api/agent/bootstrap", req.url);
  return NextResponse.redirect(target, {
    status: 307,
    headers: CORS_HEADERS,
  });
}
