// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const accept = req.headers.get("accept") || "";

  // If the request accepts JSON but not HTML, serve structured agent data
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return NextResponse.rewrite(new URL("/api/agent-discovery", req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/",
};
