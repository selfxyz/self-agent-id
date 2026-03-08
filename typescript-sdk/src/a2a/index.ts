// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

export type {
  TextPart,
  FilePart,
  DataPart,
  Part,
  Message,
  TaskState,
  TaskStatus,
  Artifact,
  Task,
  TaskPushNotificationConfig,
  JSONRPCRequest,
  JSONRPCError,
  JSONRPCResponse,
  SendMessageParams,
  GetTaskParams,
  CancelTaskParams,
  SendMessageRequest,
  SendStreamingMessageRequest,
  GetTaskRequest,
  CancelTaskRequest,
  A2ARequest,
  TaskStatusUpdateEvent,
  TaskArtifactUpdateEvent,
  A2AStreamEvent,
  A2AErrorCode,
} from "./types";
export { A2AErrorCodes } from "./types";

export { A2AClient, A2AError } from "./client";
export type { A2AClientOptions } from "./client";

export { A2AServer } from "./server";
export type { TaskHandler } from "./server";
