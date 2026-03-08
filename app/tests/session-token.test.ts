// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { describe, expect, it } from "vitest";
import {
  encryptSession,
  decryptSession,
  createSessionToken,
  rotateSessionToken,
} from "../lib/session-token";

describe("session token encryption", () => {
  const secret = "test-secret-key-that-is-32-bytes!";

  it("round-trips session data", () => {
    const data = {
      id: "test-123",
      type: "register" as const,
      mode: "linked",
      stage: "qr-ready",
      network: "testnet",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    const token = encryptSession(data, secret);
    const decoded = decryptSession(token, secret);
    expect(decoded).toEqual(data);
  });

  it("produces URL-safe tokens (no +, /, =)", () => {
    const data = { id: "test", type: "register" as const };
    const token = encryptSession(data, secret);
    expect(token.includes("+")).toBe(false);
    expect(token.includes("/")).toBe(false);
    expect(token.includes("=")).toBe(false);
  });

  it("rejects tampered tokens", () => {
    const data = { id: "test", type: "register" as const };
    const token = encryptSession(data, secret);
    const tampered = token.slice(0, -4) + "AAAA";
    expect(() => decryptSession(tampered, secret)).toThrow();
  });

  it("rejects wrong secret", () => {
    const data = { id: "test", type: "register" as const };
    const token = encryptSession(data, secret);
    expect(() =>
      decryptSession(token, "wrong-secret-key-that-is-32byte"),
    ).toThrow();
  });

  it("rejects expired tokens", () => {
    const data = {
      id: "test",
      type: "register" as const,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const token = encryptSession(data, secret);
    expect(() => decryptSession(token, secret)).toThrow(/expired/i);
  });

  it("allows tokens without expiresAt", () => {
    const data = { id: "test", type: "register" as const };
    const token = encryptSession(data, secret);
    const decoded = decryptSession(token, secret);
    expect(decoded.id).toBe("test");
  });

  it("createSessionToken generates valid token with ID and timestamps", () => {
    const { token, data } = createSessionToken(
      {
        type: "register",
        mode: "linked",
        network: "testnet",
      },
      secret,
    );
    expect(token.length).toBeGreaterThan(0);
    expect(data.id.length).toBeGreaterThan(0);
    expect(data.createdAt).toBeTruthy();
    expect(data.expiresAt).toBeTruthy();
    expect(data.stage).toBe("pending");

    // Should decrypt successfully
    const decoded = decryptSession(token, secret);
    expect(decoded.id).toBe(data.id);
  });

  it("rotateSessionToken updates fields and re-encrypts", () => {
    const { data } = createSessionToken(
      {
        type: "register",
        network: "testnet",
      },
      secret,
    );

    const newToken = rotateSessionToken(
      data,
      { stage: "completed", agentId: 42 },
      secret,
    );
    const decoded = decryptSession(newToken, secret);
    expect(decoded.stage).toBe("completed");
    expect(decoded.agentId).toBe(42);
    expect(decoded.id).toBe(data.id); // ID preserved
  });
});
