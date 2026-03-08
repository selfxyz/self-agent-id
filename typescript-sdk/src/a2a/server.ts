// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import type {
  Message,
  Task,
  JSONRPCRequest,
  JSONRPCResponse,
  SendMessageParams,
  GetTaskParams,
  CancelTaskParams,
} from "./types";
import { A2AErrorCodes } from "./types";

// ─── Task Handler Interface ─────────────────────────────────────────────────

/**
 * Implement this interface to handle incoming A2A requests.
 * The server routes JSON-RPC calls to these methods.
 */
export interface TaskHandler {
  /** Handle an incoming message. Return the resulting Task. */
  onMessage(message: Message, metadata?: Record<string, unknown>): Promise<Task>;
  /** Get a task by ID. */
  onGetTask(taskId: string, historyLength?: number): Promise<Task>;
  /** Cancel a task by ID. */
  onCancelTask(taskId: string): Promise<Task>;
}

// ─── A2A Server ─────────────────────────────────────────────────────────────

/**
 * Framework-agnostic A2A JSON-RPC 2.0 server.
 *
 * Takes raw request objects and returns response objects.
 * Plug into any HTTP framework (Express, Fastify, Next.js, etc.)
 * by parsing the request body and passing it to `handleRequest()`.
 */
export class A2AServer {
  private handler: TaskHandler;
  private tasks = new Map<string, Task>();

  constructor(handler: TaskHandler) {
    this.handler = handler;
  }

  /** Get a stored task by ID (from the in-memory store). */
  getStoredTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Process a raw JSON-RPC request object and return a JSON-RPC response.
   * This is the main entry point — call this from your HTTP handler.
   */
  async handleRequest(
    request: unknown,
  ): Promise<JSONRPCResponse> {
    // Validate basic JSON-RPC structure
    if (!isObject(request)) {
      return errorResponse(0, A2AErrorCodes.PARSE_ERROR, "Parse error");
    }

    const req = request as Record<string, unknown>;

    if (req.jsonrpc !== "2.0") {
      return errorResponse(
        toId(req.id),
        A2AErrorCodes.INVALID_REQUEST,
        "Invalid JSON-RPC version",
      );
    }

    if (typeof req.method !== "string") {
      return errorResponse(
        toId(req.id),
        A2AErrorCodes.INVALID_REQUEST,
        "Missing or invalid method",
      );
    }

    const id = toId(req.id);

    try {
      switch (req.method) {
        case "message/send":
          return await this.handleSendMessage(id, req.params);
        case "tasks/get":
          return await this.handleGetTask(id, req.params);
        case "tasks/cancel":
          return await this.handleCancelTask(id, req.params);
        case "message/stream":
          // Streaming is not handled via simple request/response.
          // Frameworks should detect this method and handle SSE separately.
          return errorResponse(
            id,
            A2AErrorCodes.UNSUPPORTED_OPERATION,
            "Streaming must be handled via SSE. Use handleStreamRequest() or implement SSE in your framework.",
          );
        default:
          return errorResponse(
            id,
            A2AErrorCodes.METHOD_NOT_FOUND,
            `Unknown method: ${req.method}`,
          );
      }
    } catch (err) {
      return errorResponse(
        id,
        A2AErrorCodes.INTERNAL_ERROR,
        err instanceof Error ? err.message : "Internal error",
      );
    }
  }

  // ─── Method Handlers ──────────────────────────────────────────────────

  private async handleSendMessage(
    id: string | number,
    params: unknown,
  ): Promise<JSONRPCResponse<Task>> {
    if (!isObject(params)) {
      return errorResponse(id, A2AErrorCodes.INVALID_PARAMS, "Missing params");
    }

    const p = params as unknown as SendMessageParams;

    if (!p.message || !Array.isArray(p.message.parts)) {
      return errorResponse(
        id,
        A2AErrorCodes.INVALID_PARAMS,
        "Invalid message: must include parts array",
      );
    }

    if (!["user", "agent"].includes(p.message.role)) {
      return errorResponse(
        id,
        A2AErrorCodes.INVALID_PARAMS,
        'Invalid message role: must be "user" or "agent"',
      );
    }

    const task = await this.handler.onMessage(p.message, p.metadata);
    this.tasks.set(task.id, task);

    return {
      jsonrpc: "2.0",
      id,
      result: task,
    };
  }

  private async handleGetTask(
    id: string | number,
    params: unknown,
  ): Promise<JSONRPCResponse<Task>> {
    if (!isObject(params)) {
      return errorResponse(id, A2AErrorCodes.INVALID_PARAMS, "Missing params");
    }

    const p = params as unknown as GetTaskParams;

    if (typeof p.id !== "string") {
      return errorResponse(
        id,
        A2AErrorCodes.INVALID_PARAMS,
        "Missing or invalid task id",
      );
    }

    try {
      const task = await this.handler.onGetTask(p.id, p.historyLength);
      this.tasks.set(task.id, task);
      return { jsonrpc: "2.0", id, result: task };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.toLowerCase().includes("not found")
      ) {
        return errorResponse(id, A2AErrorCodes.TASK_NOT_FOUND, err.message);
      }
      throw err;
    }
  }

  private async handleCancelTask(
    id: string | number,
    params: unknown,
  ): Promise<JSONRPCResponse<Task>> {
    if (!isObject(params)) {
      return errorResponse(id, A2AErrorCodes.INVALID_PARAMS, "Missing params");
    }

    const p = params as unknown as CancelTaskParams;

    if (typeof p.id !== "string") {
      return errorResponse(
        id,
        A2AErrorCodes.INVALID_PARAMS,
        "Missing or invalid task id",
      );
    }

    try {
      const task = await this.handler.onCancelTask(p.id);
      this.tasks.set(task.id, task);
      return { jsonrpc: "2.0", id, result: task };
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.toLowerCase().includes("not found")
      ) {
        return errorResponse(id, A2AErrorCodes.TASK_NOT_FOUND, err.message);
      }
      if (
        err instanceof Error &&
        err.message.toLowerCase().includes("not cancelable")
      ) {
        return errorResponse(
          id,
          A2AErrorCodes.TASK_NOT_CANCELABLE,
          err.message,
        );
      }
      throw err;
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function toId(val: unknown): string | number {
  if (typeof val === "string" || typeof val === "number") return val;
  return 0;
}

function errorResponse<T = unknown>(
  id: string | number,
  code: number,
  message: string,
  data?: unknown,
): JSONRPCResponse<T> {
  return {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
}
