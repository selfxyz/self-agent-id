// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/** Tests for A2AClient (JSON-RPC calls, errors, legacy parts, SSE parsing) and A2AServer. */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert";
import { A2AClient, A2AError, A2AErrorCodes, A2AServer } from "../a2a";
import type { A2AStreamEvent, Task, TaskHandler } from "../a2a";

const realFetch = globalThis.fetch;

/** Make fetch answer with an SSE body delivered as exactly these text chunks. */
function mockStream(chunks: string[]): void {
  globalThis.fetch = (async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(body, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
}

/** Collect every event from `sendMessageStream`. */
async function collect(): Promise<A2AStreamEvent[]> {
  const client = new A2AClient({ agentUrl: "https://api.test/api/a2a" });
  const events: A2AStreamEvent[] = [];
  for await (const event of client.sendMessageStream({
    kind: "message",
    messageId: "m0",
    role: "user",
    parts: [{ kind: "text", text: "hello" }],
  })) {
    events.push(event);
  }
  return events;
}

/** A status-update event JSON string with the given state. */
function statusEvent(state: string): string {
  return JSON.stringify({
    kind: "status-update",
    taskId: "t1",
    contextId: "c1",
    status: { state },
    final: state === "completed",
  });
}

/** States of the collected status-update events, in order. */
function states(events: A2AStreamEvent[]): string[] {
  return events.map((e) => (e as { status: { state: string } }).status.state);
}

describe("A2AClient", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("tags legacy `type` parts with `kind`", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          result: {
            kind: "task",
            id: "t1",
            contextId: "c1",
            status: {
              state: "completed",
              message: {
                kind: "message",
                messageId: "m1",
                role: "agent",
                parts: [{ type: "text", text: "hi" }],
              },
            },
          },
        }),
      )) as typeof fetch;

    const client = new A2AClient({ agentUrl: "https://api.test/api/a2a" });
    const task = await client.sendMessage({
      kind: "message",
      messageId: "m0",
      role: "user",
      parts: [{ kind: "text", text: "hello" }],
    });
    assert.deepStrictEqual(task.status.message?.parts[0], {
      type: "text",
      kind: "text",
      text: "hi",
    });
  });

  it("surfaces JSON-RPC errors sent with 4xx statuses", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          error: {
            code: -32000,
            message: "Rate limit exceeded",
            data: { retryAfterMs: 1500 },
          },
        }),
        { status: 429 },
      )) as typeof fetch;

    const client = new A2AClient({ agentUrl: "https://api.test/api/a2a" });
    await assert.rejects(client.getTask("t1"), (err: unknown) => {
      assert.ok(err instanceof A2AError);
      assert.strictEqual(err.code, -32000);
      assert.deepStrictEqual(err.data, { retryAfterMs: 1500 });
      return true;
    });
  });

  it("falls back to an HTTP error when the body isn't JSON-RPC", async () => {
    globalThis.fetch = (async () =>
      new Response("<html>bad gateway</html>", {
        status: 502,
        statusText: "Bad Gateway",
      })) as typeof fetch;

    const client = new A2AClient({ agentUrl: "https://api.test/api/a2a" });
    await assert.rejects(client.getTask("t1"), /HTTP 502 Bad Gateway/);
  });
});

