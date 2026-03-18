import { describe, expect, it } from "vitest";
import { GET, OPTIONS } from "@/app/api/agent/bootstrap/route";

describe("GET /api/agent/bootstrap", () => {
  it("returns valid OpenAPI 3.1.0 JSON with correct title", async () => {
    const res = GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("Self Agent ID - Registration API");
  });

  it("includes only the 5 registration-relevant paths", async () => {
    const res = GET();
    const body = await res.json();

    const paths = Object.keys(body.paths);
    expect(paths).toHaveLength(5);

    expect(paths).toContain("/api/agent/register");
    expect(paths).toContain("/api/agent/register/status");
    expect(paths).toContain("/api/agent/register/export");
    expect(paths).toContain("/api/agent/register/ed25519-challenge");
    expect(paths).toContain("/api/agent/register/qr");

    // Should NOT include non-registration paths
    expect(paths).not.toContain("/api/agent/deregister");
    expect(paths).not.toContain("/api/agent/verify");
  });

  it("sets Cache-Control header", async () => {
    const res = GET();
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("sets CORS headers", async () => {
    const res = GET();
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("OPTIONS returns 204 with CORS headers", async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
  });
});
