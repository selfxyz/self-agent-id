import { afterEach, describe, expect, it, vi } from "vitest";
import { validateAuthenticatedFetchUrl } from "@/lib/mcp/egress";

describe("mcp egress policy", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects invalid URLs", () => {
    const result = validateAuthenticatedFetchUrl("not-a-url");
    expect(result).toEqual({ ok: false, error: "Invalid URL" });
  });

  it("rejects non-http protocols", () => {
    const result = validateAuthenticatedFetchUrl("file:///etc/passwd");
    expect(result).toEqual({
      ok: false,
      error: "Only http:// and https:// URLs are allowed",
    });
  });

  it("blocks localhost/private-network targets by default", () => {
    expect(validateAuthenticatedFetchUrl("http://localhost:3000").ok).toBe(
      false,
    );
    expect(validateAuthenticatedFetchUrl("http://127.0.0.1:3000").ok).toBe(
      false,
    );
    expect(validateAuthenticatedFetchUrl("http://10.1.2.3:8080").ok).toBe(
      false,
    );
  });

  it("allows private-network targets with explicit override", () => {
    vi.stubEnv("MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS", "true");
    const result = validateAuthenticatedFetchUrl("http://127.0.0.1:3000");
    expect(result).toMatchObject({ ok: true });
  });

  it("enforces allowed-host list when configured", () => {
    vi.stubEnv("MCP_AUTH_FETCH_ALLOWED_HOSTS", "api.example.com,*.trusted.dev");

    expect(
      validateAuthenticatedFetchUrl("https://api.example.com/v1/ping"),
    ).toMatchObject({ ok: true });
    expect(
      validateAuthenticatedFetchUrl("https://sub.trusted.dev/health"),
    ).toMatchObject({ ok: true });

    const blocked = validateAuthenticatedFetchUrl("https://evil.example.net");
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.error).toContain('Host "evil.example.net" is not allowed');
    }
  });
});
