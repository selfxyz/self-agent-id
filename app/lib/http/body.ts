// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import type { NextRequest } from "next/server";

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export async function readTextBodyWithLimit(
  req: NextRequest,
  maxBytes: number,
): Promise<{ ok: true; body: string } | { ok: false }> {
  const body = await req.text();
  if (utf8ByteLength(body) > maxBytes) {
    return { ok: false };
  }
  return { ok: true, body };
}
