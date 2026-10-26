// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Encrypted, stateless session tokens and QR tokens (AES-256-GCM).
 *
 * The whole session (including any server-generated agent private key) lives
 * inside the token; the server stores nothing. Tokens are base64url and keyed
 * from SESSION_SECRET. QR tokens use a separate derived key.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/** Decrypted session state carried inside a session token. */
export interface SessionData {
  id: string;
  type: "register" | "deregister" | "refresh" | "identify";
  mode?: string;
  stage?: string;
  network?: string;
  /** Server-generated agent key (register flow); only returned by export. */
  agentPrivateKey?: string;
  humanAddress?: string;
  agentAddress?: string;
  agentId?: number;
  txHash?: string;
  proof?: unknown;
  createdAt?: string;
  expiresAt?: string;
  [key: string]: unknown;
}

/**
 * Derive a 32-byte AES key from the secret.
 *
 * @param secret - SESSION_SECRET.
 * @param purpose - Domain-separation prefix ("" for session tokens).
 * @returns SHA-256(purpose + secret).
 */
function deriveKey(secret: string, purpose = ""): Buffer {
  return createHash("sha256")
    .update(purpose + secret)
    .digest();
}

/**
 * Encrypt a JSON payload into a base64url token (iv | ciphertext | tag).
 *
 * @param data - JSON-serialisable payload.
 * @param key - 32-byte AES key.
 * @returns The unpadded base64url token.
 */
function seal(data: object, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = JSON.stringify(data);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, encrypted, authTag]);
  return combined
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Decrypt and authenticate a token, then enforce its `expiresAt`.
 *
 * @param token - Base64url token from seal().
 * @param key - 32-byte AES key it was sealed with.
 * @param graceMs - How long past `expiresAt` to still accept (default 0).
 * @returns The decrypted payload object.
 * @throws "Invalid token: too short"; a crypto error on tamper or wrong key; a
 *   SyntaxError on non-JSON plaintext; "Invalid token payload" when it is not
 *   an object; "Session expired" past `expiresAt + graceMs`.
 */
function open(
  token: string,
  key: Buffer,
  graceMs = 0,
): Record<string, unknown> {
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const combined = Buffer.from(padded, "base64");

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid token: too short");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(
    IV_LENGTH,
    combined.length - AUTH_TAG_LENGTH,
  );
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const parsed = JSON.parse(decrypted.toString("utf8")) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Invalid token payload");
  }
  const data = parsed as Record<string, unknown>;

  // Every token the server mints carries an ISO expiry; anything else is
  // malformed (and must not become a token that never expires).
  const expiresAtMs =
    typeof data.expiresAt === "string" ? Date.parse(data.expiresAt) : NaN;
  if (Number.isNaN(expiresAtMs)) throw new Error("Invalid token payload");
  if (expiresAtMs + graceMs < Date.now()) throw new Error("Session expired");

  return data;
}

/**
 * Encrypt session data into a session token.
 *
 * @param data - Session state.
 * @param secret - SESSION_SECRET.
 * @returns The session token.
 */
export function encryptSession(data: SessionData, secret: string): string {
  return seal(data, deriveKey(secret));
}

/**
 * Decrypt a session token.
 *
 * Does not check `type`; callers (requireSession) must check the flow.
 *
 * @param token - Session token.
 * @param secret - SESSION_SECRET.
 * @param options.graceMs - Accept tokens up to this long past `expiresAt`
 *   (the caller must then check `expiresAt` itself).
 * @returns The session data.
 * @throws Error("Session expired") past `expiresAt + graceMs`; any other
 *   error (too short, tampered, wrong secret, bad payload) means invalid.
 */
export function decryptSession(
  token: string,
  secret: string,
  options: { graceMs?: number } = {},
): SessionData {
  return open(token, deriveKey(secret), options.graceMs) as SessionData;
}

// QR tokens are encrypted under a separate derived key, so a QR token can
// never be decrypted as a session token (or vice versa). They carry only the
// deep link to render — no private key, no session state.
const QR_KEY_PURPOSE = "self-agent-id:qr-token:";

/**
 * Mint the QR token used in public `scanUrl`s (`/api/qr/<qrToken>`).
 *
 * @param deepLink - Self app deep link the QR image encodes.
 * @param expiresAt - ISO expiry (normally the session's).
 * @param secret - SESSION_SECRET.
 * @returns The QR token.
 */
export function createQrToken(
  deepLink: string,
  expiresAt: string,
  secret: string,
): string {
  return seal(
    { type: "qr", deepLink, expiresAt },
    deriveKey(secret, QR_KEY_PURPOSE),
  );
}

/**
 * Decrypt a QR token.
 *
 * @param token - QR token from a `scanUrl`.
 * @param secret - SESSION_SECRET.
 * @returns The deep link and its expiry.
 * @throws Error("Session expired") past `expiresAt`; any other error
 *   (tampered, a session token, wrong payload type) means invalid.
 */
export function readQrToken(
  token: string,
  secret: string,
): { deepLink: string; expiresAt: string } {
  const data = open(token, deriveKey(secret, QR_KEY_PURPOSE));
  if (
    data.type !== "qr" ||
    typeof data.deepLink !== "string" ||
    typeof data.expiresAt !== "string"
  ) {
    throw new Error("Invalid token payload");
  }
  return { deepLink: data.deepLink, expiresAt: data.expiresAt };
}

/**
 * Create a new session at stage "pending" with a random ID.
 *
 * @param params.type - Flow the token is for.
 * @param params.ttlMs - Lifetime in ms (default 30 minutes).
 * @param params.mode - Registration mode, network, agent key and addresses
 *   are copied into the session as given.
 * @param secret - SESSION_SECRET.
 * @returns The session token and the session data it encrypts.
 */
export function createSessionToken(
  params: {
    type: "register" | "deregister" | "refresh" | "identify";
    mode?: string;
    network?: string;
    agentPrivateKey?: string;
    humanAddress?: string;
    agentAddress?: string;
    ttlMs?: number;
  },
  secret: string,
): { token: string; data: SessionData } {
  const now = new Date();
  const ttl = params.ttlMs ?? 30 * 60_000;
  const data: SessionData = {
    id: randomBytes(16).toString("hex"),
    type: params.type,
    mode: params.mode,
    stage: "pending",
    network: params.network,
    agentPrivateKey: params.agentPrivateKey,
    humanAddress: params.humanAddress,
    agentAddress: params.agentAddress,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttl).toISOString(),
  };
  return { token: encryptSession(data, secret), data };
}

/**
 * Merge updates into a session and re-encrypt it (a fresh IV each time).
 *
 * @param currentData - Current session state.
 * @param updates - Fields to overwrite.
 * @param secret - SESSION_SECRET.
 * @returns The new session token.
 */
export function rotateSessionToken(
  currentData: SessionData,
  updates: Partial<SessionData>,
  secret: string,
): string {
  const updated = { ...currentData, ...updates };
  return encryptSession(updated, secret);
}
