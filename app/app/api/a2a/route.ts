// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/a2a — A2A v0.3.0 JSON-RPC 2.0 endpoint of the registry.
 *
 * Auth: none; an optional `X-Agent-Id` header requires the calling agent to
 * have a fresh human proof on the default network (403 otherwise). The
 * default network (DEFAULT_NETWORK: mainnet unless NEXT_PUBLIC_DEFAULT_NETWORK
 * says otherwise) also applies to registrations and agent queries that name
 * no network or chain.
 * Rate limit: message/send 60/min per IP; agent reads (lookup, verify,
 * freshness, deregister, X-Agent-Id check) also spend the 120/min read
 * budget; session intents count against the called route's own limit.
 * Body limit 64 KB.
 *
 * Methods: message/send, tasks/get, tasks/cancel. A message's intent comes
 * from a data part ({ intent, ... }), a text part holding JSON, or plain
 * English ("look up agent 5 on testnet"). Intents: register, status, lookup,
 * verify, freshness, deregister, refresh-proof, help.
 *
 * Session-starting intents call the registration / lifecycle route handlers
 * in-process (no HTTP hop, no URLs derived from request headers) and hand the
 * session token back in the task's data part. Clients poll with
 * { intent: "status", sessionToken }, which works on any server instance.
 * Polling by taskId only works on the instance that started the task (task
 * state is per-instance memory), so it is a fallback, not the documented path.
 */

import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { A2AErrorCodes } from "@selfxyz/agent-sdk";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { DEFAULT_NETWORK, NETWORKS } from "@/lib/network";
import {
  AGENT_CORS_HEADERS,
  ERRORS,
  corsResponse,
  getAppBaseUrl,
  getClientIp,
  getSessionSecret,
  networkForChainId,
  parseAgentIdField,
  readJsonObjectBody,
  validateAgentId,
} from "@/lib/agent-api-helpers";
import {
  AgentNotFoundError,
  checkReadLimit,
  connectRegistry,
  publicCredentials,
  readAgentState,
  readProviderStrength,
  type AgentTarget,
} from "@/lib/agent-read";
import { checkRateLimit } from "@/lib/rate-limit";
import { MODES_REQUIRING_HUMAN, normalizeMode } from "@/lib/registration-modes";
import { decryptSession } from "@/lib/session-token";
import { POST as registerPOST } from "@/app/api/agent/register/route";
import { GET as registerStatusGET } from "@/app/api/agent/register/status/route";
import { POST as deregisterPOST } from "@/app/api/agent/deregister/route";
import { GET as deregisterStatusGET } from "@/app/api/agent/deregister/status/route";
import { POST as refreshPOST } from "@/app/api/agent/refresh/route";
import { GET as refreshStatusGET } from "@/app/api/agent/refresh/status/route";

/** Response headers: CORS (plus X-Agent-Id) and no caching. */
const HEADERS = {
  ...AGENT_CORS_HEADERS,
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Id",
  "Cache-Control": "no-store",
};

/** Largest accepted JSON-RPC body (64 KB). */
const MAX_BODY_BYTES = 64 * 1024;

/** message/send per IP per minute (each can cost RPC calls or start a session). */
const SEND_LIMIT = 60;
/** JSON-RPC server-error code for rate limiting (A2A defines none). */
const RATE_LIMITED = -32000;

// ── A2A v0.3.0 wire types (parts are discriminated by `kind`) ───────────────

/** A message part; `kind` discriminates text, file (base64 bytes) and data. */
type Part =
  | { kind: "text"; text: string }
  | { kind: "file"; file: { name: string; mimeType: string; bytes: string } }
  | { kind: "data"; data: Record<string, unknown> };

/** An A2A message (user or agent turn). */
interface Message {
  kind: "message";
  messageId: string;
  role: "user" | "agent";
  parts: Part[];
  taskId?: string;
  contextId?: string;
}

/** A2A task states this server produces. */
type TaskState =
  | "working"
  | "input-required"
  | "completed"
  | "canceled"
  | "failed";

/** An A2A task: one message/send exchange and its current status. */
interface Task {
  kind: "task";
  id: string;
  contextId: string;
  status: { state: TaskState; message: Message; timestamp: string };
  history: Message[];
}

/** What an intent handler produces; wrapped into a Task by `makeTask`. */
interface Reply {
  state: TaskState;
  parts: Part[];
}

/** Bad intent parameters → JSON-RPC INVALID_PARAMS with this message. */
class InvalidParamsError extends Error {}

/** A per-IP limit was hit (here or in a route called in-process). */
class RateLimitedError extends Error {
  /**
   * @param retryAfterMs - How long the caller should wait before retrying.
   */
  constructor(readonly retryAfterMs: number) {
    super("Rate limit exceeded. Try again later.");
  }
}

/** Per-request context, passed explicitly (never module state). */
interface Ctx {
  req: NextRequest;
  baseUrl: string;
}

// ── In-memory stores (per instance, bounded) ────────────────────────────────

/** Human-in-the-loop flows an A2A task can start. */
type Flow = "registration" | "deregistration" | "refresh";

/** Cap on each in-memory store; the oldest entry is evicted first. */
const MAX_TASKS = 500;
/** taskId → task, for tasks/get and tasks/cancel. */
const taskStore = new Map<string, Task>();
/** taskId → latest session token of the flow that task started. */
const taskSessions = new Map<string, string>();

/**
 * Insert or refresh `key` as the newest entry, evicting the oldest entry once
 * the map exceeds MAX_TASKS.
 *
 * @param map - Store to update (insertion order = age).
 * @param key - Entry key.
 * @param value - Entry value.
 */
function remember<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_TASKS) map.delete(map.keys().next().value!);
}

// ── Parts ────────────────────────────────────────────────────────────────────

/**
 * Wrap strings as text parts.
 *
 * @param texts - One string per part.
 * @returns The text parts, in order.
 */
function textParts(...texts: string[]): Part[] {
  return texts.map((text) => ({ kind: "text" as const, text }));
}

/**
 * Wrap an object as a data part.
 *
 * @param data - Structured payload for the client.
 * @returns The data part.
 */
function dataPart(data: Record<string, unknown>): Part {
  return { kind: "data", data };
}

/**
 * Build an intent handler's reply.
 *
 * @param state - Task state to report.
 * @param parts - Parts or arrays of parts, flattened in order.
 * @returns The reply.
 */
function reply(state: TaskState, ...parts: (Part | Part[])[]): Reply {
  return { state, parts: parts.flat() };
}

/**
 * Read a part's discriminator. v0.3.0 uses `kind`; older clients (and
 * SDK <= 0.2) send `type`.
 *
 * @param p - A raw part from the request.
 * @returns `kind`, else `type`, else undefined.
 */
function partKind(p: unknown): unknown {
  if (!p || typeof p !== "object") return undefined;
  const part = p as { kind?: unknown; type?: unknown };
  return part.kind ?? part.type;
}

/**
 * Join the text of all text parts.
 *
 * @param parts - Raw parts from the request.
 * @returns Non-empty texts joined by spaces, trimmed ("" if none).
 */
