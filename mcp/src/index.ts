#!/usr/bin/env node
// SPDX-License-Identifier: MIT

/**
 * CLI entry point: runs the Self Agent ID MCP server over stdio.
 *
 * Config comes from the environment (see config.ts). Logs go to stderr, as
 * stdout carries the MCP protocol.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

/**
 * Load the config, build the server and connect it to stdio.
 *
 * @returns Resolves once connected.
 * @throws When the config is invalid or the transport fails to start.
 */
async function main(): Promise<void> {
  const { server, config } = createServer();
  await server.connect(new StdioServerTransport());
  console.error(
    `Self Agent ID MCP server running on stdio (network: ${config.network}, ` +
      `agent key: ${config.privateKey ? "configured" : "not set"})`,
  );
}

main().catch((err: unknown) => {
  // Config errors never contain secrets; other errors are reduced to a name.
  console.error(
    "Fatal error:",
    err instanceof Error ? err.message : typeof err,
  );
  process.exit(1);
});
