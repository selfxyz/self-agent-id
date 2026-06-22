// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const DOCS_URL = "https://docs.self.xyz";

export function middleware(req: NextRequest) {
  const accept = req.headers.get("accept") || "";

  // On the bare root only, machine clients negotiate structured discovery
  // instead of the docs redirect. Checked before the redirect so automated
  // clients (CLI/SDK) still get discovery.
  if (req.nextUrl.pathname === "/") {
    if (accept.includes("application/json") && !accept.includes("text/html")) {
      return NextResponse.rewrite(new URL("/api/agent-discovery", req.url));
    }
    if (accept.includes("text/plain") && !accept.includes("text/html")) {
      return NextResponse.rewrite(new URL("/llms.txt", req.url));
    }
  }

  // The root and every removed UI page (/agents, /register, /scan/*, /verify,
  // /demo, ...) have no page to serve in this API-only build, so a visitor would
  // otherwise hit a Vercel 404. Send them to the docs instead. Live routes
  // (/api/*, /.well-known/*, /agents.json, /llms.txt, /cli/register) are excluded
  // by the matcher below, so they are never redirected.
  return NextResponse.redirect(DOCS_URL, 308);
}

export const config = {
  // Match everything EXCEPT live machine routes and Next internals. What remains
  // is the root plus the removed UI pages, all of which redirect to the docs.
  matcher: [
    "/((?!api/|_next/|\\.well-known/|cli/register|agents\\.json|llms\\.txt|favicon\\.ico).*)",
  ],
};