function extractText(parts: unknown[]): string {
  return parts
    .map((p) => (partKind(p) === "text" ? (p as { text?: unknown }).text : ""))
    .filter((t): t is string => typeof t === "string" && t !== "")
    .join(" ")
    .trim();
}

/**
 * Find the first data part's payload.
 *
 * @param parts - Raw parts from the request.
 * @returns The payload when it is a plain object, else null.
 */
function extractData(parts: unknown[]): Record<string, unknown> | null {
  const part = parts.find((p) => partKind(p) === "data") as
    | { data?: unknown }
    | undefined;
  const data = part?.data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

// ── Intent parsing ───────────────────────────────────────────────────────────

/** Intents that act on one existing agent. */
type AgentIntentType =
  | "lookup"
  | "verify"
  | "deregister"
  | "check-freshness"
  | "refresh-proof";

/** A parsed request; "register-ask" means register with no mode chosen. */
type Intent =
  | {
      type: "register";
      network: "mainnet" | "testnet";
      mode: string;
      humanAddress?: unknown;
      ed25519Pubkey?: unknown;
      ed25519Signature?: unknown;
      disclosures?: unknown;
    }
  | { type: "register-ask"; network: string }
  | { type: "status"; taskId: string }
  | { type: "session-status"; sessionToken: string }
  | { type: AgentIntentType; agentId: bigint; chainId: string }
  | { type: "help" }
  | { type: "unknown" };

/** Chain for agent queries that name no chain or network. */
const DEFAULT_CHAIN_ID = String(NETWORKS[DEFAULT_NETWORK].chainId);
/** Network for registrations that name none; same default as agent queries. */
const DEFAULT_API_NETWORK = networkForChainId(DEFAULT_CHAIN_ID)!;
/** Network name → chain ID (decimal string). */
const NETWORK_CHAIN_IDS: Record<string, string> = {
  mainnet: String(NETWORKS["celo-mainnet"].chainId),
  testnet: String(NETWORKS["celo-sepolia"].chainId),
};

/**
 * Parse an agent ID from intent data. Same rules as the REST routes: IDs
 * above 2^53 parse, then are not found.
 *
 * @param value - Number or decimal string.
 * @returns The agent ID.
 * @throws InvalidParamsError when it is not a positive integer.
 */
function agentIdParam(value: unknown): bigint {
  const id = parseAgentIdField(value);
  if (id === null) {
    throw new InvalidParamsError("agentId must be a positive integer");
  }
  return id;
}

/**
 * Parse a `network` field (default: DEFAULT_NETWORK, as for agent queries).
 *
 * @param value - "mainnet", "testnet" or undefined.
 * @returns The network.
 * @throws InvalidParamsError for any other value.
 */
function networkParam(value: unknown): "mainnet" | "testnet" {
  if (value === undefined) return DEFAULT_API_NETWORK;
  if (value === "mainnet" || value === "testnet") return value;
  throw new InvalidParamsError(ERRORS.invalidNetwork);
}

/**
 * Pick the chain for an agent intent: chainId (number or decimal string),
 * else network, else the default chain.
 *
 * @param data - Intent data.
 * @returns A supported chain ID (decimal string).
 * @throws InvalidParamsError for an unsupported chainId or bad network.
 */
function chainParam(data: Record<string, unknown>): string {
  if (data.chainId !== undefined) {
    const chainId =
      typeof data.chainId === "number" || typeof data.chainId === "string"
        ? String(data.chainId)
        : "";
    if (!CHAIN_CONFIG[chainId]) {
      throw new InvalidParamsError(
        `${ERRORS.unsupportedChain}. Supported chainIds: ${Object.values(NETWORK_CHAIN_IDS).join(", ")}`,
      );
    }
    return chainId;
  }
  if (data.network !== undefined) {
    return NETWORK_CHAIN_IDS[networkParam(data.network)];
  }
  return DEFAULT_CHAIN_ID;
}

/**
 * Pick the chain named in plain-English text.
 *
 * @param text - Lower-cased message text.
 * @returns Testnet or mainnet chain ID if mentioned, else the default chain.
 */
function chainFromText(text: string): string {
  if (text.includes("testnet")) return NETWORK_CHAIN_IDS.testnet;
  if (text.includes("mainnet")) return NETWORK_CHAIN_IDS.mainnet;
  return DEFAULT_CHAIN_ID;
}

/** Accepted `intent` names (and aliases) → agent intent. */
const AGENT_INTENTS: Record<string, AgentIntentType> = {
  lookup: "lookup",
  info: "lookup",
  verify: "verify",
  check: "verify",
  deregister: "deregister",
  unregister: "deregister",
  revoke: "deregister",
  freshness: "check-freshness",
  "check-freshness": "check-freshness",
  "refresh-proof": "refresh-proof",
  refresh: "refresh-proof",
  renew: "refresh-proof",
  "re-verify": "refresh-proof",
  reauthenticate: "refresh-proof",
};

/**
 * Work out what the message asks for: a data part (or JSON text) with an
 * `intent` field, else plain-English matching.
 *
 * "deregister agent #5" is matched before "register"; a register request
 * without a recognisable mode or address becomes "register-ask".
 *
 * @param parts - Raw parts from the request.
 * @returns The parsed intent ("unknown" when nothing matches).
 * @throws InvalidParamsError for bad agentId, chain, network, or a status
 *   intent without sessionToken / taskId.
 */
function parseIntent(parts: unknown[]): Intent {
  const rawText = extractText(parts);
  const text = rawText.toLowerCase();
  let data = extractData(parts);

  // Agents sometimes send the structured request as JSON inside a text part.
  if (!data && rawText.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        data = parsed as Record<string, unknown>;
      }
    } catch {
      // Not JSON: fall through to natural language.
    }
  }

  if (data && typeof data.intent === "string") {
    const intent = data.intent;
    if (intent === "register" || intent === "registration") {
      const mode =
        typeof data.mode === "string"
          ? data.mode
          : data.ed25519Pubkey
            ? data.humanAddress
              ? "ed25519-linked"
              : "ed25519"
            : data.humanAddress
              ? "linked"
              : "wallet-free";
      return {
        type: "register",
        network: networkParam(data.network),
        mode,
        humanAddress: data.humanAddress,
        ed25519Pubkey: data.ed25519Pubkey,
        ed25519Signature: data.ed25519Signature,
        disclosures: data.disclosures,
      };
    }
    if (intent === "status" || intent === "register-status") {
      if (typeof data.sessionToken === "string" && data.sessionToken) {
        return { type: "session-status", sessionToken: data.sessionToken };
      }
      if (typeof data.taskId === "string" && data.taskId) {
        return { type: "status", taskId: data.taskId };
      }
      throw new InvalidParamsError(
        "status needs the sessionToken from the task's data part",
      );
    }
    if (intent === "help") return { type: "help" };
    const type = AGENT_INTENTS[intent];
    if (type) {
      return {
        type,
        agentId: agentIdParam(data.agentId),
        chainId: chainParam(data),
      };
    }
    return { type: "unknown" };
  }

  // ── Natural language ──
  // "deregister agent #5" must be checked before "register".
  const agentMatchers: [AgentIntentType, RegExp][] = [
    [
      "deregister",
      /(?:deregister|unregister|revoke|remove|delete)\s+(?:agent\s*)?#?(\d+)/,
    ],
    [
      "refresh-proof",
      /(?:refresh|renew|re-?verif)\w*\s+(?:proof\s+(?:for\s+)?)?(?:agent\s*)?#?(\d+)/,
    ],
    ["check-freshness", /(?:fresh|expir)\w*\s+(?:of\s+)?(?:agent\s*)?#?(\d+)/],
    [
      "lookup",
      /(?:look\s*up|info|details|get|fetch|card)\s+(?:agent\s*)?#?(\d+)/,
    ],
    ["verify", /(?:verify|check|is|has|does)\s+(?:agent\s*)?#?(\d+)/],
  ];
  const [dereg, ...rest] = agentMatchers;
  const match = ([type, re]: [AgentIntentType, RegExp]): Intent | null => {
    const m = text.match(re);
    if (!m) return null;
    return { type, agentId: agentIdParam(m[1]), chainId: chainFromText(text) };
  };

  const deregIntent = match(dereg);
  if (deregIntent) return deregIntent;

  if (
    (text.includes("register") && !/(?:de|un)register/.test(text)) ||
    text.includes("sign up") ||
    text.includes("create agent") ||
    text.includes("new agent")
  ) {
    const network = text.includes("testnet")
      ? "testnet"
      : text.includes("mainnet")
        ? "mainnet"
        : DEFAULT_API_NETWORK;
    const addrMatch = rawText.match(/0x[a-fA-F0-9]{40}/);
    const explicitMode =
      /ed25519|linked|wallet-?\s?free|quick|simple/.test(text) || addrMatch;
    if (!explicitMode) return { type: "register-ask", network };
    return {
      type: "register",
      network,
      humanAddress: addrMatch?.[0],
      mode: /ed25519[- ]linked/.test(text)
        ? "ed25519-linked"
        : text.includes("ed25519")
          ? "ed25519"
          : text.includes("linked") || addrMatch
            ? "linked"
            : "wallet-free",
    };
  }

  for (const matcher of rest) {
    const intent = match(matcher);
    if (intent) return intent;
  }

  if (/help|what can you do|capabilities/.test(text)) return { type: "help" };
  return { type: "unknown" };
}

// ── In-process calls to the lifecycle routes ────────────────────────────────

/** Signature shared by the route handlers called in-process. */
type RouteHandler = (req: NextRequest) => Response | Promise<Response>;

/**
 * Invoke another route handler of this app directly. Client IP headers are
 * forwarded so per-IP rate limits still apply to the original caller.
 *
 * @param ctx - Current request context (caller IP headers, base URL).
 * @param handler - Route handler to call.
 * @param path - Route path, for the synthetic request URL.
 * @param opts.body - JSON body; makes the call a POST (GET otherwise).
 * @param opts.bearer - Session token to send as Authorization: Bearer.
 * @returns {ok, status, body} of the route's JSON response.
 * @throws RateLimitedError on a 429; InvalidParamsError on a 400 (bad input
 *   from our caller).
 */
async function callRoute(
  ctx: Ctx,
  handler: RouteHandler,
  path: string,
  opts: { body?: Record<string, unknown>; bearer?: string },
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const headers = new Headers();
  for (const name of ["x-real-ip", "x-forwarded-for"]) {
    const value = ctx.req.headers.get(name);
    if (value) headers.set(name, value);
  }
  if (opts.bearer) headers.set("authorization", `Bearer ${opts.bearer}`);
  if (opts.body) headers.set("content-type", "application/json");
  const res = await handler(
    new NextRequest(`${ctx.baseUrl}${path}`, {
      method: opts.body ? "POST" : "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    }),
  );
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.status === 429) {
    throw new RateLimitedError(
      typeof body.retryAfterMs === "number" ? body.retryAfterMs : 60_000,
    );
  }
  if (res.status === 400) {
    throw new InvalidParamsError(
      typeof body.error === "string" ? body.error : "Invalid parameters",
    );
  }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Pull the error message out of a route's JSON body.
 *
 * @param body - Route response body.
 * @returns `body.error`, or "Unknown error".
 */
function errorText(body: Record<string, unknown>): string {
  return typeof body.error === "string" ? body.error : "Unknown error";
}

/**
 * Build the session-start reply (QR file part, scan link, poll hint) and
 * remember the session token under the task.
 *
 * @param taskId - Task that started the session.
 * @param flow - Which flow was started (names the QR file).
 * @param intro - Lines shown before the QR instructions.
 * @param result - Body of the session-start route (sessionToken, scanUrl,
 *   deepLink, qrImageBase64, expiresAt, timeRemainingMs).
 * @param extra - Flow-specific fields for the data part.
 * @returns An "input-required" reply.
 */
function sessionStarted(
  taskId: string,
  flow: Flow,
  intro: string[],
  result: Record<string, unknown>,
  extra: Record<string, unknown>,
): Reply {
  remember(taskSessions, taskId, String(result.sessionToken));
  const qr =
    typeof result.qrImageBase64 === "string" && result.qrImageBase64
      ? [
          {
            kind: "file" as const,
            file: {
              name: `${flow}-qr.png`,
              mimeType: "image/png",
              bytes: result.qrImageBase64,
            },
          },
        ]
      : [];
  return reply(
    "input-required",
    textParts(
      ...intro,
      "",
      "**Show the human the QR code** (attached as an image). If you cannot display images, give them this link to open on any screen and scan with the Self app:",
      String(result.scanUrl),
      "",
      `Only on the phone that has the Self app installed, this deep link opens it directly: ${String(result.deepLink)}`,
      "",
      `Session expires at ${String(result.expiresAt)}.`,
      'Then poll every few seconds with { "intent": "status", "sessionToken": "<sessionToken from the data part>" }, each time using the newest sessionToken from the previous reply.',
    ),
    qr,
    dataPart({
      sessionToken: result.sessionToken,
      scanUrl: result.scanUrl,
      deepLink: result.deepLink,
      qrImageIncluded: qr.length > 0,
      expiresAt: result.expiresAt,
      timeRemainingMs: result.timeRemainingMs,
      ...extra,
      pollHint: { intent: "status", sessionToken: result.sessionToken },
    }),
  );
}

// ── Intent handlers ─────────────────────────────────────────────────────────

/**
 * Start a registration through POST /api/agent/register.
 *
 * @param ctx - Current request context.
 * @param intent - Parsed register intent (mode, network, keys, disclosures).
 * @param taskId - Task to attach the session to.
 * @returns "input-required" with the QR, or asking for humanAddress when the
 *   mode needs one; "failed" when the route refuses.
 * @throws RateLimitedError / InvalidParamsError from the route (429 / 400).
 */
async function handleRegister(
  ctx: Ctx,
  intent: Extract<Intent, { type: "register" }>,
  taskId: string,
): Promise<Reply> {
  const mode = normalizeMode(intent.mode);
  if (!intent.humanAddress && mode && MODES_REQUIRING_HUMAN.has(mode)) {
    return reply(
      "input-required",
      textParts(
        `Mode "${intent.mode}" needs the human's wallet address (humanAddress, 0x...).`,
        "Provide it, or use wallet-free mode (no wallet needed):",
      ),
      dataPart({
        examples: [
          { intent: "register", network: intent.network, mode: "wallet-free" },
          {
            intent: "register",
            network: intent.network,
            mode: "linked",
            humanAddress: "0xYourAddress...",
          },
        ],
      }),
    );
  }

  const result = await callRoute(ctx, registerPOST, "/api/agent/register", {
    body: {
      mode: intent.mode,
      network: intent.network,
      ...(intent.disclosures !== undefined && {
        disclosures: intent.disclosures,
      }),
      ...(intent.humanAddress !== undefined && {
        humanAddress: intent.humanAddress,
      }),
      ...(intent.ed25519Pubkey !== undefined && {
        ed25519Pubkey: intent.ed25519Pubkey,
      }),
      ...(intent.ed25519Signature !== undefined && {
        ed25519Signature: intent.ed25519Signature,
      }),
    },
  });
  if (!result.ok) {
    return reply(
      "failed",
      textParts(`Registration failed: ${errorText(result.body)}`),
    );
  }

  return sessionStarted(
    taskId,
    "registration",
    [
      "Registration initiated! A human must now verify this agent with the Self app.",
      "(Their passport was scanned when they set up the Self app; they only scan this QR.)",
    ],
    result.body,
    {
      agentAddress: result.body.agentAddress,
      network: result.body.network,
      mode: result.body.mode,
    },
  );
}

/** Status route polled for each flow. */
const STATUS_ROUTES: Record<Flow, { handler: RouteHandler; path: string }> = {
  registration: {
    handler: registerStatusGET,
    path: "/api/agent/register/status",
  },
  deregistration: {
    handler: deregisterStatusGET,
    path: "/api/agent/deregister/status",
  },
  refresh: { handler: refreshStatusGET, path: "/api/agent/refresh/status" },
};

/** Text shown when a flow completes. */
const COMPLETED_TEXT: Record<Flow, string> = {
  registration: "Registration complete! The agent is now verified on-chain.",
  deregistration: "Deregistration complete. The agent NFT has been burned.",
  refresh: "Proof refresh complete. The human proof has been renewed.",
};

/** Session token `type` → A2A flow (identify sessions are not pollable here). */
const FLOW_OF_SESSION: Record<string, Flow | undefined> = {
  register: "registration",
  deregister: "deregistration",
  refresh: "refresh",
};

/**
 * Flow and mode of a session token, read from the token itself so any
 * instance can poll it. Expiry is ignored here so an expired token still
 * reaches its own flow's status route, which answers 410. A token that can't
 * be decrypted at all goes to the registration route, which answers 401.
 *
 * @param token - Session token from the client.
 * @returns The flow, plus the registration mode when the token has one.
 * @throws InvalidParamsError for a valid token of another flow (identify).
 */
function sessionOf(token: string): { flow: Flow; mode?: string } {
  try {
    const session = decryptSession(token, getSessionSecret(), {
      graceMs: Number.MAX_SAFE_INTEGER,
    });
    const flow = FLOW_OF_SESSION[session.type];
    if (!flow) {
      throw new InvalidParamsError(
        "That sessionToken is not for a registration, deregistration or refresh",
      );
    }
    return { flow, mode: session.mode };
  } catch (err) {
    if (err instanceof InvalidParamsError) throw err;
    return { flow: "registration" };
  }
}

/**
 * Poll the status route of a session and translate the stage into a reply.
 *
 * @param ctx - Current request context.
 * @param token - Newest session token.
 * @param taskId - Task whose stored session is being polled (taskId polling);
 *   its stored token is rotated or dropped as the session progresses.
 * @returns "working" with the rotated token; "completed" with the route's
 *   details (and export instructions for server-generated keys); "failed"
 *   when expired, refused or the flow failed.
 * @throws RateLimitedError / InvalidParamsError from the route (429 / 400).
 */
async function handleSessionStatus(
  ctx: Ctx,
  token: string,
  taskId?: string,
): Promise<Reply> {
  const { flow, mode } = sessionOf(token);
  const { handler, path } = STATUS_ROUTES[flow];
  const result = await callRoute(ctx, handler, path, { bearer: token });
  const stage = result.body.stage;

  // Status routes report expiry only as 410 (never a stage of "expired").
  if (result.status === 410) {
    if (taskId) taskSessions.delete(taskId);
    return reply(
      "failed",
      textParts(
        "The session has expired. Start a new one (e.g. send the original intent again).",
      ),
      dataPart({ stage: "expired" }),
    );
  }
  if (!result.ok) {
    return reply(
      "failed",
      textParts(`Status check failed: ${errorText(result.body)}`),
    );
  }

  if (stage === "failed") {
    if (taskId) taskSessions.delete(taskId);
    return reply(
      "failed",
      textParts(
        `The ${flow} did not complete (the agent may have been deregistered).`,
      ),
      dataPart({ stage: "failed" }),
    );
  }

  const rotated = String(result.body.sessionToken);
  if (taskId) remember(taskSessions, taskId, rotated);

  if (stage === "completed") {
    if (taskId) taskSessions.delete(taskId);
    const { humanInstructions: _h, ...details } = result.body;
    // Ed25519 agents bring their own key; every other mode's key was
    // generated by the server and must be exported.
    const exportable =
      flow === "registration" && !normalizeMode(mode)?.startsWith("ed25519");
    return reply(
      "completed",
      textParts(
        COMPLETED_TEXT[flow],
        ...(typeof result.body.agentId === "number"
          ? [`Agent ID: ${result.body.agentId}`]
          : []),
        ...(exportable
          ? [
              "The server generated this agent's key: export it within 30 minutes with POST /api/agent/register/export and Authorization: Bearer <sessionToken from the data part>.",
            ]
          : []),
      ),
      dataPart(details),
    );
  }

  return reply(
    "working",
    textParts(
      `In progress (stage: ${String(stage)}).`,
      "Waiting for the human to scan the QR code with the Self app (and for the proof to land on-chain).",
      "Poll again in 3-5 seconds.",
    ),
    dataPart({
      stage,
      sessionToken: rotated,
      expiresAt: result.body.expiresAt,
      timeRemainingMs: result.body.timeRemainingMs,
      pollHint: { intent: "status", sessionToken: rotated },
    }),
  );
}

/**
 * Reply for an agent that does not exist on the target chain.
 *
 * @param target - Requested agent and chain.
 * @returns A "completed" reply carrying the not-found error.
 */
function notFound(target: AgentTarget): Reply {
  const { agentId } = target;
  return reply(
    "completed",
    textParts(`Agent #${agentId} not found on chain ${target.chainId}.`),
    dataPart({
      // JSON number when exact; ids past 2^53 (never minted) stay strings.
      agentId:
        agentId <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(agentId)
          : agentId.toString(),
      chainId: target.chainId,
      error: ERRORS.agentNotFound,
    }),
  );
}

/**
 * Log an RPC error and reply with a generic failure.
 *
 * @param err - The RPC error.
 * @returns A "failed" reply.
 */
function rpcFailure(err: unknown): Reply {
  console.error("[a2a] RPC error:", err);
  return reply("failed", textParts("Could not read the chain (RPC error)."));
}

/**
 * Build an agent target from a parsed intent.
 *
 * @param agentId - Agent ID.
 * @param chainId - Supported chain ID (decimal string).
 * @returns The target with its chain config.
 */
function toTarget(agentId: bigint, chainId: string): AgentTarget {
  return { agentId, chainId: Number(chainId), config: CHAIN_CONFIG[chainId] };
}

/**
 * Days left on a proof and whether that is within the 30-day warning window.
 *
 * @param proofExpiresAt - ISO expiry, or null when unset.
 * @returns {daysUntilExpiry (null when unset; negative once expired),
 *   isExpiringSoon}.
 */
function expiryInfo(proofExpiresAt: string | null) {
  const days =
    proofExpiresAt === null
      ? null
      : Math.floor((Date.parse(proofExpiresAt) - Date.now()) / 86_400_000);
  return {
    daysUntilExpiry: days,
    isExpiringSoon: days !== null && days >= 0 && days <= 30,
  };
}

/**
 * Report an agent's full on-chain details (lookup intent).
 *
 * @param target - Agent to read.
 * @returns "completed" with a text summary and the details as data;
 *   not-found or "failed" (RPC error) otherwise.
 */
async function handleLookup(target: AgentTarget): Promise<Reply> {
  try {
    const { rpc, registry } = connectRegistry(target.chainId, target.config);
    const [state, rawCredentials] = await Promise.all([
      readAgentState(registry, target),
      registry.getAgentCredentials(target.agentId),
    ]);
    const strength = state.hasHumanProof
      ? await readProviderStrength(rpc, state.proofProvider)
      : { verificationStrength: 0, strengthLabel: "None" };
    const credentials = publicCredentials(rawCredentials);
    const network = networkOf(target);
    const { daysUntilExpiry, isExpiringSoon } = expiryInfo(
      state.proofExpiresAt,
    );

    return reply(
      "completed",
      textParts(
        `Agent #${state.agentId} on ${network}:`,
        `- Address: ${state.agentAddress}`,
        `- Verified: ${state.isVerified ? "Yes" : state.hasHumanProof ? "No (proof expired)" : "No"}`,
        `- Verification: ${strength.strengthLabel} (${strength.verificationStrength})`,
        `- Nationality: ${credentials.nationality ?? "Not disclosed"}`,
        `- Age verified: ${credentials.olderThan > 0 ? `${credentials.olderThan}+` : "No"}`,
        `- OFAC screened: ${credentials.ofac[0] ? "Yes" : "No"}`,
        `- Registered at block: ${state.registeredAtBlock}`,
        ...(state.proofExpiresAt
          ? [
              `- Proof expires: ${state.proofExpiresAt} (${daysUntilExpiry} days)`,
            ]
          : []),
        ...(isExpiringSoon
          ? ["- WARNING: Proof is expiring soon! Consider refreshing."]
          : []),
      ),
      dataPart({
        ...state,
        ...strength,
        daysUntilExpiry,
        isExpiringSoon,
        credentials,
        network,
      }),
    );
  } catch (err) {
    return err instanceof AgentNotFoundError
      ? notFound(target)
      : rpcFailure(err);
  }
}

/**
 * Report whether an agent has a fresh human proof (verify intent).
 *
 * @param target - Agent to read.
 * @returns "completed" with the proof state; not-found or "failed" (RPC
 *   error) otherwise.
 */
async function handleVerify(target: AgentTarget): Promise<Reply> {
  try {
    const { registry } = connectRegistry(target.chainId, target.config);
    const state = await readAgentState(registry, target);
    const { daysUntilExpiry, isExpiringSoon } = expiryInfo(
      state.proofExpiresAt,
    );
    return reply(
      "completed",
      textParts(
        state.isVerified
          ? `Agent #${state.agentId} is verified with a valid, fresh human proof.`
          : state.hasHumanProof
            ? `Agent #${state.agentId} has a human proof but it has expired.`
            : `Agent #${state.agentId} does not have a human proof.`,
        ...(state.proofExpiresAt
          ? [
              `Proof expires: ${state.proofExpiresAt} (${daysUntilExpiry} days remaining)`,
            ]
          : []),
        ...(isExpiringSoon
          ? ["WARNING: Proof is expiring soon! Consider refreshing."]
          : []),
      ),
      dataPart({
        agentId: state.agentId,
        chainId: state.chainId,
        isVerified: state.isVerified,
        hasHumanProof: state.hasHumanProof,
        isProofFresh: state.isProofFresh,
        proofExpiresAt: state.proofExpiresAt,
        daysUntilExpiry,
        isExpiringSoon,
      }),
    );
  } catch (err) {
    return err instanceof AgentNotFoundError
      ? notFound(target)
      : rpcFailure(err);
  }
}

/**
 * Report days until an agent's proof expires (freshness intent), suggesting
 * refresh-proof when expired or within 30 days.
 *
 * @param target - Agent to read.
 * @returns "completed" with freshness data (and `nextStep` when a refresh is
 *   due); not-found or "failed" (RPC error) otherwise.
 */
async function handleCheckFreshness(target: AgentTarget): Promise<Reply> {
  try {
    const { registry } = connectRegistry(target.chainId, target.config);
    const state = await readAgentState(registry, target);
    const { daysUntilExpiry } = expiryInfo(state.proofExpiresAt);
    const isExpired = !state.isProofFresh;
    const isWarning =
      !isExpired && daysUntilExpiry !== null && daysUntilExpiry <= 30;
    const refreshStep = {
      intent: "refresh-proof",
      agentId: state.agentId,
      chainId: state.chainId,
    };
    return reply(
      "completed",
      textParts(
        isExpired
          ? `Agent #${state.agentId} proof has EXPIRED${state.proofExpiresAt ? ` (${state.proofExpiresAt})` : ""}.`
          : `Agent #${state.agentId} proof is fresh. Expires in ${daysUntilExpiry} days (${state.proofExpiresAt}).`,
        ...(isExpired || isWarning
          ? [
              `Refresh it (the human scans a new QR): ${JSON.stringify(refreshStep)}`,
            ]
          : []),
      ),
      dataPart({
        agentId: state.agentId,
        chainId: state.chainId,
        hasHumanProof: state.hasHumanProof,
        isProofFresh: state.isProofFresh,
        isExpired,
        isWarning,
        remainingDays: daysUntilExpiry,
        proofExpiresAt: state.proofExpiresAt,
        ...((isExpired || isWarning) && { nextStep: refreshStep }),
      }),
    );
  } catch (err) {
    return err instanceof AgentNotFoundError
      ? notFound(target)
      : rpcFailure(err);
  }
}

/**
 * Network name of a target's chain. Targets come from CHAIN_CONFIG, so the
 * chain always maps to a network.
 *
 * @param target - Agent target.
 * @returns "mainnet" or "testnet".
 */
function networkOf(target: AgentTarget): "mainnet" | "testnet" {
  return networkForChainId(target.chainId)!;
}

/**
 * Start a deregistration through POST /api/agent/deregister, after checking
 * the agent exists.
 *
 * @param ctx - Current request context.
 * @param target - Agent to deregister.
 * @param taskId - Task to attach the session to.
 * @returns "input-required" with the QR; not-found, or "failed" when the
 *   read or the route fails.
 * @throws RateLimitedError / InvalidParamsError from the route (429 / 400).
 */
async function handleDeregister(
  ctx: Ctx,
  target: AgentTarget,
  taskId: string,
): Promise<Reply> {
  try {
    const { registry } = connectRegistry(target.chainId, target.config);
    await readAgentState(registry, target); // not-found check
  } catch (err) {
    return err instanceof AgentNotFoundError
      ? notFound(target)
      : rpcFailure(err);
  }

  const result = await callRoute(ctx, deregisterPOST, "/api/agent/deregister", {
    body: { agentId: Number(target.agentId), network: networkOf(target) },
  });
  if (!result.ok) {
    return reply(
      "failed",
      textParts(`Deregistration failed: ${errorText(result.body)}`),
    );
  }
  return sessionStarted(
    taskId,
    "deregistration",
    [
      `Deregistration initiated for Agent #${target.agentId}.`,
      "WARNING: This is permanent. The NFT will be burned and all on-chain proof data removed.",
    ],
    result.body,
    { agentId: Number(target.agentId), action: "deregister" },
  );
}

/**
 * Start a proof refresh through POST /api/agent/refresh.
 *
 * @param ctx - Current request context.
 * @param target - Agent to refresh.
 * @param taskId - Task to attach the session to.
 * @returns "input-required" with the QR; not-found on a 404, "failed" when
 *   the route refuses.
 * @throws RateLimitedError / InvalidParamsError from the route (429 / 400).
 */
async function handleRefreshProof(
  ctx: Ctx,
  target: AgentTarget,
  taskId: string,
): Promise<Reply> {
  const result = await callRoute(ctx, refreshPOST, "/api/agent/refresh", {
    body: { agentId: Number(target.agentId), network: networkOf(target) },
  });
  if (result.status === 404) return notFound(target);
  if (!result.ok) {
    return reply(
      "failed",
      textParts(`Proof refresh failed: ${errorText(result.body)}`),
    );
  }
  return sessionStarted(
    taskId,
    "refresh",
    [
      `Proof refresh initiated for Agent #${target.agentId}.`,
      "The human scans the QR with the Self app; the on-chain proof expiry is then renewed.",
    ],
    result.body,
    {
      agentId: Number(target.agentId),
      network: networkOf(target),
      action: "refresh-proof",
    },
  );
}

/** Reply to a register request with no mode: lists the modes. */
const REGISTER_ASK = reply(
  "input-required",
  textParts(
    "I can register an AI agent with proof-of-human verification on the Self protocol. Pick a mode:",
    "",
    '- wallet-free: no keys or wallet needed; the server generates the agent key. { "intent": "register", "mode": "wallet-free" }',
    '- linked: the human\'s wallet owns the agent. { "intent": "register", "mode": "linked", "humanAddress": "0x..." }',
    "- ed25519 / ed25519-linked: bring your own Ed25519 key. First POST /api/agent/register/ed25519-challenge with { pubkey, network }, sign the returned challengeHash bytes, then send ed25519Pubkey (64 hex) and ed25519Signature (128 hex).",
    "",
    `Add "network": "testnet" for Celo Sepolia (mock documents allowed) or "network": "mainnet" for Celo; the default is ${DEFAULT_API_NETWORK}.`,
  ),
  dataPart({
    examples: [
      { intent: "register", mode: "wallet-free", network: "testnet" },
      {
        intent: "register",
        mode: "linked",
        humanAddress: "0xYourWallet...",
        network: "testnet",
      },
      {
        intent: "register",
        mode: "ed25519",
        ed25519Pubkey: "<64-hex public key>",
        ed25519Signature: "<128-hex signature of challengeHash>",
        network: "testnet",
      },
    ],
  }),
);

/** Reply to the help intent. */
const HELP = reply(
  "completed",
  textParts(
    "Self Agent ID Registry — A2A v0.3.0 Endpoint",
    "",
    'Send intents as a data part, e.g. { intent: "lookup", agentId: 1 }, or in plain English.',
    "",
    "1. register — human-verified on-chain identity. Modes: wallet-free (default), linked (needs humanAddress), ed25519 / ed25519-linked (needs ed25519Pubkey + ed25519Signature over the challenge from POST /api/agent/register/ed25519-challenge), privy / smartwallet (like linked).",
    `   Networks: "mainnet" (real passport in the Self app) or "testnet" (Celo Sepolia; the Self app can create mock documents). Default: ${DEFAULT_API_NETWORK}.`,
    '2. status — poll a register / deregister / refresh-proof session with the newest sessionToken from the previous reply: { intent: "status", sessionToken }',
    '3. lookup — full on-chain details: { intent: "lookup", agentId: 1 }',
    '4. verify — fresh human proof? { intent: "verify", agentId: 1 }',
    '5. freshness — days until the proof expires: { intent: "freshness", agentId: 1 }',
    '6. refresh-proof — renew an agent\'s proof (human scans a QR): { intent: "refresh-proof", agentId: 1 }',
    '7. deregister — permanently burn an agent (human confirms in the Self app): { intent: "deregister", agentId: 1 }',
    "",
    `Agent queries default to ${DEFAULT_API_NETWORK} (chainId ${DEFAULT_CHAIN_ID}); pass chainId (42220 Celo, 11142220 Celo Sepolia) or network to choose.`,
  ),
);

/** Reply when no intent matched. */
const UNKNOWN = reply(
  "completed",
  textParts(
    "I didn't understand that request.",
    'Send { intent: "help" } to see what I can do. Quick examples:',
  ),
  dataPart({
    examples: [
      { intent: "register", mode: "wallet-free", network: "testnet" },
      { intent: "lookup", agentId: 1 },
      { intent: "verify", agentId: 1 },
      { intent: "freshness", agentId: 1 },
      { intent: "refresh-proof", agentId: 1 },
      { intent: "deregister", agentId: 1 },
      { intent: "help" },
    ],
  }),
);

/**
 * Dispatch a parsed intent to its handler. Agent reads spend the per-IP read
 * budget; refresh-proof is limited by the refresh route itself.
 *
 * @param ctx - Current request context.
 * @param intent - Parsed intent.
 * @param taskId - ID of the task being created.
 * @returns The handler's reply.
 * @throws InvalidParamsError for an unknown taskId; RateLimitedError when
 *   the read budget or a called route is exhausted.
 */
async function handleIntent(
  ctx: Ctx,
  intent: Intent,
  taskId: string,
): Promise<Reply> {
  switch (intent.type) {
    case "register":
      return handleRegister(ctx, intent, taskId);
    case "register-ask":
      return REGISTER_ASK;
    case "status": {
      const token = taskSessions.get(intent.taskId);
      if (!token) {
        throw new InvalidParamsError(
          'Unknown or finished taskId (task state is kept per server instance). Poll with { "intent": "status", "sessionToken": "<newest sessionToken from the task\'s data part>" } instead.',
        );
      }
      return handleSessionStatus(ctx, token, intent.taskId);
    }
    case "session-status":
      return handleSessionStatus(ctx, intent.sessionToken);
    case "lookup":
    case "verify":
    case "check-freshness":
    case "deregister":
    case "refresh-proof": {
      const target = toTarget(intent.agentId, intent.chainId);
      // Registry ids are sequential: ids past 2^53 cannot exist (as in REST).
      if (target.agentId > BigInt(Number.MAX_SAFE_INTEGER)) {
        return notFound(target);
      }
      if (intent.type === "refresh-proof") {
        return handleRefreshProof(ctx, target, taskId); // route limits itself
      }
      const rl = await checkReadLimit(getClientIp(ctx.req));
      if (!rl.allowed) throw new RateLimitedError(rl.retryAfterMs);
      if (intent.type === "lookup") return handleLookup(target);
      if (intent.type === "verify") return handleVerify(target);
      if (intent.type === "check-freshness") {
        return handleCheckFreshness(target);
      }
      return handleDeregister(ctx, target, taskId);
    }
    case "help":
      return HELP;
    default:
      return UNKNOWN;
  }
}

// ── Optional caller verification ────────────────────────────────────────────

/**
 * Check the X-Agent-Id caller on the default network.
 *
 * @param agentIdHeader - Raw X-Agent-Id header value.
 * @returns null when the agent has a fresh human proof, else the reason
 *   (invalid ID, not found, no proof, expired proof, RPC failure).
 */
async function verifyCallingAgent(
  agentIdHeader: string,
): Promise<string | null> {
  const id = validateAgentId(agentIdHeader);
  if (id === null) return ERRORS.invalidAgentId;
  if (id > BigInt(Number.MAX_SAFE_INTEGER)) return ERRORS.agentNotFound;
  const chainId = DEFAULT_CHAIN_ID;
  try {
    const { registry } = connectRegistry(
      Number(chainId),
      CHAIN_CONFIG[chainId],
    );
    const [hasProof, isFresh] = await Promise.all([
      registry.hasHumanProof(id),
      registry.isProofFresh(id),
    ]);
    if (!hasProof) {
      // hasHumanProof is false for ids that were never minted or were burned.
      const key = await registry.agentIdToAgentKey(id);
      return BigInt(key) === 0n
        ? ERRORS.agentNotFound
        : "Agent does not have a human proof";
    }
    if (!isFresh) return "Agent proof has expired";
    return null;
  } catch (err) {
    console.error("[a2a] X-Agent-Id check failed:", err);
    return "Failed to verify agent on-chain";
  }
}

// ── JSON-RPC plumbing ───────────────────────────────────────────────────────

/** JSON-RPC request id (null when absent or unreadable). */
type RpcId = string | number | null;

/**
 * Build a JSON-RPC success response.
 *
 * @param id - Request id to echo.
 * @param result - Method result.
 * @returns 200 with the result.
 */
function rpcResult(id: RpcId, result: unknown): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, result },
    { headers: HEADERS },
  );
}

