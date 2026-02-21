import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import {
  getClientIp,
  issueAaProxyToken,
  validateAllowedOrigin,
} from "@/lib/aaProxyAuth";

const ALLOWED_CHAINS = new Set(["42220", "11142220"]);
const WINDOW_MS = 60_000;
const MAX_TOKEN_REQ_PER_MINUTE = Number(process.env.AA_TOKEN_MAX_REQ_PER_MINUTE || 30);

export async function POST(req: NextRequest) {
  const originCheck = validateAllowedOrigin(req);
  if (!originCheck.ok) {
    return NextResponse.json(
      { error: originCheck.error || "Origin check failed" },
      { status: 403 },
    );
  }

  const chainId = req.nextUrl.searchParams.get("chainId");
  if (!chainId || !ALLOWED_CHAINS.has(chainId)) {
    return NextResponse.json(
      { error: "Unsupported or missing chain" },
      { status: 400 },
    );
  }

  const ip = getClientIp(req);
  const limit = await checkRateLimit({
    key: `aa:token:${chainId}:${ip}`,
    limit: MAX_TOKEN_REQ_PER_MINUTE,
    windowMs: WINDOW_MS,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      {
        error: "Rate limit exceeded",
        retryAfterMs: limit.retryAfterMs,
      },
      { status: 429 },
    );
  }

  const issued = issueAaProxyToken(req, chainId);
  if (!issued.token || !issued.expiresAt) {
    return NextResponse.json(
      { error: issued.error || "Unable to issue AA token" },
      { status: 503 },
    );
  }

  return NextResponse.json({
    token: issued.token,
    expiresAt: issued.expiresAt,
  });
}

