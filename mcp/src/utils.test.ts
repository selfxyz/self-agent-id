// SPDX-License-Identifier: MIT

/** Tests for the shared helpers in utils.ts. */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  apiErrorText,
  apiFetch,
  disclosed,
  formatCredentialsSummary,
  parseAddress,
  readTextCapped,
  safeErrorDescription,
  toolError,
  toolSuccess,
} from "./utils.js";

describe("tool results", () => {
  it("builds error and success blocks, writing bigints as strings", () => {
    expect(toolError("nope")).toEqual({
      content: [{ type: "text", text: "nope" }],
      isError: true,
    });
    const big = 2n ** 200n;
    expect(JSON.parse(toolSuccess({ id: big }).content[0].text)).toEqual({
      id: big.toString(),
    });
  });
});

describe("safeErrorDescription", () => {
  it("keeps only the name and an UPPER_CASE code", () => {
    const err = Object.assign(new TypeError("invalid private key 0xsecret"), {
      code: "INVALID_ARGUMENT",
    });
    expect(safeErrorDescription(err)).toBe("TypeError (INVALID_ARGUMENT)");
    expect(safeErrorDescription(new Error("token abc"))).toBe("Error");
    expect(safeErrorDescription("raw string")).toBe("string");
  });
});

describe("parseAddress", () => {
  it("accepts strict, checksum-valid, non-zero addresses", () => {
    expect(parseAddress("0x526e35be30ea29c0ca5dd45263fdc635833947af")).toBe(
      "0x526E35be30ea29c0ca5Dd45263fdc635833947aF",
    );
    for (const bad of [
      undefined,
      "0x1234",
      "526e35be30ea29c0ca5dd45263fdc635833947af",
      "0x526e35be30ea29c0ca5Dd45263fdc635833947aF",
      "0x0000000000000000000000000000000000000000",
    ]) {
      expect(parseAddress(bad)).toBeNull();
    }
  });
});

describe("credentials", () => {
  it("treats NUL-padded, separator-only and UNAVAILABLE values as undisclosed", () => {
    for (const nationality of ["\0\0\0", "\0\0-\0\0-\0\0", "UNAVAILABLE", ""]) {
      expect(disclosed(nationality)).toBeNull();
      expect(
        formatCredentialsSummary({ nationality, olderThan: 18n }, true),
      ).toBe("Verified human, 18+");
    }
    expect(formatCredentialsSummary({ nationality: "GBR\0" }, true)).toBe(
      "Verified human, nationality: GBR",
    );
  });

  it("only calls a fresh proof verified", () => {
    expect(
      formatCredentialsSummary({ olderThan: 21n, ofac: [true] }, true),
    ).toBe("Verified human, 21+, OFAC clear");
    expect(formatCredentialsSummary({ olderThan: 21n }, false)).toBe(
      "Not verified (no fresh human proof)",
    );
    expect(formatCredentialsSummary(undefined, true)).toBe("Verified human");
  });
});

describe("HTTP helpers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads at most maxBytes", async () => {
    expect(await readTextCapped(new Response("abcdef"), 4)).toEqual({
      text: "abcd",
      truncated: true,
    });
    expect(await readTextCapped(new Response(null), 4)).toEqual({
      text: "",
      truncated: false,
    });
  });

  it("calls the API base with a timeout and tolerates non-JSON bodies", async () => {
    const fetchMock = vi.fn(
      async () => new Response("<html>", { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await apiFetch({ apiUrl: "https://api.example" }, "/x", {
      method: "POST",
    });
    expect(fetchMock).toHaveBeenCalledWith("https://api.example/x", {
      method: "POST",
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({ status: 502, ok: false, data: {} });
    expect(apiErrorText(result)).toBe("HTTP 502");
    expect(
      apiErrorText({ status: 400, ok: false, data: { error: "Bad input" } }),
    ).toBe("Bad input");
  });
});
