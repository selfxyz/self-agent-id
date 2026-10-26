// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for the discovery content (llms.txt, discovery JSON, agent card) and the /.well-known, agents.json and catch-all routes. */

import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonBody, makeNextRequest } from "./test-utils";
import {
  getAgentCardJSON,
  getAgentDiscoveryJSON,
  getAgentDiscoveryText,
} from "@/lib/agent-discovery";

const CANONICAL_MODES = [
  "linked",
  "wallet-free",
  "ed25519",
  "ed25519-linked",
  "privy",
  "smartwallet",
];

/**
 * Check that an app route file exists for a documented URL path.
 *
 * Any dynamic directory (`[x]`, `[...x]`) matches a `:param` segment; the query string is ignored.
 *
 * @param urlPath - Documented path such as `/api/agent/info/:chainId/:agentId`.
 * @returns True when a matching route.ts exists under app/.
 */
function routeExists(urlPath: string): boolean {
  let dirs = [path.resolve(__dirname, "../../app")];
  for (const seg of urlPath.split("?")[0].split("/").filter(Boolean)) {
    dirs = dirs.flatMap((dir) =>
      fs
        .readdirSync(dir, { withFileTypes: true })
        .filter(
          (e) =>
            e.isDirectory() &&
            (seg.startsWith(":") ? e.name.startsWith("[") : e.name === seg),
        )
        .map((e) => path.join(dir, e.name)),
    );
  }
  return dirs.some((d) => fs.existsSync(path.join(d, "route.ts")));
}

describe("discovery content", () => {
  const text = getAgentDiscoveryText();
  const json = getAgentDiscoveryJSON();

  it("uses canonical mode names and lists the published aliases", () => {
    expect(Object.keys(json.registrationModes).sort()).toEqual(
      [...CANONICAL_MODES].sort(),
    );
    expect(json.modeAliases).toEqual({
      walletfree: "wallet-free",
      "smart-wallet": "smartwallet",
    });
    expect(text).not.toMatch(/"mode":\s*"walletfree"/);
    expect(json.modeDecisionTree).not.toContain("walletfree");
  });

  it("documents Bearer-only sessions and the real request fields", () => {
    expect(text).not.toMatch(/[?&](sessionToken|token)=/);
    expect(text).toContain("Authorization: Bearer <sessionToken>");
    expect(text).toContain('"pubkey":"<64-hex-pubkey>"');
    expect(text).toContain('"ed25519Pubkey":"<64-hex-pubkey>"');
    expect(text).not.toMatch(/ed25519PublicKey|challengeId|base64-encoded/);
  });

  it("describes the real request-signing scheme", () => {
    expect(text).not.toMatch(/HMAC|ISO 8601 timestamp/);
    expect(text).toContain("Unix time in milliseconds");
    expect(text).toContain("EIP-191");
    expect(text).toContain("keccak256");
  });

  it("lists no deleted or invented endpoints", () => {
    const all = `${text}\n${JSON.stringify(json)}`;
    expect(all).not.toMatch(/\/api\/aa\/|\/callback|icon\.png|api-docs/);
    expect(text).not.toMatch(
      /x-self-agent-signature, x-self-agent-timestamp\n/,
    );
    for (const endpoint of json.apiEndpoints) {
      expect(routeExists(endpoint.path), endpoint.path).toBe(true);
    }
  });

  it("lists every live public route", () => {
    const listed = new Set(
      json.apiEndpoints.map((e) =>
        e.path.split("?")[0].replace(/:[A-Za-z]+/g, ":"),
      ),
    );
    const appDir = path.resolve(__dirname, "../../app");
    const routes = fs
      .readdirSync(appDir, { recursive: true, encoding: "utf8" })
      .filter((f) => f.endsWith(`${path.sep}route.ts`))
      .map(
        (f) =>
          "/" +
          path
            .dirname(f)
            .split(path.sep)
            .map((seg) => (seg.startsWith("[") ? ":" : seg))
            .join("/"),
      )
      // The JSON 404 catch-alls.
      .filter((r) => !r.startsWith("/api/:") && r !== "/.well-known/:");
    for (const route of routes) expect(listed, route).toContain(route);
  });

  it("documents A2A polling by sessionToken and the visa write protocol", () => {
    expect(text).toContain(
      '{"intent":"status","sessionToken":"<sessionToken>"}',
    );
    expect(text).not.toMatch(/"intent":\s*"status",\s*"taskId"/);
    expect(JSON.stringify(getAgentCardJSON())).not.toContain("taskId");
    expect(text).toContain("Self Agent ID visa request\naction: <claim");
    expect(text).toContain("within 5 minutes");
    expect(text).toContain("2 per signer");
  });

  it("lists the public query routes", () => {
    const paths = json.apiEndpoints.map((e) => e.path);
    for (const p of [
      "/api/agent/info/:chainId/:agentId",
      "/api/agent/verify/:chainId/:agentId",
      "/api/agent/agents/:chainId/:address",
      "/api/agent/agents-by-nullifier/:chainId/:nullifier",
      "/api/cards/:chainId/:agentId",
      "/api/reputation/:chainId/:agentId",
      "/api/verify-status/:chainId/:agentId",
    ]) {
      expect(paths).toContain(p);
    }
  });

  it("builds a registry agent card with no icon and no push notifications", () => {
    const card = getAgentCardJSON();
    expect(card).not.toHaveProperty("image");
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.capabilities.pushNotifications).toBe(false);
    expect(card.documentationUrl).toBe("https://docs.self.xyz/agent-id");
  });
});

