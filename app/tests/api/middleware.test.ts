// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for the root middleware: Accept negotiation, UI-page redirects and the route matcher. */

import { describe, expect, it } from "vitest";
import { config, middleware } from "@/middleware";
import { makeNextRequest } from "./test-utils";

/**
 * Run the middleware on a request for the bare root URL.
 *
 * @param accept - Accept header to send; omitted when undefined.
 * @returns The middleware response.
 */
function root(accept?: string) {
  return middleware(
    makeNextRequest("https://agent-api.self.xyz/", {
      headers: accept === undefined ? {} : { accept },
    }),
  );
}

/**
 * Read the internal rewrite target the middleware set.
 *
 * @param res - Middleware response.
 * @returns The rewrite URL, or null when the request was not rewritten.
 */
const rewriteTarget = (res: Response) =>
  res.headers.get("x-middleware-rewrite");

describe("root content negotiation", () => {
  it("rewrites JSON clients to discovery, case-insensitively", () => {
    for (const accept of [
      "application/json",
      "APPLICATION/JSON",
      "text/html;q=0.1, application/json",
    ]) {
      const res = root(accept);
      expect(rewriteTarget(res), accept).toBe(
        "https://agent-api.self.xyz/api/agent-discovery",
      );
      expect(res.headers.get("vary")).toBe("Accept");
    }
  });

  it("rewrites plain-text clients to llms.txt", () => {
    const res = root("Text/Plain");
    expect(rewriteTarget(res)).toBe("https://agent-api.self.xyz/llms.txt");
    expect(res.headers.get("vary")).toBe("Accept");
  });

  it("redirects browsers and wildcard clients to the docs, varying on Accept", () => {
    for (const accept of [
      undefined,
      "*/*",
      "text/html,application/xhtml+xml,application/json;q=0.9",
      "text/html, application/json",
      "application/json;q=0",
    ]) {
      const res = root(accept);
      expect(res.status, String(accept)).toBe(308);
      expect(res.headers.get("location")).toBe("https://docs.self.xyz/");
      expect(res.headers.get("vary")).toBe("Accept");
    }
  });

  it("redirects removed UI pages without negotiating", () => {
    const res = middleware(
      makeNextRequest("https://agent-api.self.xyz/register", {
        headers: { accept: "application/json" },
      }),
    );
    expect(res.status).toBe(308);
    expect(res.headers.get("vary")).toBeNull();
  });
});

describe("matcher", () => {
  /**
   * Check whether the middleware matcher runs on a path.
   *
   * @param path - Request pathname.
   * @returns True when any matcher pattern matches the whole path.
   */
  const matches = (path: string) =>
    config.matcher.some((m) => new RegExp(`^${m}$`).test(path));

  it("skips exactly the live routes", () => {
    for (const path of [
      "/api",
      "/api/a2a",
      "/api/agent/info/42220/1",
      "/_next/static/x.js",
      "/.well-known/agent-card.json",
      "/cli/register",
      "/agents.json",
      "/llms.txt",
      "/favicon.ico",
    ]) {
      expect(matches(path), path).toBe(false);
    }
  });

  it("still redirects look-alikes of live routes", () => {
    for (const path of [
      "/",
      "/agents.jsonx",
      "/llms.txtx",
      "/cli/register/x",
      "/apix",
      "/register",
    ]) {
      expect(matches(path), path).toBe(true);
    }
  });
});