/**
 * Build a JSON-RPC error response.
 *
 * @param id - Request id to echo.
 * @param code - JSON-RPC / A2A error code.
 * @param message - Error message.
 * @param httpStatus - HTTP status to send.
 * @returns The error response.
 */
function rpcError(
  id: RpcId,
  code: number,
  message: string,
  httpStatus: number,
): NextResponse {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status: httpStatus, headers: HEADERS },
  );
}

/**
 * HTTP 429 + Retry-After, with the wait in error.data for JSON-RPC clients.
 *
 * @param id - Request id to echo.
 * @param retryAfterMs - Time until the limit resets.
 * @returns 429 with JSON-RPC error -32000 and data.retryAfterMs.
 */
function rateLimited(id: RpcId, retryAfterMs: number): NextResponse {
  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: RATE_LIMITED,
        message: "Rate limit exceeded. Try again later.",
        data: { retryAfterMs },
      },
    },
    {
      status: 429,
      headers: {
        ...HEADERS,
        "Retry-After": String(Math.max(1, Math.ceil(retryAfterMs / 1000))),
      },
    },
  );
}

/**
 * Check for a plain (non-array, non-null) object.
 *
 * @param v - Value to test.
 * @returns True for plain objects.
 */
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Wrap a reply into an A2A task.
 *
 * @param taskId - New task ID.
 * @param contextId - Conversation context ID.
 * @param userMessage - The (normalised) incoming message.
 * @param r - The intent handler's reply.
 * @returns The task, with history [user message, agent message].
 */