describe("discovery routes", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllEnvs());

  it("serves llms.txt and discovery JSON with Vary: Accept", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agent-api.self.xyz");
    const req = makeNextRequest("https://evil.example/llms.txt");
    const llms = await import("@/app/llms.txt/route");
    const res = llms.GET(req);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(res.headers.get("vary")).toBe("Accept");
    const body = await res.text();
    expect(body).toContain("https://agent-api.self.xyz/api/a2a");
    expect(body).not.toContain("evil.example");
    const discovery = await import("@/app/api/agent-discovery/route");
    expect(discovery.GET(req).headers.get("vary")).toBe("Accept");
  });

  it("/.well-known/self-agent-id.json serves the discovery JSON", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agent-api.self.xyz");
    const { GET } = await import("@/app/.well-known/self-agent-id.json/route");
    const res = GET(
      makeNextRequest("https://evil.example/.well-known/self-agent-id.json"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await jsonBody<{ service: { url: string } }>(res);
    expect(body.service.url).toBe("https://agent-api.self.xyz");
  });

  it("/.well-known/agent-registration redirects to the bootstrap spec on the configured host", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agent-api.self.xyz");
    const { GET } = await import("@/app/.well-known/agent-registration/route");
    const res = GET(
      makeNextRequest("https://evil.example/.well-known/agent-registration"),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://agent-api.self.xyz/api/agent/bootstrap",
    );
  });

  it("agents.json links to the configured host", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agent-api.self.xyz");
    const { GET } = await import("@/app/agents.json/route");
    const body = await jsonBody<Record<string, string>>(
      GET(makeNextRequest("https://evil.example/agents.json")),
    );
    expect(body.a2a).toBe("https://agent-api.self.xyz/api/a2a");
    expect(JSON.stringify(body)).not.toContain("evil.example");
  });

  it("returns the shared JSON 404 for unknown /.well-known/* paths", async () => {
    const { GET } = await import("@/app/.well-known/[...path]/route");
    const res = GET(makeNextRequest("https://x/.well-known/nope"));
    expect(res.status).toBe(404);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await jsonBody<{ error: string }>(res)).toMatchObject({
      error: "Not found",
    });
  });

  it("answers unknown /api paths (including bare /api) with a JSON 404 and the docs URL", async () => {
    // Optional catch-all, so the bare /api prefix is covered too.
    expect(
      fs.existsSync(
        path.resolve(__dirname, "../../app/api/[[...catchall]]/route.ts"),
      ),
    ).toBe(true);
    const { GET } = await import("@/app/api/[[...catchall]]/route");
    const res = GET(makeNextRequest("https://x/api/nope"));
    expect(res.status).toBe(404);
    const body = await jsonBody<{ discovery: { docs: string } }>(res);
    expect(body.discovery.docs).toBe("https://docs.self.xyz/agent-id");
  });

  it("caches the registry agent card but not agent-card.json errors", async () => {
    const { GET } = await import("@/app/.well-known/agent-card.json/route");
    const ok = await GET(
      makeNextRequest("https://x/.well-known/agent-card.json"),
    );
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("public, max-age=60");
    for (const q of [
      "agentId=abc",
      "agentId=0x1",
      "agentId=1&chainId=constructor",
    ]) {
      const bad = await GET(
        makeNextRequest(`https://x/.well-known/agent-card.json?${q}`),
      );
      expect(bad.status, q).toBe(400);
      expect(bad.headers.get("cache-control"), q).toBeNull();
    }
  });

  it("/.well-known/a2a/:id redirects to the chain-specific card on the configured host", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://agent-api.self.xyz");
    const { GET } = await import("@/app/.well-known/a2a/[agentId]/route");
    const res = await GET(
      makeNextRequest("https://evil.example/.well-known/a2a/5?chain=11142220"),
      { params: Promise.resolve({ agentId: "5" }) },
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "https://agent-api.self.xyz/api/cards/11142220/5",
    );
    const bad = await GET(makeNextRequest("https://x/.well-known/a2a/01"), {
      params: Promise.resolve({ agentId: "01" }),
    });
    expect(bad.status).toBe(400);
  });
});
