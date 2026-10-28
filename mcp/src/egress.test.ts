// SPDX-License-Identifier: MIT

/** Tests for the authenticated-fetch egress policy (egress.ts). */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

const { validateAuthenticatedFetchUrl } = await import("./egress.js");

const PUBLIC_IP = [{ address: "93.184.216.34", family: 4 }];

describe("mcp egress policy", () => {
  beforeEach(() => {
    lookupMock.mockReset();
    lookupMock.mockResolvedValue(PUBLIC_IP);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects invalid URLs and non-http protocols", async () => {
    await expect(validateAuthenticatedFetchUrl("not-a-url")).resolves.toEqual({
      ok: false,
      error: "Invalid URL",
    });
    await expect(
      validateAuthenticatedFetchUrl("file:///etc/passwd"),
    ).resolves.toEqual({
      ok: false,
      error: "Only http:// and https:// URLs are allowed",
    });
  });

  it.each([
    // IPv4 literals in any URL-parser spelling
    "http://127.0.0.1:3000",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://10.1.2.3:8080",
    "http://0.0.0.0/",
    "http://169.254.169.254/latest/meta-data/",
    // Shared, benchmarking, multicast and broadcast ranges
    "http://100.64.0.1/",
    "http://198.18.0.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
    // IPv6 literals keep brackets in URL.hostname
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:169.254.169.254]/",
    "http://[fd00:ec2::254]/",
    "http://[fe80::1]/",
    "http://[64:ff9b::7f00:1]/",
    "http://[fec0::1]/",
    "http://[ff02::1]/",
    // Names: trailing dots, single labels, reserved suffixes
    "http://localhost:3000/health",
    "http://localhost./",
    "http://metadata/",
    "http://metadata.google.internal./",
    "http://foo.localhost/",
  ])("blocks %s without DNS", async (url) => {
    const result = await validateAuthenticatedFetchUrl(url);
    expect(result.ok).toBe(false);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("blocks hostnames that resolve to private addresses", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    const nip = await validateAuthenticatedFetchUrl("http://127.0.0.1.nip.io/");
    expect(nip.ok).toBe(false);
    expect(lookupMock).toHaveBeenCalledWith("127.0.0.1.nip.io", {
      all: true,
      verbatim: true,
    });

    // Any private address among several records is enough to block.
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "::1", family: 6 },
    ]);
    expect(
      (await validateAuthenticatedFetchUrl("http://localtest.me/")).ok,
    ).toBe(false);
  });

  it("blocks hostnames that do not resolve", async () => {
    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    const result = await validateAuthenticatedFetchUrl("https://nope.example/");
    expect(result).toEqual({
      ok: false,
      error: 'Host "nope.example" could not be resolved',
    });
  });

  it("allows public hosts and IPs", async () => {
    await expect(
      validateAuthenticatedFetchUrl("https://example.com/"),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      validateAuthenticatedFetchUrl("http://[2606:4700::1111]/"),
    ).resolves.toMatchObject({ ok: true });
  });

  it("allows private-network targets with explicit override", async () => {
    vi.stubEnv("MCP_AUTH_FETCH_ALLOW_PRIVATE_NETWORKS", "true");
    await expect(
      validateAuthenticatedFetchUrl("http://127.0.0.1:3000"),
    ).resolves.toMatchObject({ ok: true });
  });

  it("enforces allowed-host list when configured", async () => {
    vi.stubEnv("MCP_AUTH_FETCH_ALLOWED_HOSTS", "api.example.com,*.trusted.dev");

    await expect(
      validateAuthenticatedFetchUrl("https://api.example.com./v1/ping"),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      validateAuthenticatedFetchUrl("https://sub.trusted.dev/health"),
    ).resolves.toMatchObject({ ok: true });

    const blocked = await validateAuthenticatedFetchUrl(
      "https://evil.example.net",
    );
    expect(blocked).toEqual({
      ok: false,
      error:
        'Host "evil.example.net" is not allowed. Add it to MCP_AUTH_FETCH_ALLOWED_HOSTS.',
    });

    // An allowlisted name must still resolve to a public address.
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    expect(
      (await validateAuthenticatedFetchUrl("https://api.example.com/")).ok,
    ).toBe(false);
  });
});