function makeTask(
  taskId: string,
  contextId: string,
  userMessage: Message,
  r: Reply,
): Task {
  const agentMessage: Message = {
    kind: "message",
    messageId: randomUUID(),
    role: "agent",
    parts: r.parts,
    taskId,
    contextId,
  };
  return {
    kind: "task",
    id: taskId,
    contextId,
    status: {
      state: r.state,
      message: agentMessage,
      timestamp: new Date().toISOString(),
    },
    history: [userMessage, agentMessage],
  };
}

/**
 * Handle message/send: validate the message, rate-limit, run the intent and
 * store the resulting task.
 *
 * @param ctx - Current request context.
 * @param id - JSON-RPC request id.
 * @param params - JSON-RPC params ({message: {role, parts, contextId?,
 *   messageId?}}).
 * @returns 200 {result: Task}; 400 INVALID_PARAMS; 429 rate limited;
 *   500 INTERNAL_ERROR.
 */
async function sendMessage(
  ctx: Ctx,
  id: RpcId,
  params: unknown,
): Promise<NextResponse> {
  const message = isObject(params) ? params.message : undefined;
  if (!isObject(message) || !Array.isArray(message.parts)) {
    return rpcError(
      id,
      A2AErrorCodes.INVALID_PARAMS,
      "params.message with a parts array is required",
      400,
    );
  }
  if (message.role !== "user" && message.role !== "agent") {
    return rpcError(
      id,
      A2AErrorCodes.INVALID_PARAMS,
      'message.role must be "user" or "agent"',
      400,
    );
  }

  const taskId = randomUUID();
  const contextId =
    typeof message.contextId === "string" && message.contextId
      ? message.contextId
      : randomUUID();
  const userMessage = {
    kind: "message",
    messageId:
      typeof message.messageId === "string" ? message.messageId : randomUUID(),
    role: message.role,
    parts: (message.parts as unknown[]).map((p) =>
      isObject(p) ? { ...p, kind: partKind(p) } : p,
    ),
    taskId,
    contextId,
  } as Message;

  // Bounds RPC spend and how fast one caller can churn the task store.
  const rl = await checkRateLimit({
    key: `a2a-send:${getClientIp(ctx.req)}`,
    limit: SEND_LIMIT,
    windowMs: 60_000,
  });
  if (!rl.allowed) return rateLimited(id, rl.retryAfterMs);

  let result: Reply;
  try {
    result = await handleIntent(ctx, parseIntent(message.parts), taskId);
  } catch (err) {
    if (err instanceof InvalidParamsError) {
      return rpcError(id, A2AErrorCodes.INVALID_PARAMS, err.message, 400);
    }
    if (err instanceof RateLimitedError) {
      return rateLimited(id, err.retryAfterMs);
    }
    console.error("[a2a] message/send failed:", err);
    return rpcError(id, A2AErrorCodes.INTERNAL_ERROR, "Internal error", 500);
  }

  const task = makeTask(taskId, contextId, userMessage, result);
  remember(taskStore, taskId, task);
  return rpcResult(id, task);
}

