// SPDX-License-Identifier: MIT

/** Tests for the sign-request and authenticated-fetch tools. */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testConfig, textOf } from "../test/helpers.js";
import { NO_AGENT_KEY_ERROR } from "../utils.js";

const fetchMock = vi.fn();
const signRequestMock = vi.fn();
// A `function` (not an arrow) so the handler can call it with `new`.
const selfAgentCtorMock = vi.fn(function () {
  return { fetch: fetchMock, signRequest: signRequestMock };
});
const lookupMock = vi.fn();

vi.mock("@selfxyz/agent-sdk", () => ({ SelfAgent: selfAgentCtorMock }));
vi.mock("node:dns/promises", () => ({ lookup: lookupMock }));

const { handleAuthenticatedFetch, handleSignRequest } =
  await import("./auth.js");

const baseConfig = { ...testConfig, privateKey: "0xabc123" };

/**
 * Build a redirect response for the mocked SDK fetch.
 *
 * @param location - Value of the Location header.
 * @param status - Redirect status code (default 302).
 * @returns A body-less Response.
 */
function redirect(location: string, status = 302) {
  return new Response(null, { status, headers: { location } });
}

/**
 * Build authenticated-fetch tool args for a JSON GET.
 *
 * @param url - Target URL.
 * @returns Tool args for handleAuthenticatedFetch.
 */
const get = (url: string) => ({
  method: "GET" as const,
  url,
  content_type: "application/json",
});

describe("self_sign_request", () => {
  beforeEach(() => signRequestMock.mockReset());

  it("points at the registration flow when no agent key is configured", async () => {
    const result = textOf(
      await handleSignRequest(
        { method: "GET", url: "https://example.com" },
        testConfig,
      ),
    );
    expect(result).toMatchObject({ isError: true, text: NO_AGENT_KEY_ERROR });
    expect(result.text).toContain("reveal_private_key=true");
  });

  it("signs with the configured key and network", async () => {
    signRequestMock.mockResolvedValue({ "x-self-agent-signature": "0xsig" });
    const result = textOf(
      await handleSignRequest(
        { method: "POST", url: "https://example.com/a", body: "{}" },
        baseConfig,
      ),
    );
    expect(selfAgentCtorMock).toHaveBeenLastCalledWith({
      privateKey: "0xabc123",
      network: "testnet",
      rpcUrl: "https://custom-rpc.example",
    });
    expect(signRequestMock).toHaveBeenCalledWith(
      "POST",
      "https://example.com/a",
      "{}",
    );
    expect(result.json.headers).toEqual({ "x-self-agent-signature": "0xsig" });
  });

  it("does not echo or log signing errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    signRequestMock.mockRejectedValueOnce(new Error("bad key 0xabc123"));
    const result = textOf(
      await handleSignRequest(
        { method: "GET", url: "https://example.com" },
        baseConfig,
      ),
    );

    expect(result.text).toBe("Failed to sign request");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("abc123");
    errorSpy.mockRestore();
  });
});

