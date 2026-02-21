import { incrementWithWindow } from "@/lib/securityStore";

export async function checkRateLimit(params: {
  key: string;
  limit: number;
  windowMs: number;
}): Promise<{ allowed: boolean; remaining: number; retryAfterMs: number }> {
  const { key, limit, windowMs } = params;
  const safeLimit = Math.max(1, Math.floor(limit));
  const safeWindow = Math.max(1, Math.floor(windowMs));

  const { count, ttlMs } = await incrementWithWindow(key, safeWindow);
  const allowed = count <= safeLimit;
  const remaining = Math.max(0, safeLimit - count);

  return {
    allowed,
    remaining,
    retryAfterMs: Math.max(1, ttlMs),
  };
}

