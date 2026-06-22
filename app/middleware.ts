// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const DOCS_URL = "https://docs.self.xyz";

export function middleware(req: NextRequest) {
  const accept = req.headers.get("accept") || "";

  // If the request accepts JSON but not HTML, serve structured agent data.
  // Checked before the docs redirect so automated clients (CLI/SDK) still get
  // discovery, not a redirect.
  if (accept.includes("application/json") && !accept.includes("text/html")) {
    return NextResponse.rewrite(new URL("/api/agent-discovery", req.url));
  }

  // If the request accepts plain text but not HTML, serve LLM-readable discovery
  if (accept.includes("text/plain") && !accept.includes("text/html")) {
    return NextResponse.rewrite(new URL("/llms.txt", req.url));
  }

  // A human browser (HTML) landing on the bare root has no page to serve here.
  // Send them to the docs instead of a 404, on every domain. This only applies
  // to "/" (see matcher) — API endpoints under /api/* are never affected.
  return NextResponse.redirect(DOCS_URL, 308);
}

export const config = {
  // Only the root needs middleware: API paths (/api/*) are served in place on
  // every domain by the same deployment, so they need no rewrite or redirect.
  matcher: "/",
};