/**
 * Handle tasks/get from this instance's task store.
 *
 * @param id - JSON-RPC request id.
 * @param params - JSON-RPC params ({id, historyLength?}).
 * @returns 200 {result: Task} (history trimmed to historyLength);
 *   400 INVALID_PARAMS; 404 TASK_NOT_FOUND.
 */
function getTask(id: RpcId, params: unknown): NextResponse {
  const taskId = isObject(params) ? params.id : undefined;
  if (typeof taskId !== "string") {
    return rpcError(
      id,
      A2AErrorCodes.INVALID_PARAMS,
      "params.id is required",
      400,
    );
  }
  const task = taskStore.get(taskId);
  if (!task) {
    return rpcError(id, A2AErrorCodes.TASK_NOT_FOUND, "Task not found", 404);
  }
  const historyLength = isObject(params) ? params.historyLength : undefined;
  if (
    typeof historyLength === "number" &&
    Number.isInteger(historyLength) &&
    historyLength >= 0
  ) {
    return rpcResult(id, {
      ...task,
      history: historyLength === 0 ? [] : task.history.slice(-historyLength),
    });
  }
  return rpcResult(id, task);
}

/**
 * Handle tasks/cancel: mark an unfinished task canceled and forget its
 * session (the session token itself stays pollable).
 *
 * @param id - JSON-RPC request id.
 * @param params - JSON-RPC params ({id}).
 * @returns 200 {result: Task}; 400 INVALID_PARAMS; 404 TASK_NOT_FOUND;
 *   409 TASK_NOT_CANCELABLE.
 */
