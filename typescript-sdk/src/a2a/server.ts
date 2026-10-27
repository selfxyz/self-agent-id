// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * Framework-agnostic A2A JSON-RPC 2.0 server that routes requests to a `TaskHandler`.
 *
 * Handles `message/send`, `tasks/get` and `tasks/cancel`; `message/stream` is
 * rejected (SSE must be implemented by the host framework). Returned tasks are
 * kept in a bounded in-memory store (oldest evicted first).
 */

import type {
  Message,
  Task,
  JSONRPCResponse,
  SendMessageParams,
  GetTaskParams,
  CancelTaskParams,
} from "./types";
import { A2AErrorCodes } from "./types";

// ─── Task Handler Interface ─────────────────────────────────────────────────

/**
 * Implement this interface to handle incoming A2A requests.
 * The server routes JSON-RPC calls to these methods. Throw an Error whose
 * message contains "not found" or "not cancelable" to get the matching A2A code.
 */
export interface TaskHandler {
  /** Handle an incoming message. Return the resulting Task. */
  onMessage(
    message: Message,
    metadata?: Record<string, unknown>,
  ): Promise<Task>;
  /** Get a task by ID. */
  onGetTask(taskId: string, historyLength?: number): Promise<Task>;
  /** Cancel a task by ID. */
  onCancelTask(taskId: string): Promise<Task>;
}

// ─── A2A Server ─────────────────────────────────────────────────────────────

/** Default cap on tasks kept by `A2AServer` for `getStoredTask()`. */
const DEFAULT_MAX_STORED_TASKS = 1000;

/** Options for constructing an A2AServer. */
export interface A2AServerOptions {
  /**
   * Max tasks kept for `getStoredTask()` (default 1000). When full, the task
   * stored least recently is evicted. Must be a positive integer.
   */
  maxStoredTasks?: number;
}

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
  private maxStoredTasks: number;

  /**
   * @param handler - Your implementation of the task methods.
   * @param options - Optional `maxStoredTasks` cap for the task store (default 1000).
   * @throws If `maxStoredTasks` is not a positive integer.
   */
  constructor(handler: TaskHandler, options: A2AServerOptions = {}) {
    const max = options.maxStoredTasks ?? DEFAULT_MAX_STORED_TASKS;
    if (!Number.isInteger(max) || max < 1) {
      throw new Error(
        `maxStoredTasks must be a positive integer; received ${max}`,
      );
    }
    this.handler = handler;
    this.maxStoredTasks = max;
  }

  /**
   * Get a task from the in-memory store. Every task a handler returns is kept
   * until `maxStoredTasks` newer ones push it out (oldest evicted first).
   *
   * @param taskId - Task ID.
   * @returns The last stored copy, or undefined (never stored, or evicted).
   */
  getStoredTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Process a raw JSON-RPC request object and return a JSON-RPC response.
   * This is the main entry point — call this from your HTTP handler.
   *
   * @param request - The parsed JSON request body.
   * @returns A response with `result`, or `error` (handler exceptions become
   *   `INTERNAL_ERROR`); never throws.
   */
  async handleRequest(request: unknown): Promise<JSONRPCResponse> {
    // The body was already parsed, so a non-object is an invalid request,
    // not a parse error.
    if (!isObject(request)) {
      return errorResponse(
        null,
        A2AErrorCodes.INVALID_REQUEST,
        "Invalid request: expected a JSON-RPC request object",
      );
    }

    const req = request;

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
          // Frameworks should detect this method and implement SSE themselves.
          return errorResponse(
            id,
            A2AErrorCodes.UNSUPPORTED_OPERATION,
            "message/stream is not supported by A2AServer.handleRequest(); implement SSE streaming in your HTTP framework.",
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

  /**
   * Store (or refresh) a task, evicting the least recently stored over the cap.
   *
   * @param task - Task returned by the handler.
   */
  private storeTask(task: Task): void {
    // Re-insert so Map order tracks recency; the first key is the oldest.
    this.tasks.delete(task.id);
    this.tasks.set(task.id, task);
    while (this.tasks.size > this.maxStoredTasks) {
      const oldest = this.tasks.keys().next().value as string;
      this.tasks.delete(oldest);
    }
  }

  /**
   * Validate `message/send` params, call `onMessage` and store the task.
   *
   * @param id - JSON-RPC request ID.
   * @param params - Raw params.
   * @returns The task, or an `INVALID_PARAMS` error.
   * @throws Whatever `onMessage` throws (mapped to `INTERNAL_ERROR` by the caller).
   */
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
    this.storeTask(task);

    return {
      jsonrpc: "2.0",
      id,
      result: task,
    };
  }

  /**
   * Validate `tasks/get` params, call `onGetTask` and store the task.
   *
   * @param id - JSON-RPC request ID.
   * @param params - Raw params.
   * @returns The task, or an `INVALID_PARAMS` / `TASK_NOT_FOUND` error.
   * @throws Other handler errors (mapped to `INTERNAL_ERROR` by the caller).
   */
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
      this.storeTask(task);
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

  /**
   * Validate `tasks/cancel` params, call `onCancelTask` and store the task.
   *
   * @param id - JSON-RPC request ID.
   * @param params - Raw params.
   * @returns The task, or an `INVALID_PARAMS` / `TASK_NOT_FOUND` / `TASK_NOT_CANCELABLE` error.
   * @throws Other handler errors (mapped to `INTERNAL_ERROR` by the caller).
   */
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
      this.storeTask(task);
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

/**
 * Check for a plain (non-array, non-null) object.
 *
 * @param val - Any value.
 * @returns True if `val` is a non-null, non-array object.
 */
function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

/**
 * Coerce a JSON-RPC request ID; missing or invalid IDs become 0.
 *
 * @param val - Raw `id` field.
 * @returns The ID, or 0.
 */
function toId(val: unknown): string | number {
  if (typeof val === "string" || typeof val === "number") return val;
  return 0;
}

/**
 * Build a JSON-RPC error response.
 *
 * @param id - Request ID.
 * @param code - Error code (see `A2AErrorCodes`).
 * @param message - Error message.
 * @param data - Optional error data (omitted when undefined).
 * @returns The error response.
 */
function errorResponse<T = unknown>(
  id: string | number | null,
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