describe("self_authenticated_fetch", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("needs an agent key", async () => {
    expect(
      textOf(
        await handleAuthenticatedFetch(get("https://x.example"), testConfig),
      ).text,
    ).toBe(NO_AGENT_KEY_ERROR);
  });

  it("blocks localhost by default", async () => {
    const result = await handleAuthenticatedFetch(
      get("http://localhost:3000/health"),
      baseConfig,
    );
    expect(textOf(result).text).toContain("Authenticated fetch blocked");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces the allowed-host list", async () => {
    vi.stubEnv("MCP_AUTH_FETCH_ALLOWED_HOSTS", "api.example.com");
    const result = await handleAuthenticatedFetch(
      get("https://not-allowed.example.com/ping"),
      baseConfig,
    );
    expect(textOf(result).text).toContain("not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends signed requests with manual redirects and a timeout", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const result = await handleAuthenticatedFetch(
      {
        method: "POST",
        url: "https://api.example.com/v1/chat",
        body: '{"q":"hello"}',
        content_type: "application/json",
      },
      baseConfig,
    );

    expect(fetchMock).toHaveBeenCalledWith("https://api.example.com/v1/chat", {
      method: "POST",
      body: '{"q":"hello"}',
      headers: { "Content-Type": "application/json" },
      redirect: "manual",
      signal: expect.any(AbortSignal),
    });
    expect(textOf(result).json).toEqual({
      status: 200,
      url: "https://api.example.com/v1/chat",
      body: "ok",
      truncated: false,
    });
  });

  it("does not follow a redirect into a private network", async () => {
    fetchMock.mockResolvedValueOnce(
      redirect("http://127.0.0.1:39123/internal"),
    );
    const result = await handleAuthenticatedFetch(
      get("https://httpbin.example/redirect-to"),
      baseConfig,
    );
    expect(textOf(result).text).toContain("Authenticated fetch blocked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-validates and re-signs each redirect hop; 303 drops body and Content-Type", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("/next", 303))
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    const result = await handleAuthenticatedFetch(
      {
        method: "POST",
        url: "https://api.example.com/start",
        body: "x",
        content_type: "text/plain",
      },
      baseConfig,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      headers: { "Content-Type": "text/plain" },
    });
    expect(fetchMock.mock.calls[1]).toEqual([
      "https://api.example.com/next",
      expect.objectContaining({ method: "GET", body: undefined, headers: {} }),
    ]);
    expect(lookupMock).toHaveBeenCalledTimes(2);
    expect(textOf(result).json).toMatchObject({
      status: 200,
      url: "https://api.example.com/next",
    });
  });

  it("turns a 302 after POST into a body-less GET", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("/found", 302))
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    await handleAuthenticatedFetch(
      {
        method: "POST",
        url: "https://api.example.com/start",
        body: "x",
        content_type: "text/plain",
      },
      baseConfig,
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "GET",
      body: undefined,
      headers: {},
    });
  });

  it("keeps the body and Content-Type on a method-preserving 307", async () => {
    fetchMock
      .mockResolvedValueOnce(redirect("/moved", 307))
      .mockResolvedValueOnce(new Response("done", { status: 200 }));
    await handleAuthenticatedFetch(
      {
        method: "POST",
        url: "https://api.example.com/start",
        body: "x",
        content_type: "text/plain",
      },
      baseConfig,
    );
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "POST",
      body: "x",
      headers: { "Content-Type": "text/plain" },
    });
  });

  it("returns a tool error (not a throw) for a malformed agent key", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    selfAgentCtorMock.mockImplementationOnce(() => {
      throw new Error("invalid private key 0xnot-a-key");
    });
    const result = await handleAuthenticatedFetch(
      get("https://api.example.com/x"),
      { ...baseConfig, privateKey: "0xnot-a-key" },
    );
    expect(textOf(result)).toMatchObject({
      isError: true,
      text: "Authenticated fetch failed: invalid agent key",
    });
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("not-a-key");
    expect(fetchMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("stops after 3 redirects", async () => {
    fetchMock.mockImplementation(async () => redirect("/again"));
    const result = await handleAuthenticatedFetch(
      get("https://api.example.com/loop"),
      baseConfig,
    );
    expect(textOf(result).text).toContain("more than 3 redirects");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("caps the response body at 10 KiB", async () => {
    fetchMock.mockResolvedValue(new Response("a".repeat(50_000)));
    const payload = textOf(
      await handleAuthenticatedFetch(
        get("https://api.example.com/big"),
        baseConfig,
      ),
    ).json;
    expect(payload.truncated).toBe(true);
    expect(payload.body).toHaveLength(10 * 1024);
  });

  it("reports timeouts and does not echo network error details", async () => {
    fetchMock.mockRejectedValueOnce(
      Object.assign(new Error("aborted"), { name: "TimeoutError" }),
    );
    expect(
      textOf(
        await handleAuthenticatedFetch(
          get("https://api.example.com/x"),
          baseConfig,
        ),
      ).text,
    ).toBe("Authenticated fetch failed: request timed out");

    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:22"));
    expect(
      textOf(
        await handleAuthenticatedFetch(
          get("https://api.example.com/x"),
          baseConfig,
        ),
      ).text,
    ).toBe("Authenticated fetch failed: network error");
  });
});
