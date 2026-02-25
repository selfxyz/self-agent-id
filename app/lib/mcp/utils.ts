// app/lib/mcp/utils.ts
//
// MCP tool response helpers and formatting utilities.
// Ported from self-agent-id-mcp/src/utils/.

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? Number(value) : value;
}

/** Return an MCP error content block. */
export function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

/** Return an MCP success content block with pretty-printed JSON. */
export function toolSuccess(data: Record<string, unknown>) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, bigintReplacer, 2) },
    ],
  };
}

// ── Formatting ──────────────────────────────────────────────────────────────

interface Credentials {
  nationality?: string;
  olderThan?: bigint | number;
  ofac?: boolean[];
}

export function formatCredentialsSummary(
  credentials: Credentials | undefined | null,
): string {
  if (!credentials) return "No credentials available";
  const parts: string[] = ["Verified human"];
  const age = Number(credentials.olderThan ?? 0);
  if (age > 0) parts.push(`${age}+`);
  if (credentials.ofac && credentials.ofac[0] === true)
    parts.push("OFAC clear");
  if (credentials.nationality)
    parts.push(`nationality: ${credentials.nationality}`);
  return parts.join(", ");
}

export function formatAgentInfo(
  info: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(info)) {
    result[key] = typeof value === "bigint" ? Number(value) : value;
  }
  return result;
}

const DEFAULT_MAX_BYTES = 10 * 1024;

export function truncateBody(
  body: string,
  maxBytes: number = DEFAULT_MAX_BYTES,
): { body: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(body);
  if (encoded.byteLength <= maxBytes) return { body, truncated: false };
  const decoder = new TextDecoder();
  const truncated = decoder.decode(encoded.slice(0, maxBytes));
  return {
    body:
      truncated +
      `\n\n[Truncated — original was ${encoded.byteLength} bytes, limit is ${maxBytes} bytes]`,
    truncated: true,
  };
}