describe("A2AClient.sendMessageStream SSE parsing", () => {
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("joins an event split across chunks (even mid-line)", async () => {
    const wire = `data: ${statusEvent("working")}\n\ndata: ${statusEvent("completed")}\n\n`;
    const cut1 = 10;
    const cut2 = wire.indexOf("\n\n") + 1; // between the two newlines
    mockStream([wire.slice(0, cut1), wire.slice(cut1, cut2), wire.slice(cut2)]);
    assert.deepStrictEqual(states(await collect()), ["working", "completed"]);
  });

  it("delivers a final event that has no trailing blank line", async () => {
    mockStream([
      `data: ${statusEvent("working")}\n\n`,
      `data: ${statusEvent("completed")}`,
    ]);
    assert.deepStrictEqual(states(await collect()), ["working", "completed"]);
  });

  it("handles \\r\\n and bare \\r line endings, including \\r\\n split across chunks", async () => {
    mockStream([
      `data: ${statusEvent("working")}\r`,
      `\n\r\ndata: ${statusEvent("input-required")}\r\r`,
      `data: ${statusEvent("completed")}\r\n\r\n`,
    ]);
    assert.deepStrictEqual(states(await collect()), [
      "working",
      "input-required",
      "completed",
    ]);
  });

  it("accepts `data:` without a space, multi-line data, comments and other fields", async () => {
    const json = statusEvent("completed");
    const mid = json.indexOf(",");
    mockStream([
      `: keep-alive\nevent: status\nid: 1\ndata:${json.slice(0, mid + 1)}\ndata:${json.slice(mid + 1)}\n\n`,
    ]);
    assert.deepStrictEqual(states(await collect()), ["completed"]);
  });

  it("strips only one leading space from the data value", async () => {
    mockStream([`data:  ${statusEvent("completed")}\n\n`]);
    // Two spaces: one is stripped, the other is JSON whitespace.
    assert.deepStrictEqual(states(await collect()), ["completed"]);
  });
});

describe("A2AServer", () => {
  /** Handler whose onMessage returns a completed task with a fresh ID each call. */
  function handler(): TaskHandler {
    let n = 0;
    const task = (id: string): Task => ({
      kind: "task",
      id,
      contextId: "c",
      status: { state: "completed" },
    });
    return {
      onMessage: async () => task(`t${++n}`),
      onGetTask: async (id) => task(id),
      onCancelTask: async (id) => task(id),
    };
  }

  /** A valid message/send request. */
  const send = {
    jsonrpc: "2.0",
    id: 1,
    method: "message/send",
    params: {
      message: {
        kind: "message",
        messageId: "m",
        role: "user",
        parts: [{ kind: "text", text: "hi" }],
      },
    },
  };

  it("answers a non-object request with INVALID_REQUEST, not PARSE_ERROR", async () => {
    const server = new A2AServer(handler());
    for (const bad of [null, "text", 42, [send]]) {
      const res = await server.handleRequest(bad);
      assert.strictEqual(res.error?.code, A2AErrorCodes.INVALID_REQUEST);
      assert.strictEqual(res.id, null); // JSON-RPC 2.0: id unknown → null
    }
  });

  it("rejects message/stream without pointing at a nonexistent method", async () => {
    const server = new A2AServer(handler());
    const res = await server.handleRequest({
      ...send,
      method: "message/stream",
    });
    assert.strictEqual(res.error?.code, A2AErrorCodes.UNSUPPORTED_OPERATION);
    assert.doesNotMatch(res.error.message, /handleStreamRequest/);
    assert.match(res.error.message, /SSE/);
  });

  it("evicts the oldest stored task beyond maxStoredTasks", async () => {
    const server = new A2AServer(handler(), { maxStoredTasks: 2 });
    for (let i = 0; i < 3; i++) await server.handleRequest(send);
    assert.strictEqual(server.getStoredTask("t1"), undefined);
    assert.ok(server.getStoredTask("t2"));
    assert.ok(server.getStoredTask("t3"));

    // Re-storing t2 (via tasks/get) makes t3 the oldest.
    await server.handleRequest({
      jsonrpc: "2.0",
      id: 2,
      method: "tasks/get",
      params: { id: "t2" },
    });
    await server.handleRequest(send); // t4
    assert.strictEqual(server.getStoredTask("t3"), undefined);
    assert.ok(server.getStoredTask("t2"));
    assert.ok(server.getStoredTask("t4"));
  });

  it("rejects a non-positive maxStoredTasks", () => {
    assert.throws(
      () => new A2AServer(handler(), { maxStoredTasks: 0 }),
      /positive integer/,
    );
  });
});
