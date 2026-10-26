// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Shared request/response helpers for API route tests. */

import { NextRequest } from "next/server";

/**
 * Build a NextRequest for calling a route handler directly.
 *
 * @param url - Absolute request URL.
 * @param init - Optional method, headers and body.
 * @returns The request.
 */
export function makeNextRequest(
  url: string,
  init?: ConstructorParameters<typeof NextRequest>[1],
): NextRequest {
  return new NextRequest(url, init);
}

/**
 * Parse a response body as JSON.
 *
 * @param res - Route handler response.
 * @returns The parsed body, cast to the expected shape.
 */
export async function jsonBody<T = Record<string, unknown>>(
  res: Response,
): Promise<T> {
  return (await res.json()) as T;
}
