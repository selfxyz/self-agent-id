// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * A2A v0.3.0 Task Protocol types (JSON-RPC 2.0).
 * @see https://a2a-protocol.org/latest/specification/
 */

// ─── Message Parts ──────────────────────────────────────────────────────────

export interface TextPart {
  type: "text";
  text: string;
  metadata?: Record<string, unknown>;
}

export interface FilePart {
  type: "file";
  file: {
    name?: string;
    mimeType?: string;
    bytes?: string;
    uri?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface DataPart {
  type: "data";
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type Part = TextPart | FilePart | DataPart;

// ─── Message ────────────────────────────────────────────────────────────────

export interface Message {
  role: "user" | "agent";
  parts: Part[];
  metadata?: Record<string, unknown>;
}

// ─── Task ───────────────────────────────────────────────────────────────────

export type TaskState =
  | "submitted"
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed"
  | "unknown";

export interface TaskStatus {
  state: TaskState;
  message?: Message;
  timestamp?: string;
}

export interface Artifact {
  name?: string;
  description?: string;
  parts: Part[];
  index: number;
  append?: boolean;
  lastChunk?: boolean;
  metadata?: Record<string, unknown>;
}

export interface Task {
  id: string;
  sessionId?: string;
  status: TaskStatus;
  artifacts?: Artifact[];
  history?: Message[];
  metadata?: Record<string, unknown>;
}

// ─── Push Notification Config ───────────────────────────────────────────────

export interface TaskPushNotificationConfig {
  url: string;
  token?: string;
  authentication?: {
    schemes: string[];
    credentials?: string;
  };
}

// ─── JSON-RPC 2.0 ──────────────────────────────────────────────────────────

export interface JSONRPCRequest<P = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: P;
}

export interface JSONRPCError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JSONRPCResponse<T = unknown> {
  jsonrpc: "2.0";
  id: string | number;
  result?: T;
  error?: JSONRPCError;
}

// ─── A2A Method Params ──────────────────────────────────────────────────────

export interface SendMessageParams {
  message: Message;
  configuration?: TaskPushNotificationConfig;
  metadata?: Record<string, unknown>;
}

export interface GetTaskParams {
  id: string;
  historyLength?: number;
  metadata?: Record<string, unknown>;
}

export interface CancelTaskParams {
  id: string;
  metadata?: Record<string, unknown>;
}

// ─── A2A Requests ───────────────────────────────────────────────────────────

export interface SendMessageRequest
  extends JSONRPCRequest<SendMessageParams> {
  method: "message/send";
}

export interface SendStreamingMessageRequest
  extends JSONRPCRequest<SendMessageParams> {
  method: "message/stream";
}

export interface GetTaskRequest extends JSONRPCRequest<GetTaskParams> {
  method: "tasks/get";
}

export interface CancelTaskRequest extends JSONRPCRequest<CancelTaskParams> {
  method: "tasks/cancel";
}

export type A2ARequest =
  | SendMessageRequest
  | SendStreamingMessageRequest
  | GetTaskRequest
  | CancelTaskRequest;

// ─── SSE Event Types ────────────────────────────────────────────────────────

export interface TaskStatusUpdateEvent {
  id: string;
  status: TaskStatus;
  final: boolean;
  metadata?: Record<string, unknown>;
}

export interface TaskArtifactUpdateEvent {
  id: string;
  artifact: Artifact;
  metadata?: Record<string, unknown>;
}

export type A2AStreamEvent = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

// ─── A2A Error Codes ────────────────────────────────────────────────────────

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

export type A2AErrorCode = (typeof A2AErrorCodes)[keyof typeof A2AErrorCodes];
