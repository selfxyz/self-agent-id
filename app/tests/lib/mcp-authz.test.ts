// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for MCP bearer-token auth and privileged-scope checks (lib/mcp/authz). */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCP_PRIVILEGED_SCOPE,
  hasPrivilegedScope,
  verifyMcpBearerToken,
} from "@/lib/mcp/authz";

describe("mcp authz", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns undefined when no bearer token is provided", async () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEY", "secret");
    const result = verifyMcpBearerToken(undefined);
    expect(result).toBeUndefined();
  });

  it("accepts a valid single privileged API key", async () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEY", "secret");
    const result = verifyMcpBearerToken("secret");

    expect(result).toMatchObject({
      token: "secret",
      clientId: "mcp-privileged",
      scopes: [MCP_PRIVILEGED_SCOPE],
    });
  });

  it("accepts a valid API key from MCP_PRIVILEGED_API_KEYS list", async () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEYS", "alpha,beta,gamma");
    const result = verifyMcpBearerToken("beta");

    expect(result?.scopes).toContain(MCP_PRIVILEGED_SCOPE);
  });

  it("treats unknown tokens as anonymous (public tools keep working)", () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEYS", "alpha,beta");
    expect(verifyMcpBearerToken("wrong")).toBeUndefined();
  });

  it("treats bearer tokens as anonymous when privileged auth is not configured", () => {
    vi.stubEnv("MCP_PRIVILEGED_API_KEY", "");
    vi.stubEnv("MCP_PRIVILEGED_API_KEYS", "");
    expect(verifyMcpBearerToken("token")).toBeUndefined();
  });

  it("detects the privileged scope", () => {
    expect(hasPrivilegedScope({ scopes: [MCP_PRIVILEGED_SCOPE] })).toBe(true);
    expect(hasPrivilegedScope({ scopes: [] })).toBe(false);
    expect(hasPrivilegedScope(undefined)).toBe(false);
  });
});
