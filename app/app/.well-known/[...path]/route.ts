// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * ANY /.well-known/* (unknown paths) — JSON 404 pointing at discovery.
 *
 * Auth: none. Rate limit: none.
 * Re-exports the /api catch-all handlers: the middleware leaves .well-known
 * alone, so without this Next would serve an HTML 404.
 */

export {
  GET,
  POST,
  PUT,
  DELETE,
  PATCH,
  HEAD,
  OPTIONS,
} from "@/app/api/[[...catchall]]/route";
