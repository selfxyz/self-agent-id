// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextResponse } from "next/server";

export function rateLimitedResponse(
  body: Record<string, unknown>,
  retryAfterMs: number,
): NextResponse {
  const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));

  return NextResponse.json(body, {
    status: 429,
    headers: {
      "Retry-After": String(retryAfterSeconds),
    },
  });
}