function cancelTask(id: RpcId, params: unknown): NextResponse {
  const taskId = isObject(params) ? params.id : undefined;
  if (typeof taskId !== "string") {
    return rpcError(
      id,
      A2AErrorCodes.INVALID_PARAMS,
      "params.id is required",
      400,
    );
  }
  const task = taskStore.get(taskId);
  if (!task) {
    return rpcError(id, A2AErrorCodes.TASK_NOT_FOUND, "Task not found", 404);
  }
  if (["completed", "canceled", "failed"].includes(task.status.state)) {
    return rpcError(
      id,
      A2AErrorCodes.TASK_NOT_CANCELABLE,
      `Task not cancelable: already ${task.status.state}`,
      409,
    );
  }
  taskSessions.delete(taskId);
  const canceled: Task = {
    ...task,
    status: {
      state: "canceled",
      message: {
        kind: "message",
        messageId: randomUUID(),
        role: "agent",
        parts: textParts("Task canceled by request."),
        taskId,
        contextId: task.contextId,
      },
      timestamp: new Date().toISOString(),
    },
  };
  remember(taskStore, taskId, canceled);
  return rpcResult(id, canceled);
}

// ── Route handlers ───────────────────────────────────────────────────────────

/**
 * Validate the JSON-RPC request (Content-Type, optional X-Agent-Id, body) and
 * dispatch the method.
 *
 * @param req - JSON-RPC 2.0 request ({jsonrpc: "2.0", id?, method, params}).
 * @returns The method's response; 400 PARSE_ERROR / INVALID_REQUEST /
 *   UNSUPPORTED_OPERATION (message/stream); 403 X-Agent-Id not verified;
 *   404 METHOD_NOT_FOUND; 413 body over 64 KB; 415 not application/json;
 *   429 rate limited.
 */
