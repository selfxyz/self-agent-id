// SPDX-License-Identifier: MIT

/**
 * Shared test helpers: a base config and MCP tool-result unpacking.
 */

import type { ServerConfig } from "../config.js";

/** Config used by handler tests (testnet, fake RPC and API base). */
export const testConfig: ServerConfig = {
  privateKey: undefined,
  network: "testnet",
  rpcUrl: "https://custom-rpc.example",
  apiUrl: "https://api.example",
};

/**
 * Build a JSON fetch response.
 *
 * @param status - HTTP status code.
 * @param body - Value serialised as the JSON body.
 * @returns A Response for a mocked fetch to resolve with.
 */
export function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * Unpack an MCP tool result's first text block, parsing it as JSON when
 * possible.
 *
 * @param result - A tool handler's return value.
 * @returns `{ isError, json, text }`; `json` is `{}` for plain-text results.
 */
export function textOf(result: unknown): {
  isError?: boolean;
  json: Record<string, any>;
  text: string;
} {
  const r = result as {
    content: Array<{ type: string; text?: string }>;
    isError?: boolean;
  };
  const text = r.content.find((c) => c.type === "text")!.text!;
  let json: Record<string, any> = {};
  try {
    json = JSON.parse(text) as Record<string, any>;
  } catch {
    // Plain-text result.
  }
  return { isError: r.isError, json, text };
}
