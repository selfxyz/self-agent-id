// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * A2A JSON-RPC 2.0 client: send messages, stream SSE events, get/cancel tasks.
 *
 * Requests are not signed; pass auth via `headers` if the agent needs it.
 */

import type { A2AAgentCard } from "../agentCard";
import type {
  Message,
  Task,
  JSONRPCResponse,
  A2AStreamEvent,
  SendMessageParams,
  GetTaskParams,
  CancelTaskParams,
} from "./types";
import { A2AErrorCodes } from "./types";

/** Options for constructing an A2AClient. */
export interface A2AClientOptions {
  /** The A2A agent endpoint URL (JSON-RPC). If not provided, fetched from the agent card. */
  agentUrl?: string;
  /** A pre-fetched agent card. If not provided, it will be fetched from agentUrl. */
  agentCard?: A2AAgentCard;
  /** Optional headers to include in all requests (e.g. auth tokens). */
  headers?: Record<string, string>;
}

/** Error thrown when an A2A JSON-RPC response contains an error. */
export class A2AError extends Error {
  /** JSON-RPC / A2A error code (see `A2AErrorCodes`) */
  code: number;
  /** Server-supplied error data (e.g. `{ retryAfterMs }`) */
  data?: unknown;

  /**
   * @param code - JSON-RPC / A2A error code.
   * @param message - Error message.
   * @param data - Optional server-supplied error data.
   */
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "A2AError";
    this.code = code;
    this.data = data;
  }
}

/**
 * A2A protocol client. Sends JSON-RPC 2.0 requests to an A2A agent endpoint.
 *
 * @example
 * ```ts
 * const client = new A2AClient({ agentUrl: "https://agent.example.com/a2a" });
 * const task = await client.sendMessage({
 *   kind: "message", messageId: crypto.randomUUID(), role: "user",
 *   parts: [{ kind: "text", text: "Hello" }],
 * });
 * console.log(task.status.state);
 * ```
 */
export class A2AClient {
  private agentUrl: string;
  private cachedCard?: A2AAgentCard;
  private headers: Record<string, string>;
  private nextId = 1;

  /**
   * @param options - Endpoint (`agentUrl`, or `agentCard.url`), optional card and headers.
   * @throws If neither `agentUrl` nor `agentCard.url` is given.
   */
  constructor(options: A2AClientOptions) {
    if (!options.agentUrl && !options.agentCard?.url) {
      throw new Error(
        "A2AClient requires either agentUrl or an agentCard with a url",
      );
    }
    this.agentUrl = options.agentUrl ?? options.agentCard!.url!;
    this.cachedCard = options.agentCard;
    this.headers = options.headers ?? {};
  }

  /**
   * Fetch and cache the A2A agent card from the well-known endpoint.
   * If a baseUrl is provided, fetches from `{baseUrl}/.well-known/agent-card.json`.
   * Otherwise uses the configured agentUrl's origin.
   *
   * @param baseUrl - Origin to fetch the card from (default: the agentUrl's origin).
   * @returns The agent card (also cached for `getAgentCard()`).
   * @throws A2AError (`INVALID_AGENT_CARD`) on a non-2xx response; fetch/JSON errors.
   */
  async fetchAgentCard(baseUrl?: string): Promise<A2AAgentCard> {
    const origin = baseUrl ?? new URL(this.agentUrl).origin;
    const cardUrl = `${origin.replace(/\/$/, "")}/.well-known/agent-card.json`;
    const res = await fetch(cardUrl, {
      headers: { Accept: "application/json", ...this.headers },
    });
    if (!res.ok) {
      throw new A2AError(
        A2AErrorCodes.INVALID_AGENT_CARD,
        `Failed to fetch agent card: ${res.status} ${res.statusText}`,
      );
    }
    this.cachedCard = (await res.json()) as A2AAgentCard;
    return this.cachedCard;
  }

  /**
   * Return the cached agent card.
   *
   * @returns The card passed to the constructor or last fetched, or undefined.
   */
  getAgentCard(): A2AAgentCard | undefined {
    return this.cachedCard;
  }

  /**
   * Send a message to the agent (`message/send`).
   *
   * @param message - The message to send.
   * @param metadata - Optional request metadata.
   * @returns The resulting task.
   * @throws A2AError with the server's JSON-RPC error, or `INTERNAL_ERROR` on HTTP failure.
   */
  async sendMessage(
    message: Message,
    metadata?: Record<string, unknown>,
  ): Promise<Task> {
    return this.rpc<SendMessageParams, Task>("message/send", {
      message,
      metadata,
    });
  }

  /**
   * Get the current state of a task (`tasks/get`).
   *
   * @param taskId - Task ID.
   * @param historyLength - Max history messages to return.
   * @param metadata - Optional request metadata.
   * @returns The task.
   * @throws A2AError (e.g. `TASK_NOT_FOUND`).
   */
  async getTask(
    taskId: string,
    historyLength?: number,
    metadata?: Record<string, unknown>,
  ): Promise<Task> {
    return this.rpc<GetTaskParams, Task>("tasks/get", {
      id: taskId,
      historyLength,
      metadata,
    });
  }

  /**
   * Cancel a task (`tasks/cancel`).
   *
   * @param taskId - Task ID.
   * @param metadata - Optional request metadata.
   * @returns The task in its canceled state.
   * @throws A2AError (e.g. `TASK_NOT_FOUND`, `TASK_NOT_CANCELABLE`).
   */
  async cancelTask(
    taskId: string,
    metadata?: Record<string, unknown>,
  ): Promise<Task> {
    return this.rpc<CancelTaskParams, Task>("tasks/cancel", {
      id: taskId,
      metadata,
    });
  }

