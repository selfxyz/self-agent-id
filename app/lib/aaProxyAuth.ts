import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";

const TOKEN_SECRET = process.env.AA_PROXY_TOKEN_SECRET || "";
const TOKEN_TTL_MS = Number(process.env.AA_PROXY_TOKEN_TTL_MS || 90_000);
const ENFORCE_ORIGIN = (process.env.AA_PROXY_ENFORCE_ORIGIN || "true") !== "false";
const ALLOWED_ORIGINS = (process.env.AA_PROXY_ALLOWED_ORIGINS || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

type TokenPayload = {
  exp: number;
  chainId: string;
  ip: string;
  uaHash: string;
};

function toBase64Url(input: Buffer): string {
  return input.toString("base64url");
}

function fromBase64Url(input: string): Buffer {
  return Buffer.from(input, "base64url");
}

function sign(payloadB64: string): string {
  return toBase64Url(
    createHmac("sha256", TOKEN_SECRET).update(payloadB64).digest(),
  );
}

function parseToken(token: string): { payload: TokenPayload; payloadB64: string; sigB64: string } | null {
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return null;
  try {
    const payloadJson = fromBase64Url(payloadB64).toString("utf8");
    const payload = JSON.parse(payloadJson) as TokenPayload;
    if (
      !payload ||
      typeof payload.exp !== "number" ||
      typeof payload.chainId !== "string" ||
      typeof payload.ip !== "string" ||
      typeof payload.uaHash !== "string"
    ) {
      return null;
    }
    return { payload, payloadB64, sigB64 };
  } catch {
    return null;
  }
}

export function getClientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  return "unknown";
}

function getUaHash(req: NextRequest): string {
  const ua = req.headers.get("user-agent") || "unknown";
  return createHash("sha256").update(ua).digest("hex");
}

export function validateAllowedOrigin(req: NextRequest): { ok: boolean; error?: string } {
  if (!ENFORCE_ORIGIN) return { ok: true };

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  const expectedHost = req.headers.get("host");

  // Same-origin browser requests include one of these. Non-browser clients may omit both.
  const candidate = origin || referer || "";
  if (!candidate) return { ok: false, error: "Missing origin/referer" };

  try {
    const parsed = new URL(candidate);
    if (ALLOWED_ORIGINS.length > 0) {
      if (!ALLOWED_ORIGINS.includes(parsed.origin)) {
        return { ok: false, error: "Origin not allowed" };
      }
      return { ok: true };
    }

    if (!expectedHost) return { ok: false, error: "Missing host header" };
    if (parsed.host !== expectedHost) return { ok: false, error: "Cross-origin request blocked" };
    return { ok: true };
  } catch {
    return { ok: false, error: "Invalid origin/referer" };
  }
}

export function issueAaProxyToken(req: NextRequest, chainId: string): {
  token?: string;
  expiresAt?: number;
  error?: string;
} {
  if (!TOKEN_SECRET) {
    return { error: "AA proxy token secret is not configured" };
  }

  const expiresAt = Date.now() + Math.max(10_000, TOKEN_TTL_MS);
  const payload: TokenPayload = {
    exp: expiresAt,
    chainId,
    ip: getClientIp(req),
    uaHash: getUaHash(req),
  };
  const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payload), "utf8"));
  const sigB64 = sign(payloadB64);
  return { token: `${payloadB64}.${sigB64}`, expiresAt };
}

export function verifyAaProxyToken(
  req: NextRequest,
  token: string,
  chainId: string,
): { ok: boolean; error?: string } {
  if (!TOKEN_SECRET) {
    return { ok: false, error: "AA proxy token secret is not configured" };
  }

  const parsed = parseToken(token);
  if (!parsed) return { ok: false, error: "Malformed AA token" };

  const expectedSig = sign(parsed.payloadB64);
  const expectedBuf = Buffer.from(expectedSig);
  const gotBuf = Buffer.from(parsed.sigB64);
  if (expectedBuf.length !== gotBuf.length || !timingSafeEqual(expectedBuf, gotBuf)) {
    return { ok: false, error: "Invalid AA token signature" };
  }

  if (parsed.payload.exp <= Date.now()) {
    return { ok: false, error: "AA token expired" };
  }

  if (parsed.payload.chainId !== chainId) {
    return { ok: false, error: "AA token chain mismatch" };
  }

  if (parsed.payload.ip !== getClientIp(req)) {
    return { ok: false, error: "AA token IP mismatch" };
  }

  if (parsed.payload.uaHash !== getUaHash(req)) {
    return { ok: false, error: "AA token client mismatch" };
  }

  return { ok: true };
}

