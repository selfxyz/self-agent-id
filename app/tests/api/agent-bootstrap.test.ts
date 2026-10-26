// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for GET/OPTIONS /api/agent/bootstrap (the registration OpenAPI spec). */

import { describe, expect, it } from "vitest";
import { GET, OPTIONS } from "@/app/api/agent/bootstrap/route";

describe("GET /api/agent/bootstrap", () => {
  it("returns OpenAPI 3.1.0 JSON with the registration API title", async () => {
    const res = GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("Self Agent ID - Registration API");
  });

  it("documents only the 5 registration paths", async () => {
    const res = GET();
    const body = await res.json();

    const paths = Object.keys(body.paths);
    expect(paths).toHaveLength(5);

    expect(paths).toContain("/api/agent/register");
    expect(paths).toContain("/api/agent/register/status");
    expect(paths).toContain("/api/agent/register/export");
    expect(paths).toContain("/api/agent/register/ed25519-challenge");
    expect(paths).toContain("/api/agent/register/qr");

    expect(paths).not.toContain("/api/agent/deregister");
    expect(paths).not.toContain("/api/agent/verify");
  });

  it("documents the real API: Bearer session tokens, completed stage, scanUrl", async () => {
    const body = await GET().json();
    const text = JSON.stringify(body);

    expect(body.components.securitySchemes.sessionToken).toMatchObject({
      type: "http",
      scheme: "bearer",
    });
    for (const path of [
      "/api/agent/register/status",
      "/api/agent/register/qr",
      "/api/agent/register/export",
    ]) {
      const op = Object.values(body.paths[path])[0] as Record<string, unknown>;
      expect(op.security).toEqual([{ sessionToken: [] }]);
      expect(op.parameters).toBeUndefined(); // no ?token= query parameter
    }
    expect(text).toContain("'completed'");
    expect(text).not.toContain("'registered'");
    expect(text).toContain("scanUrl");
    expect(
      body.paths["/api/agent/register/qr"].get.responses["200"].description,
    ).toMatch(/^deepLink, qrData /);
    expect(text).not.toMatch(/public QR image|self-custody|verified-wallet/);
    expect(
      body.paths["/api/agent/register"].post.requestBody.content[
        "application/json"
      ].schema.properties.mode.enum,
    ).toEqual([
      "linked",
      "wallet-free",
      "ed25519",
      "ed25519-linked",
      "privy",
      "smartwallet",
    ]);
  });

  it("describes status completion, credentials and the SESSION_SECRET 500 accurately", async () => {
    const res = GET();
    const body = await res.json();
    const status = body.paths["/api/agent/register/status"].get;
    expect(status.description).toContain("reset to 30 minutes");
    expect(status.description).not.toContain("extended");
    expect(status.responses["200"].description).toMatch(
      /credentials are included only on the poll that first observes completion/,
    );
    for (const path of [
      "/api/agent/register",
      "/api/agent/register/status",
      "/api/agent/register/export",
      "/api/agent/register/qr",
    ]) {
      const op = body.paths[path].post ?? body.paths[path].get;
      expect(op.responses["500"].description).toContain("SESSION_SECRET");
    }
  });

  it("sets a 1-hour public Cache-Control header", async () => {
    const res = GET();
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("sets CORS headers", async () => {
    const res = GET();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("answers OPTIONS with 204 and CORS headers", async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