  /**
   * Send a message and receive streaming SSE events (`message/stream`).
   *
   * Events may span network chunks; lines may end in `\n`, `\r\n` or `\r`; a
   * final event without a trailing blank line is still delivered.
   *
   * @param message - The message to send.
   * @param metadata - Optional request metadata.
   * @returns An async iterable of status and artifact events.
   * @throws A2AError on a non-2xx response or a missing body; SyntaxError on malformed event JSON.
   */
  async *sendMessageStream(
    message: Message,
    metadata?: Record<string, unknown>,
  ): AsyncIterable<A2AStreamEvent> {
    const body = JSON.stringify({
      jsonrpc: "2.0" as const,
      id: this.nextId++,
      method: "message/stream",
      params: { message, metadata },
    });

    const res = await fetch(this.agentUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...this.headers,
      },
      body,
    });

    if (!res.ok) {
      throw new A2AError(
        A2AErrorCodes.INTERNAL_ERROR,
        `Stream request failed: ${res.status} ${res.statusText}`,
      );
    }

    if (!res.body) {
      throw new A2AError(
        A2AErrorCodes.UNSUPPORTED_OPERATION,
        "Response body is not a readable stream",
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SSEDataParser();

    try {
      while (true) {
        const readResult = await reader.read();
        if (readResult.done) break;
        const text = decoder.decode(readResult.value as Uint8Array, {
          stream: true,
        });
        for (const data of parser.push(text)) {
          yield withPartKinds(JSON.parse(data)) as A2AStreamEvent;
        }
      }
      for (const data of parser.end(decoder.decode())) {
        yield withPartKinds(JSON.parse(data)) as A2AStreamEvent;
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────

  /**
   * POST a JSON-RPC request and unwrap its result.
   *
   * @param method - JSON-RPC method name.
   * @param params - Method params.
   * @returns The `result` field, with legacy part `type` copied to `kind`.
   * @throws A2AError with the body's JSON-RPC error, or `INTERNAL_ERROR` on HTTP/JSON failure.
   */
  private async rpc<P, R>(method: string, params: P): Promise<R> {
    const body = JSON.stringify({
      jsonrpc: "2.0" as const,
      id: this.nextId++,
      method,
      params,
    });

    const res = await fetch(this.agentUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...this.headers,
      },
      body,
    });

    // Servers send JSON-RPC errors with 4xx statuses too (e.g. 404 task not
    // found, 429 with data.retryAfterMs), so prefer the body's error.
    const json = (await res
      .json()
      .catch(() => null)) as JSONRPCResponse<R> | null;

    if (json?.error) {
      throw new A2AError(json.error.code, json.error.message, json.error.data);
    }
    if (!res.ok || !json) {
      throw new A2AError(
        A2AErrorCodes.INTERNAL_ERROR,
        `HTTP ${res.status} ${res.statusText}`,
      );
    }

    return withPartKinds(json.result) as R;
  }
}

/**
 * Line-buffered Server-Sent Events parser that yields each event's `data`.
 *
 * Follows the SSE spec: lines end in `\n`, `\r\n` or `\r`; `data:` lines
 * (one optional leading space stripped) accumulate, joined by `\n`; a blank
 * line dispatches; comments (`:`) and other fields are ignored. Events with
 * empty data are skipped (nothing to parse). Unlike the spec, `end()` also
 * dispatches a final event that lacks its blank line.
 */
class SSEDataParser {
  private buffer = "";
  private data: string[] = [];

  /**
   * Feed decoded text; it may split lines and events anywhere.
   *
   * @param text - Next chunk of decoded stream text.
   * @returns The `data` of every event completed by this chunk.
   */
  push(text: string): string[] {
    this.buffer += text;
    const events: string[] = [];
    let start = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const ch = this.buffer[i];
      if (ch !== "\n" && ch !== "\r") continue;
      // A trailing "\r" may be the first half of "\r\n": wait for more text.
      if (ch === "\r" && i === this.buffer.length - 1) break;
      this.line(this.buffer.slice(start, i), events);
      if (ch === "\r" && this.buffer[i + 1] === "\n") i++;
      start = i + 1;
    }
    this.buffer = this.buffer.slice(start);
    return events;
  }

  /**
   * Finish the stream: process any unterminated last line and flush a
   * pending event.
   *
   * @param text - Any remaining decoded text (e.g. the decoder's final flush).
   * @returns The `data` of the remaining events.
   */
  end(text = ""): string[] {
    const events = this.push(text);
    // Whatever is left is one unterminated line (possibly a lone "\r").
    if (this.buffer !== "") this.line(this.buffer.replace(/\r$/, ""), events);
    this.buffer = "";
    this.line("", events);
    return events;
  }

  /**
   * Apply one complete line.
   *
   * @param line - The line without its terminator.
   * @param events - Receives the event data when `line` is blank.
   */
  private line(line: string, events: string[]): void {
    if (line === "") {
      const data = this.data.join("\n");
      if (data !== "") events.push(data);
      this.data = [];
      return;
    }
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    if (field !== "data") return;
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    this.data.push(value);
  }
}

/**
 * Accept pre-0.3.0 servers that tag parts with `type` instead of `kind`:
 * copies `type` to `kind` on any object inside a `parts` array.
 *
 * @param value - Parsed JSON (mutated in place).
 * @returns The same value.
 */
function withPartKinds(value: unknown): unknown {
  if (Array.isArray(value)) {
    value.forEach(withPartKinds);
  } else if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.parts)) {
      for (const part of obj.parts as Record<string, unknown>[]) {
        if (part && part.kind === undefined && typeof part.type === "string") {
          part.kind = part.type;
        }
      }
    }
    Object.values(obj).forEach(withPartKinds);
  }
  return value;
}
