// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import {
  A2AServer,
  A2AErrorCodes,
  type TaskHandler,
  type Message,
  type Task,
  type JSONRPCResponse,
} from "@selfxyz/agent-sdk";
import { typedRegistry } from "@/lib/contract-types";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { DEFAULT_NETWORK, NETWORKS } from "@/lib/network";

// ── CORS headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store",
} as const;

// ── In-memory task store ────────────────────────────────────────────────────
// NOTE: Tasks are stored in memory for now. In production, replace with a
// persistent store (database, Redis, etc.).

const taskStore = new Map<string, Task>();

let taskCounter = 0;

function generateTaskId(): string {
  taskCounter += 1;
  return `task-${Date.now()}-${taskCounter}`;
}

// ── Helper: verify agent on-chain (optional auth) ───────────────────────────

async function verifyAgentOnChain(
  agentId: string,
): Promise<{ valid: boolean; reason?: string }> {
  const defaultNet = NETWORKS[DEFAULT_NETWORK];
  const chainId = String(defaultNet.chainId);
  const config = CHAIN_CONFIG[chainId];
  if (!config) {
    return { valid: false, reason: "No chain config available" };
  }

  try {
    const id = BigInt(agentId);
    if (id <= 0n) return { valid: false, reason: "Invalid agent ID" };

    const provider = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, provider);
    const hasProof: boolean = await registry.hasHumanProof(id);
    if (!hasProof) {
      return { valid: false, reason: "Agent does not have a human proof" };
    }

    // Check proof freshness
    try {
      const isFresh: boolean = await registry.isProofFresh(id);
      if (!isFresh) {
        return { valid: false, reason: "Agent proof has expired" };
      }
    } catch {
      // isProofFresh may not be available on older contracts — allow
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: "Failed to verify agent on-chain" };
  }
}

// ── Task Handler ────────────────────────────────────────────────────────────

/**
 * Stub TaskHandler for the Self Agent ID registry.
 *
 * In a full implementation, onMessage would dispatch to agent-specific logic
 * (e.g., routing the message to the target agent's own A2A endpoint, or
 * executing registry queries). For now it creates a task, echoes back
 * an acknowledgement, and stores the task.
 */
const registryTaskHandler: TaskHandler = {
  async onMessage(
    message: Message,
    metadata?: Record<string, unknown>,
  ): Promise<Task> {
    const taskId = generateTaskId();

    // Extract text content from the incoming message for the echo response
    const textParts = message.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text);

    const responseText =
      textParts.length > 0
        ? `Self Agent ID Registry received your message: "${textParts.join(" ")}". ` +
          "Task created and queued for processing."
        : "Self Agent ID Registry received your message. Task created and queued for processing.";

    const task: Task = {
      id: taskId,
      sessionId: (metadata?.sessionId as string) || undefined,
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [{ type: "text", text: responseText }],
        },
        timestamp: new Date().toISOString(),
      },
      history: [
        message,
        {
          role: "agent",
          parts: [{ type: "text", text: responseText }],
        },
      ],
    };

    taskStore.set(taskId, task);
    return task;
  },

  async onGetTask(
    taskId: string,
    historyLength?: number,
  ): Promise<Task> {
    const task = taskStore.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Apply historyLength truncation if requested
    if (historyLength !== undefined && task.history) {
      return {
        ...task,
        history: task.history.slice(-historyLength),
      };
    }

    return task;
  },

  async onCancelTask(taskId: string): Promise<Task> {
    const task = taskStore.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    // Only cancelable if not already in a terminal state
    const terminalStates = new Set(["completed", "canceled", "failed"]);
    if (terminalStates.has(task.status.state)) {
      throw new Error(
        `Task not cancelable: already in state "${task.status.state}"`,
      );
    }

    const canceledTask: Task = {
      ...task,
      status: {
        state: "canceled",
        message: {
          role: "agent",
          parts: [{ type: "text", text: "Task canceled by request." }],
        },
        timestamp: new Date().toISOString(),
      },
    };

    taskStore.set(taskId, canceledTask);
    return canceledTask;
  },
};

// ── A2A Server instance ─────────────────────────────────────────────────────

const a2aServer = new A2AServer(registryTaskHandler);

// ── Route handler ───────────────────────────────────────────────────────────

/**
 * POST /api/a2a
 *
 * A2A v0.3.0 JSON-RPC 2.0 endpoint.
 *
 * Accepts JSON-RPC requests for:
 *   - message/send: Send a message and create a task
 *   - tasks/get: Retrieve a task by ID
 *   - tasks/cancel: Cancel a task
 *
 * Optional agent verification: If the request includes an `X-Agent-Id` header,
 * the endpoint verifies that the agent is registered and has a valid human proof
 * on-chain before processing the request.
 */
export async function POST(req: NextRequest) {
  // ── Content-Type check ──
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const errorResp: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: A2AErrorCodes.CONTENT_TYPE_NOT_SUPPORTED,
        message:
          "Content-Type must be application/json",
      },
    };
    return NextResponse.json(errorResp, {
      status: 415,
      headers: CORS_HEADERS,
    });
  }

  // ── Optional: verify requesting agent ──
  const requestingAgentId = req.headers.get("x-agent-id");
  if (requestingAgentId) {
    const verification = await verifyAgentOnChain(requestingAgentId);
    if (!verification.valid) {
      const errorResp: JSONRPCResponse = {
        jsonrpc: "2.0",
        id: 0,
        error: {
          code: A2AErrorCodes.INVALID_REQUEST,
          message: `Agent verification failed: ${verification.reason}`,
        },
      };
      return NextResponse.json(errorResp, {
        status: 403,
        headers: CORS_HEADERS,
      });
    }
  }

  // ── Parse JSON-RPC body ──
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const errorResp: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: A2AErrorCodes.PARSE_ERROR,
        message: "Invalid JSON in request body",
      },
    };
    return NextResponse.json(errorResp, {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  // ── Delegate to A2AServer ──
  const response = await a2aServer.handleRequest(body);

  // Determine HTTP status: 200 for success, 400-range for errors
  let httpStatus = 200;
  if (response.error) {
    switch (response.error.code) {
      case A2AErrorCodes.PARSE_ERROR:
      case A2AErrorCodes.INVALID_REQUEST:
      case A2AErrorCodes.INVALID_PARAMS:
        httpStatus = 400;
        break;
      case A2AErrorCodes.METHOD_NOT_FOUND:
        httpStatus = 404;
        break;
      case A2AErrorCodes.TASK_NOT_FOUND:
        httpStatus = 404;
        break;
      case A2AErrorCodes.TASK_NOT_CANCELABLE:
        httpStatus = 409;
        break;
      case A2AErrorCodes.INTERNAL_ERROR:
        httpStatus = 500;
        break;
      default:
        httpStatus = 400;
    }
  }

  return NextResponse.json(response, {
    status: httpStatus,
    headers: CORS_HEADERS,
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Id",
    },
  });
}
