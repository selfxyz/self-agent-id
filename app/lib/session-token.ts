import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

export interface SessionData {
  id: string;
  type: "register" | "deregister";
  mode?: string;
  stage?: string;
  network?: string;
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

function deriveKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

export function encryptSession(data: SessionData, secret: string): string {
  const key = deriveKey(secret);
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

export function decryptSession(token: string, secret: string): SessionData {
  const key = deriveKey(secret);
  const padded = token.replace(/-/g, "+").replace(/_/g, "/");
  const combined = Buffer.from(padded, "base64");

  if (combined.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error("Invalid token: too short");
  }

  const iv = combined.subarray(0, IV_LENGTH);
  const authTag = combined.subarray(combined.length - AUTH_TAG_LENGTH);
  const ciphertext = combined.subarray(IV_LENGTH, combined.length - AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  const data: SessionData = JSON.parse(decrypted.toString("utf8"));

  if (data.expiresAt && new Date(data.expiresAt) < new Date()) {
    throw new Error("Session expired");
  }

  return data;
}

/** Create a fresh session token with standard fields populated */
export function createSessionToken(
  params: {
    type: "register" | "deregister";
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

/** Update session data and return a new encrypted token */
export function rotateSessionToken(
  currentData: SessionData,
  updates: Partial<SessionData>,
  secret: string,
): string {
  const updated = { ...currentData, ...updates };
  return encryptSession(updated, secret);
}
