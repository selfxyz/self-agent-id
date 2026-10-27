// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * A2A v0.3.0 Task Protocol types (JSON-RPC 2.0).
 *
 * @see https://a2a-protocol.org/latest/specification/
 */

// ─── Message Parts ──────────────────────────────────────────────────────────

/** Plain-text message part. */
export interface TextPart {
  kind: "text";
  text: string;
  metadata?: Record<string, unknown>;
}

/** File message part: inline base64 `bytes` or a `uri`. */
export interface FilePart {
  kind: "file";
  file: {
    name?: string;
    mimeType?: string;
    /** Base64-encoded content */
    bytes?: string;
    uri?: string;
  };
  metadata?: Record<string, unknown>;
}

/** Structured JSON message part. */
export interface DataPart {
  kind: "data";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/** Any message part, discriminated by `kind`. */
export type Part = TextPart | FilePart | DataPart;

// ─── Message ────────────────────────────────────────────────────────────────

/** A single message exchanged between user and agent. */
export interface Message {
  kind: "message";
  messageId: string;
  role: "user" | "agent";
  parts: Part[];
  taskId?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
}

// ─── Task ───────────────────────────────────────────────────────────────────

/** Lifecycle state of a task. */
export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "rejected"
  | "auth-required"
  | "unknown";

/** Current state of a task, with an optional agent message and ISO timestamp. */
export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;
}

/** An output produced by a task. */
export interface Artifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: Part[];
  metadata?: Record<string, unknown>;
}

/** A unit of work tracked by the server, with status, artifacts and message history. */
export interface Task {
  kind: "task";
  id: string;
  contextId: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

// ─── Push Notification Config ───────────────────────────────────────────────

/** Where and how the server should push task updates. */
export interface TaskPushNotificationConfig {
  url: string;
  token?: string;
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
}

// ─── JSON-RPC 2.0 ──────────────────────────────────────────────────────────

/** JSON-RPC 2.0 request envelope. */
export interface JSONRPCRequest<P = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: P;
}

/** JSON-RPC 2.0 error object (`code` from `A2AErrorCodes`). */
export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

/** JSON-RPC 2.0 response envelope: exactly one of `result` or `error`. */
export interface JSONRPCResponse<T = unknown> {
  jsonrpc: "2.0";
  /** `null` when the request was too malformed to read an id (JSON-RPC 2.0). */
  id: string | number | null;
  result?: T;
  error?: JSONRPCError;
}

// ─── A2A Method Params ──────────────────────────────────────────────────────

/** Params for `message/send` and `message/stream`. */
export interface SendMessageParams {
  message: Message;
  configuration?: TaskPushNotificationConfig;
  metadata?: Record<string, unknown>;
}

/** Params for `tasks/get`. */
export interface GetTaskParams {
  id: string;
  /** Return at most this many history messages */
  historyLength?: number;
  metadata?: Record<string, unknown>;
}

/** Params for `tasks/cancel`. */
export interface CancelTaskParams {
  id: string;
  metadata?: Record<string, unknown>;
}

// ─── A2A Requests ───────────────────────────────────────────────────────────

/** `message/send` request. */
export interface SendMessageRequest extends JSONRPCRequest<SendMessageParams> {
  method: "message/send";
}

/** `message/stream` request (SSE response). */
export interface SendStreamingMessageRequest extends JSONRPCRequest<SendMessageParams> {
  method: "message/stream";
}

/** `tasks/get` request. */
export interface GetTaskRequest extends JSONRPCRequest<GetTaskParams> {
  method: "tasks/get";
}

/** `tasks/cancel` request. */
export interface CancelTaskRequest extends JSONRPCRequest<CancelTaskParams> {
  method: "tasks/cancel";
}

/** Any supported A2A JSON-RPC request. */
export type A2ARequest =
  | SendMessageRequest
  | SendStreamingMessageRequest
  | GetTaskRequest
  | CancelTaskRequest;

// ─── SSE Event Types ────────────────────────────────────────────────────────

/** SSE event: task status changed; `final` marks the last event. */
export interface TaskStatusUpdateEvent {
  kind: "status-update";
  taskId: string;
  contextId: string;
  status: TaskStatus;
  final: boolean;
  metadata?: Record<string, unknown>;
}

/** SSE event: artifact produced or extended (`append`/`lastChunk` for chunking). */
export interface TaskArtifactUpdateEvent {
  kind: "artifact-update";
  taskId: string;
  contextId: string;
  artifact: Artifact;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

/** Any SSE event emitted by `message/stream`. */
export type A2AStreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

// ─── A2A Error Codes ────────────────────────────────────────────────────────

/** JSON-RPC 2.0 standard codes plus A2A-specific codes (-32001..-32006). */
export const A2AErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  TASK_NOT_FOUND: -32001,
  TASK_NOT_CANCELABLE: -32002,
  PUSH_NOTIFICATIONS_NOT_SUPPORTED: -32003,
  UNSUPPORTED_OPERATION: -32004,
  CONTENT_TYPE_NOT_SUPPORTED: -32005,
  INVALID_AGENT_CARD: -32006,
} as const;

/** Numeric value of any `A2AErrorCodes` entry. */
export type A2AErrorCode = (typeof A2AErrorCodes)[keyof typeof A2AErrorCodes];
