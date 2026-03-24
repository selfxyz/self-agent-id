// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// ── Shared helpers for API routes ─────────────────────────────────────────────

import { NextResponse } from "next/server";

/** Standard CORS headers for public API endpoints */
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Cache-Control": "public, max-age=60",
} as const;

/** Handle OPTIONS preflight requests */
export function corsResponse(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/** Return a standardized JSON error response */
export function errorResponse(message: string, status: number): NextResponse {
  return NextResponse.json(
    { error: message },
    { status, headers: CORS_HEADERS },
  );
}

/** Safely parse agentId string to BigInt. Returns null if invalid. */
export function validateAgentId(id: string): bigint | null {
  try {
    const n = BigInt(id);
    if (n <= 0n) return null;
    return n;
  } catch {
    return null;
  }
}