export async function POST(req: NextRequest) {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (!contentType.includes("application/json")) {
    return rpcError(
      null,
      A2AErrorCodes.CONTENT_TYPE_NOT_SUPPORTED,
      "Content-Type must be application/json",
      415,
    );
  }

  const callerAgentId = req.headers.get("x-agent-id");
  if (callerAgentId) {
    // The check costs on-chain reads, so it spends the caller's read budget.
    const rl = await checkReadLimit(getClientIp(req));
    if (!rl.allowed) return rateLimited(null, rl.retryAfterMs);
    const failure = await verifyCallingAgent(callerAgentId);
    if (failure) {
      return rpcError(
        null,
        A2AErrorCodes.INVALID_REQUEST,
        `Agent verification failed: ${failure}`,
        403,
      );
    }
  }

  const parsed = await readJsonObjectBody(req, MAX_BODY_BYTES);
  if (!parsed.ok) {
    return parsed.response.status === 413
      ? rpcError(
          null,
          A2AErrorCodes.INVALID_REQUEST,
          "Request body too large",
          413,
        )
      : rpcError(
          null,
          A2AErrorCodes.PARSE_ERROR,
          "Request body must be a JSON-RPC 2.0 request object",
          400,
        );
  }
  const body = parsed.body;
  const id: RpcId =
    typeof body.id === "string" || typeof body.id === "number" ? body.id : null;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return rpcError(
      id,
      A2AErrorCodes.INVALID_REQUEST,
      'Expected { "jsonrpc": "2.0", "method": ..., "params": ... }',
      400,
    );
  }

  const ctx: Ctx = { req, baseUrl: getAppBaseUrl(req) };
  switch (body.method) {
    case "message/send":
      return sendMessage(ctx, id, body.params);
    case "tasks/get":
      return getTask(id, body.params);
    case "tasks/cancel":
      return cancelTask(id, body.params);
    case "message/stream":
      return rpcError(
        id,
        A2AErrorCodes.UNSUPPORTED_OPERATION,
        "Streaming is not supported; use message/send",
        400,
      );
    default:
      return rpcError(
        id,
        A2AErrorCodes.METHOD_NOT_FOUND,
        "Method not found",
        404,
      );
  }
}

/**
 * Answer the CORS preflight, also allowing the X-Agent-Id header.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  const res = corsResponse();
  res.headers.set(
    "Access-Control-Allow-Headers",
    HEADERS["Access-Control-Allow-Headers"],
  );
  return res;
}
