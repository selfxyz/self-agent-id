// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { encryptSession, decryptSession, createSessionToken, rotateSessionToken } from "../session-token";

describe("session token encryption", () => {
  const secret = "test-secret-key-that-is-32-bytes!";

  it("round-trips session data", () => {
    const data = {
      id: "test-123",
      type: "register" as const,
      mode: "agent-identity",
      stage: "qr-ready",
      network: "testnet",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
    const token = encryptSession(data, secret);
    const decoded = decryptSession(token, secret);
    assert.deepStrictEqual(decoded, data);
  });

  it("produces URL-safe tokens (no +, /, =)", () => {
    const data = { id: "test", type: "register" as const };
    const token = encryptSession(data, secret);
    assert.ok(!token.includes("+"), "no + in token");
    assert.ok(!token.includes("/"), "no / in token");
    assert.ok(!token.includes("="), "no = in token");
  });

  it("rejects tampered tokens", () => {
    const data = { id: "test", type: "register" as const };
    const token = encryptSession(data, secret);
    const tampered = token.slice(0, -4) + "AAAA";
    assert.throws(() => decryptSession(tampered, secret));
  });

  it("rejects wrong secret", () => {
    const data = { id: "test", type: "register" as const };
    const token = encryptSession(data, secret);
    assert.throws(() => decryptSession(token, "wrong-secret-key-that-is-32byte"));
  });

  it("rejects expired tokens", () => {
    const data = {
      id: "test",
      type: "register" as const,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    };
    const token = encryptSession(data, secret);
    assert.throws(
      () => decryptSession(token, secret),
      /expired/i
    );
  });

  it("allows tokens without expiresAt", () => {
    const data = { id: "test", type: "register" as const };
    const token = encryptSession(data, secret);
    const decoded = decryptSession(token, secret);
    assert.strictEqual(decoded.id, "test");
  });

  it("createSessionToken generates valid token with ID and timestamps", () => {
    const { token, data } = createSessionToken({
      type: "register",
      mode: "agent-identity",
      network: "testnet",
    }, secret);
    assert.ok(token.length > 0);
    assert.ok(data.id.length > 0);
    assert.ok(data.createdAt);
    assert.ok(data.expiresAt);
    assert.strictEqual(data.stage, "pending");

    // Should decrypt successfully
    const decoded = decryptSession(token, secret);
    assert.strictEqual(decoded.id, data.id);
  });

  it("rotateSessionToken updates fields and re-encrypts", () => {
    const { data } = createSessionToken({
      type: "register",
      network: "testnet",
    }, secret);

    const newToken = rotateSessionToken(data, { stage: "completed", agentId: 42 }, secret);
    const decoded = decryptSession(newToken, secret);
    assert.strictEqual(decoded.stage, "completed");
    assert.strictEqual(decoded.agentId, 42);
    assert.strictEqual(decoded.id, data.id); // ID preserved
  });
});
