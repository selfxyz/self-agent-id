// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for encrypted session tokens and QR tokens (lib/session-token). */

import { describe, expect, it } from "vitest";
import {
  encryptSession,
  decryptSession,
  createSessionToken,
  rotateSessionToken,
  createQrToken,
  readQrToken,
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

  it("rejects tokens read with the wrong secret", () => {
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

  it("accepts expired tokens only within an explicit graceMs", () => {
    const token = encryptSession(
      {
        id: "test",
        type: "register",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
      secret,
    );
    expect(decryptSession(token, secret, { graceMs: 120_000 }).id).toBe("test");
    expect(() => decryptSession(token, secret, { graceMs: 30_000 })).toThrow(
      "Session expired",
    );
  });

  it("rejects tokens without a parseable expiresAt (they would never expire)", () => {
    for (const data of [
      { id: "test", type: "register" as const },
      { id: "test", type: "register" as const, expiresAt: "not-a-date" },
    ]) {
      const token = encryptSession(data, secret);
      expect(() => decryptSession(token, secret)).toThrow(
        "Invalid token payload",
      );
    }
  });

  it("createSessionToken returns a decryptable pending-stage token with ID and timestamps", () => {
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

    const decoded = decryptSession(token, secret);
    expect(decoded.id).toBe(data.id);
  });

  it("rotateSessionToken re-encrypts with updated fields and the same ID", () => {
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
    expect(decoded.id).toBe(data.id);
  });
});

describe("QR tokens", () => {
  const secret = "test-secret-key-that-is-32-bytes!";
  const future = new Date(Date.now() + 60_000).toISOString();

  it("round-trips the deep link and expiry", () => {
    const token = createQrToken(
      "https://redirect.self.xyz?x=1",
      future,
      secret,
    );
    expect(readQrToken(token, secret)).toEqual({
      deepLink: "https://redirect.self.xyz?x=1",
      expiresAt: future,
    });
  });

  it("cannot be decrypted as a session token, and vice versa", () => {
    const qrToken = createQrToken("https://x", future, secret);
    expect(() => decryptSession(qrToken, secret)).toThrow();

    const { token: sessionToken } = createSessionToken(
      { type: "register", agentPrivateKey: "0xkey" },
      secret,
    );
    expect(() => readQrToken(sessionToken, secret)).toThrow();
  });

  it("rejects expired QR tokens with 'Session expired'", () => {
    const token = createQrToken(
      "https://x",
      new Date(Date.now() - 1000).toISOString(),
      secret,
    );
    expect(() => readQrToken(token, secret)).toThrow("Session expired");
  });

  it("rejects tampered QR tokens and wrong secrets", () => {
    const token = createQrToken("https://x", future, secret);
    expect(() => readQrToken(token.slice(0, -4) + "AAAA", secret)).toThrow();
    expect(() => readQrToken(token, "another-secret")).toThrow();
  });
});
