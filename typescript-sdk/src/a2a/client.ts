// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

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
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "A2AError";
    this.code = code;
    this.data = data;
  }
}

/**
 * A2A protocol client. Sends JSON-RPC 2.0 requests to an A2A agent endpoint.
 */
export class A2AClient {
  private agentUrl: string;
  private cachedCard?: A2AAgentCard;
  private headers: Record<string, string>;
  private nextId = 1;

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

  /** Returns the cached agent card, or undefined if not yet fetched. */
  getAgentCard(): A2AAgentCard | undefined {
    return this.cachedCard;
  }

  /** Send a message to the agent. Returns the resulting Task. */
  async sendMessage(
    message: Message,
    metadata?: Record<string, unknown>,
  ): Promise<Task> {
    return this.rpc<SendMessageParams, Task>("message/send", {
      message,
      metadata,
    });
  }

  /** Get the current state of a task. */
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

  /** Cancel a task. */
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
   * Send a message and receive streaming SSE events.
   * Returns an async iterable of A2AStreamEvent objects.
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

    // Parse SSE from the response body
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? "";

        let eventData = "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            eventData += line.slice(6);
          } else if (line === "" && eventData) {
            // Empty line = end of event
            yield JSON.parse(eventData) as A2AStreamEvent;
            eventData = "";
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  // ─── Private ────────────────────────────────────────────────────────────

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

    if (!res.ok) {
      throw new A2AError(
        A2AErrorCodes.INTERNAL_ERROR,
        `HTTP ${res.status} ${res.statusText}`,
      );
    }

    const json = (await res.json()) as JSONRPCResponse<R>;

    if (json.error) {
      throw new A2AError(json.error.code, json.error.message, json.error.data);
    }

    return json.result as R;
  }
}
