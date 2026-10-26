// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Edge middleware: send non-API paths to docs.self.xyz.
 *
 * The bare root content-negotiates: JSON clients get agent discovery, plain
 * text clients get llms.txt, browsers get a 308 to the docs. Live machine
 * routes never reach this (see `config.matcher`).
 */

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const DOCS_URL = "https://docs.self.xyz";

/**
 * Find the highest q-value an Accept header gives an exact media type.
 *
 * Wildcard ranges (e.g. text/*) are not matched.
 *
 * @param accept - Raw Accept header.
 * @param type - Lowercase media type, e.g. "application/json".
 * @returns The q-value (1 when no q param), or 0 if the type is absent.
 */
function acceptQ(accept: string, type: string): number {
  let best = 0;
  for (const range of accept.toLowerCase().split(",")) {
    const [media, ...params] = range.split(";").map((s) => s.trim());
    if (media !== type) continue;
    const q = params.find((p) => p.startsWith("q="));
    best = Math.max(best, q ? Number(q.slice(2)) || 0 : 1);
  }
  return best;
}

/**
 * Redirect removed UI pages to the docs and content-negotiate the root.
 *
 * @param req - Incoming request (only paths the matcher lets through).
 * @returns Non-root: 308 to docs. Root: rewrite to /api/agent-discovery when
 *   JSON is preferred, rewrite to /llms.txt when plain text is preferred,
 *   otherwise 308 to docs; root responses carry `Vary: Accept`.
 */
export function middleware(req: NextRequest) {
  // The root and every removed UI page (/agents, /register, /scan/*, /verify,
  // /demo, ...) have no page to serve in this API-only build, so a visitor would
  // otherwise hit a Vercel 404. Live routes (/api, /api/*, /.well-known/*,
  // /agents.json, /llms.txt, /cli/register) are excluded by the matcher below,
  // so they are never redirected.
  if (req.nextUrl.pathname !== "/") {
    return NextResponse.redirect(DOCS_URL, 308);
  }

  // The answer depends on Accept, so every root response varies on it.
  const accept = req.headers.get("accept") || "";
  const html = acceptQ(accept, "text/html");
  const json = acceptQ(accept, "application/json");
  const text = acceptQ(accept, "text/plain");
  let res: NextResponse;
  if (json > html && json >= text) {
    res = NextResponse.rewrite(new URL("/api/agent-discovery", req.url));
  } else if (text > html) {
    res = NextResponse.rewrite(new URL("/llms.txt", req.url));
  } else {
    res = NextResponse.redirect(DOCS_URL, 308);
  }
  res.headers.set("Vary", "Accept");
  return res;
}

/** Next.js middleware config: which paths run the middleware. */
export const config = {
  // Match everything EXCEPT live machine routes and Next internals (each
  // exclusion anchored, so /agents.jsonx or /cli/register/x still redirect).
  // What remains is the root plus the removed UI pages.
  matcher: [
    "/((?!api$|api/|_next/|\\.well-known/|cli/register$|agents\\.json$|llms\\.txt$|favicon\\.ico$).*)",
  ],
};
