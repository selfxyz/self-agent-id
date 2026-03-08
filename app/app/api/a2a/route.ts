// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { type NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import QRCode from "qrcode";
import {
  A2AServer,
  A2AErrorCodes,
  getProviderLabel,
  type TaskHandler,
  type Message,
  type Task,
  type Part,
  type JSONRPCResponse,
  type TaskPushNotificationConfig,
} from "@selfxyz/agent-sdk";
import { typedRegistry, typedProvider } from "@/lib/contract-types";
import { CHAIN_CONFIG } from "@/lib/chain-config";
import { DEFAULT_NETWORK, NETWORKS } from "@/lib/network";

// ── CORS headers ────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Agent-Id",
  "Cache-Control": "no-store",
} as const;

// ── In-memory task store ────────────────────────────────────────────────────

const taskStore = new Map<string, Task>();
// Maps taskId → session token for automatic status polling
const taskSessionStore = new Map<string, string>();
// Maps taskId → push notification config for webhook delivery
const taskPushConfigStore = new Map<string, TaskPushNotificationConfig>();
let taskCounter = 0;

function generateTaskId(): string {
  taskCounter += 1;
  return `task-${Date.now()}-${taskCounter}`;
}

// ── QR code generation ──────────────────────────────────────────────────────

async function generateQRBase64(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    width: 400,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });
}

// ── Push notification delivery ──────────────────────────────────────────────

async function sendPushNotification(
  config: TaskPushNotificationConfig,
  task: Task,
): Promise<void> {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (config.token) {
      headers["Authorization"] = `Bearer ${config.token}`;
    }
    if (config.authentication?.credentials) {
      headers["Authorization"] = config.authentication.credentials;
    }
    await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        taskId: task.id,
        status: task.status,
        artifacts: task.artifacts,
      }),
    });
  } catch {
    // Push notification delivery is best-effort
  }
}

// ── Intent detection ────────────────────────────────────────────────────────

type Intent =
  | { type: "register"; network: string; humanAddress?: string; mode?: string; pushConfig?: TaskPushNotificationConfig }
  | { type: "register-status"; sessionToken: string }
  | { type: "register-poll"; taskId: string }
  | { type: "lookup"; agentId: number; chainId?: number }
  | { type: "verify"; agentId: number; chainId?: number }
  | { type: "help" }
  | { type: "unknown"; text: string };

function extractText(message: Message): string {
  return message.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join(" ")
    .trim();
}

function extractData(message: Message): Record<string, unknown> | null {
  const dataPart = message.parts.find((p) => p.type === "data");
  if (dataPart && dataPart.type === "data") return dataPart.data;
  return null;
}

function parseIntent(message: Message): Intent {
  const text = extractText(message).toLowerCase();
  const data = extractData(message);

  // Structured data takes priority (for programmatic agent callers)
  if (data) {
    const intent = data.intent as string | undefined;
    if (intent === "register" || intent === "registration") {
      return {
        type: "register",
        network: (data.network as string) || "testnet",
        humanAddress: data.humanAddress as string | undefined,
        mode: (data.mode as string) || "agent-identity",
        pushConfig: data.pushNotificationUrl
          ? { url: data.pushNotificationUrl as string, token: data.pushNotificationToken as string | undefined }
          : undefined,
      };
    }
    if (intent === "register-status" || intent === "status") {
      // Support polling by taskId (auto-resolves session token)
      if (data.taskId) {
        return { type: "register-poll", taskId: data.taskId as string };
      }
      if (data.sessionToken) {
        return {
          type: "register-status",
          sessionToken: data.sessionToken as string,
        };
      }
      return { type: "unknown", text: "Please provide either a taskId or sessionToken to check status." };
    }
    if (intent === "lookup" || intent === "info") {
      return {
        type: "lookup",
        agentId: Number(data.agentId),
        chainId: data.chainId ? Number(data.chainId) : undefined,
      };
    }
    if (intent === "verify" || intent === "check") {
      return {
        type: "verify",
        agentId: Number(data.agentId),
        chainId: data.chainId ? Number(data.chainId) : undefined,
      };
    }
  }

  // Natural language parsing
  if (
    text.includes("register") ||
    text.includes("sign up") ||
    text.includes("create agent") ||
    text.includes("new agent")
  ) {
    // Extract address if present (0x...)
    const addrMatch = text.match(/0x[a-fA-F0-9]{40}/);
    const network = text.includes("mainnet") ? "mainnet" : "testnet";
    return {
      type: "register",
      network,
      humanAddress: addrMatch?.[0],
      mode: text.includes("simple") ? "simple" : "agent-identity",
    };
  }

  if (text.includes("status") && text.includes("registration")) {
    // Look for session token in data parts
    const token = data?.sessionToken as string | undefined;
    if (token) return { type: "register-status", sessionToken: token };
    return { type: "unknown", text: "Please provide your session token to check registration status. Send a data part with { intent: 'register-status', sessionToken: '<token>' }." };
  }

  // "look up agent #5" / "info agent 5" / "agent 5"
  const lookupMatch = text.match(
    /(?:look\s*up|info|details|get|fetch|card)\s+(?:agent\s*)?#?(\d+)/,
  );
  if (lookupMatch) {
    const chainId = text.includes("mainnet") ? 42220 : text.includes("testnet") ? 11142220 : undefined;
    return { type: "lookup", agentId: Number(lookupMatch[1]), chainId };
  }

  // "verify agent 5" / "is agent 5 verified" / "check agent 5" / "has human proof"
  const verifyMatch = text.match(
    /(?:verify|check|is|has|does)\s+(?:agent\s*)?#?(\d+)/,
  );
  if (verifyMatch) {
    const chainId = text.includes("mainnet") ? 42220 : text.includes("testnet") ? 11142220 : undefined;
    return { type: "verify", agentId: Number(verifyMatch[1]), chainId };
  }

  if (
    text.includes("help") ||
    text.includes("what can you do") ||
    text.includes("capabilities")
  ) {
    return { type: "help" };
  }

  return { type: "unknown", text };
}

// ── Intent handlers ─────────────────────────────────────────────────────────

function textParts(...texts: string[]): Part[] {
  return texts.map((t) => ({ type: "text" as const, text: t }));
}

function dataPart(data: Record<string, unknown>): Part {
  return { type: "data" as const, data };
}

function resolveChainConfig(chainId?: number) {
  const cid = chainId
    ? String(chainId)
    : String(NETWORKS[DEFAULT_NETWORK].chainId);
  const config = CHAIN_CONFIG[cid];
  return { chainId: cid, config };
}

/** Derive the app's base URL from the incoming request or env. */
function getAppBaseUrl(req?: NextRequest): string {
  // Explicit env var takes priority
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  // Derive from request headers (works on Vercel preview deployments)
  if (req) {
    const proto = req.headers.get("x-forwarded-proto") || "https";
    const host = req.headers.get("host");
    if (host) return `${proto}://${host}`;
  }
  return "https://selfagentid.xyz";
}

async function handleRegister(
  intent: Extract<Intent, { type: "register" }>,
  taskId: string,
  req?: NextRequest,
): Promise<Task> {
  if (!intent.humanAddress) {
    // Need human address — return input-required
    return {
      id: taskId,
      status: {
        state: "input-required",
        message: {
          role: "agent",
          parts: [
            ...textParts(
              "To register an agent, I need the human wallet address that will verify this agent.",
              "Please provide your Ethereum address (0x...).",
              "You can also send a structured request:",
            ),
            dataPart({
              example: {
                intent: "register",
                network: "testnet",
                humanAddress: "0xYourAddress...",
                mode: "agent-identity",
              },
            }),
          ],
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  // Call the registration API internally
  const appUrl = getAppBaseUrl(req);
  try {
    const fetchHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    // Forward Vercel deployment protection bypass (one-time project env var)
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypassSecret) {
      fetchHeaders["x-vercel-protection-bypass"] = bypassSecret;
    }
    // Forward cookies from the incoming request (handles SSO auth on previews)
    const cookies = req?.headers.get("cookie");
    if (cookies) {
      fetchHeaders["cookie"] = cookies;
    }

    const res = await fetch(`${appUrl}/api/agent/register`, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify({
        mode: intent.mode || "agent-identity",
        network: intent.network,
        humanAddress: intent.humanAddress,
        disclosures: { minimumAge: 18, ofac: true },
      }),
    });

    const result = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      return {
        id: taskId,
        status: {
          state: "failed",
          message: {
            role: "agent",
            parts: textParts(
              `Registration failed: ${result.error || "Unknown error"}`,
            ),
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    // Store session token for automatic task-based polling
    taskSessionStore.set(taskId, result.sessionToken as string);

    // Store push notification config if provided
    if (intent.pushConfig) {
      taskPushConfigStore.set(taskId, intent.pushConfig);
    }

    // Generate QR code image
    const deepLink = result.deepLink as string;
    let qrParts: Part[] = [];
    try {
      const qrDataUrl = await generateQRBase64(deepLink);
      // Extract base64 from data URL (data:image/png;base64,...)
      const base64 = qrDataUrl.split(",")[1];
      qrParts = [
        {
          type: "file" as const,
          file: {
            name: "registration-qr.png",
            mimeType: "image/png",
            bytes: base64,
          },
        },
      ];
    } catch {
      // QR generation failed — deep link is still available in data
    }

    return {
      id: taskId,
      status: {
        state: "input-required",
        message: {
          role: "agent",
          parts: [
            ...textParts(
              "Registration initiated! A human must now verify this agent using the Self app.",
              "",
              "Steps:",
              "1. Open the Self app on your phone",
              "2. Scan the QR code below (or open the deep link)",
              "3. Follow the prompts to scan your passport",
              "4. Wait for on-chain confirmation",
            ),
            ...qrParts,
            ...textParts(
              "",
              `Deep link: ${deepLink}`,
              "",
              `Session expires at: ${result.expiresAt} (${Math.round((result.timeRemainingMs as number) / 1000)}s remaining)`,
              "",
              "To check status, send one of:",
              `  { "intent": "status", "taskId": "${taskId}" }`,
              `  { "intent": "register-status", "sessionToken": "<token>" }`,
            ),
            dataPart({
              taskId,
              sessionToken: result.sessionToken,
              deepLink,
              agentAddress: result.agentAddress,
              network: result.network,
              mode: result.mode,
              expiresAt: result.expiresAt,
              timeRemainingMs: result.timeRemainingMs,
            }),
          ],
        },
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      id: taskId,
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: textParts(
            `Registration request failed: ${err instanceof Error ? err.message : "Network error"}`,
          ),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }
}

async function handleRegisterStatus(
  sessionToken: string,
  taskId: string,
  originalTaskId?: string,
  req?: NextRequest,
): Promise<Task> {
  const appUrl = getAppBaseUrl(req);
  try {
    const statusHeaders: Record<string, string> = {
      Authorization: `Bearer ${sessionToken}`,
    };
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypassSecret) {
      statusHeaders["x-vercel-protection-bypass"] = bypassSecret;
    }
    const cookies = req?.headers.get("cookie");
    if (cookies) {
      statusHeaders["cookie"] = cookies;
    }

    const res = await fetch(`${appUrl}/api/agent/register/status`, {
      method: "GET",
      headers: statusHeaders,
    });

    const result = (await res.json()) as Record<string, unknown>;

    if (!res.ok) {
      const errorMsg = (result.error as string) || "Unknown error";

      // Detect expired sessions
      if (res.status === 410 || errorMsg.toLowerCase().includes("expired")) {
        // Clean up stores
        if (originalTaskId) {
          taskSessionStore.delete(originalTaskId);
          taskPushConfigStore.delete(originalTaskId);
        }
        return {
          id: taskId,
          status: {
            state: "failed",
            message: {
              role: "agent",
              parts: [
                ...textParts(
                  "Registration session has expired (sessions last 10 minutes).",
                  "Please start a new registration by sending:",
                ),
                dataPart({
                  expired: true,
                  hint: "Send a new register intent to restart",
                  example: {
                    intent: "register",
                    humanAddress: "0x...",
                    network: "testnet",
                  },
                }),
              ],
            },
            timestamp: new Date().toISOString(),
          },
        };
      }

      return {
        id: taskId,
        status: {
          state: "failed",
          message: {
            role: "agent",
            parts: textParts(`Status check failed: ${errorMsg}`),
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    const stage = result.stage as string;

    // Update stored session token (tokens rotate on each poll)
    if (result.sessionToken && originalTaskId) {
      taskSessionStore.set(originalTaskId, result.sessionToken as string);
    }

    if (stage === "completed") {
      // Clean up stores
      if (originalTaskId) {
        taskSessionStore.delete(originalTaskId);
        taskPushConfigStore.delete(originalTaskId);
      }

      const completedTask: Task = {
        id: taskId,
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: [
              ...textParts(
                "Registration complete! The agent is now verified on-chain.",
                `Agent ID: ${result.agentId}`,
              ),
              dataPart({
                stage: "completed",
                agentId: result.agentId,
                agentAddress: result.agentAddress,
                credentials: result.credentials,
              }),
            ],
          },
          timestamp: new Date().toISOString(),
        },
      };

      // Send push notification if configured
      const pushConfig = originalTaskId
        ? taskPushConfigStore.get(originalTaskId)
        : undefined;
      if (pushConfig) {
        await sendPushNotification(pushConfig, completedTask);
      }

      return completedTask;
    }

    if (stage === "failed") {
      if (originalTaskId) {
        taskSessionStore.delete(originalTaskId);
        taskPushConfigStore.delete(originalTaskId);
      }

      const failedTask: Task = {
        id: taskId,
        status: {
          state: "failed",
          message: {
            role: "agent",
            parts: textParts("Registration failed. The proof was rejected or the user cancelled."),
          },
          timestamp: new Date().toISOString(),
        },
      };

      const pushConfig = originalTaskId
        ? taskPushConfigStore.get(originalTaskId)
        : undefined;
      if (pushConfig) {
        await sendPushNotification(pushConfig, failedTask);
      }

      return failedTask;
    }

    // Still in progress (qr-ready or proof-received)
    const timeRemaining = result.timeRemainingMs as number;
    const expiryWarning = timeRemaining < 120_000
      ? `Warning: Session expires in ${Math.round(timeRemaining / 1000)}s. If it expires, you'll need to restart registration.`
      : "";

    return {
      id: taskId,
      status: {
        state: "working",
        message: {
          role: "agent",
          parts: [
            ...textParts(
              `Registration is in progress (stage: ${stage}).`,
              stage === "qr-ready"
                ? "Waiting for the human to scan the QR code with the Self app."
                : "Proof received, waiting for on-chain confirmation...",
              ...(expiryWarning ? [expiryWarning] : []),
              "Poll again in 3-5 seconds.",
            ),
            dataPart({
              stage,
              taskId: originalTaskId || taskId,
              expiresAt: result.expiresAt,
              timeRemainingMs: timeRemaining,
              pollHint: { intent: "status", taskId: originalTaskId || taskId },
            }),
          ],
        },
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    return {
      id: taskId,
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: textParts(
            `Status check failed: ${err instanceof Error ? err.message : "Network error"}`,
          ),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }
}

async function handleLookup(
  agentId: number,
  chainId: number | undefined,
  taskId: string,
): Promise<Task> {
  const { chainId: cid, config } = resolveChainConfig(chainId);
  if (!config) {
    return {
      id: taskId,
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: textParts(`Unsupported chain: ${cid}`),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  try {
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, rpc);

    const [agentKey, hasProof, providerAddr, registeredAt, credentials] =
      await Promise.all([
        registry.agentIdToAgentKey(BigInt(agentId)),
        registry.hasHumanProof(BigInt(agentId)),
        registry.getProofProvider(BigInt(agentId)),
        registry.agentRegisteredAt(BigInt(agentId)),
        registry.getAgentCredentials(BigInt(agentId)) as Promise<{
          nationality: string;
          olderThan: bigint;
          ofac: [boolean, boolean, boolean];
        }>,
      ]);

    if (agentKey === ethers.ZeroHash) {
      return {
        id: taskId,
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: textParts(`Agent #${agentId} not found on chain ${cid}.`),
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    const agentAddress = ethers.getAddress("0x" + agentKey.slice(-40));
    let verificationStrength = 0;
    let strengthLabel = "None";
    if (hasProof && providerAddr !== ethers.ZeroAddress) {
      const provider = typedProvider(providerAddr, rpc);
      verificationStrength = Number(await provider.verificationStrength());
      strengthLabel = getProviderLabel(verificationStrength);
    }

    const networkLabel = cid === "42220" ? "mainnet" : "testnet";

    return {
      id: taskId,
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            ...textParts(
              `Agent #${agentId} on ${networkLabel}:`,
              `- Address: ${agentAddress}`,
              `- Verified: ${hasProof ? "Yes" : "No"}`,
              `- Verification: ${strengthLabel} (${verificationStrength})`,
              `- Nationality: ${credentials.nationality || "Not disclosed"}`,
              `- Age verified: ${Number(credentials.olderThan) > 0 ? `${credentials.olderThan}+` : "No"}`,
              `- OFAC screened: ${credentials.ofac?.[0] ? "Yes" : "No"}`,
              `- Registered: ${new Date(Number(registeredAt) * 1000).toISOString()}`,
            ),
            dataPart({
              agentId,
              chainId: Number(cid),
              agentAddress,
              isVerified: hasProof,
              verificationStrength,
              strengthLabel,
              credentials: {
                nationality: credentials.nationality,
                olderThan: Number(credentials.olderThan),
                ofac: [...credentials.ofac],
              },
              registeredAt: Number(registeredAt),
              network: networkLabel,
            }),
          ],
        },
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("coalesce") || msg.includes("BAD_DATA") || msg.includes("ERC721")) {
      return {
        id: taskId,
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: textParts(`Agent #${agentId} not found on chain ${cid}.`),
          },
          timestamp: new Date().toISOString(),
        },
      };
    }
    return {
      id: taskId,
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: textParts(`Lookup failed: ${msg}`),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }
}

async function handleVerify(
  agentId: number,
  chainId: number | undefined,
  taskId: string,
): Promise<Task> {
  const { chainId: cid, config } = resolveChainConfig(chainId);
  if (!config) {
    return {
      id: taskId,
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: textParts(`Unsupported chain: ${cid}`),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }

  try {
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, rpc);

    const hasProof = await registry.hasHumanProof(BigInt(agentId));

    let isFresh = true;
    try {
      isFresh = await registry.isProofFresh(BigInt(agentId));
    } catch {
      // isProofFresh may not exist on older contracts
    }

    const verified = hasProof && isFresh;

    return {
      id: taskId,
      status: {
        state: "completed",
        message: {
          role: "agent",
          parts: [
            ...textParts(
              verified
                ? `Agent #${agentId} is verified with a valid, fresh human proof.`
                : hasProof && !isFresh
                  ? `Agent #${agentId} has a human proof but it has expired.`
                  : `Agent #${agentId} does not have a human proof.`,
            ),
            dataPart({
              agentId,
              chainId: Number(cid),
              hasHumanProof: hasProof,
              isProofFresh: isFresh,
              isVerified: verified,
            }),
          ],
        },
        timestamp: new Date().toISOString(),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      id: taskId,
      status: {
        state: "failed",
        message: {
          role: "agent",
          parts: textParts(`Verification check failed: ${msg}`),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }
}

function handleHelp(taskId: string): Task {
  return {
    id: taskId,
    status: {
      state: "completed",
      message: {
        role: "agent",
        parts: [
          ...textParts(
            "Self Agent ID Registry — A2A v0.3.0 Endpoint",
            "",
            "I can help with:",
            "",
            "1. Register an agent — Initiate human-verified agent registration",
            '   Say: "Register a new agent" or send { intent: "register", humanAddress: "0x...", network: "testnet" }',
            "",
            "2. Check registration status — Poll an in-progress registration",
            '   Send: { intent: "register-status", sessionToken: "<token>" }',
            "",
            "3. Look up an agent — Get full on-chain details",
            '   Say: "Look up agent #1" or send { intent: "lookup", agentId: 1 }',
            "",
            "4. Verify an agent — Check if an agent has a valid human proof",
            '   Say: "Verify agent #1" or send { intent: "verify", agentId: 1 }',
            "",
            "You can use natural language or structured data parts for programmatic access.",
            "All queries default to testnet (Celo Sepolia). Add chainId: 42220 for mainnet.",
          ),
        ],
      },
      timestamp: new Date().toISOString(),
    },
  };
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

const registryTaskHandler: TaskHandler = {
  async onMessage(
    message: Message,
    metadata?: Record<string, unknown>,
  ): Promise<Task> {
    const taskId = generateTaskId();
    const intent = parseIntent(message);

    let task: Task;

    switch (intent.type) {
      case "register":
        task = await handleRegister(intent, taskId, currentRequest);
        break;
      case "register-status":
        task = await handleRegisterStatus(intent.sessionToken, taskId, undefined, currentRequest);
        break;
      case "register-poll": {
        const storedToken = taskSessionStore.get(intent.taskId);
        if (!storedToken) {
          task = {
            id: taskId,
            status: {
              state: "failed",
              message: {
                role: "agent",
                parts: textParts(
                  "No active registration found for that task ID. The session may have expired.",
                  "Start a new registration with: { intent: 'register', humanAddress: '0x...', network: 'testnet' }",
                ),
              },
              timestamp: new Date().toISOString(),
            },
          };
        } else {
          task = await handleRegisterStatus(storedToken, taskId, intent.taskId, currentRequest);
        }
        break;
      }
      case "lookup":
        task = await handleLookup(intent.agentId, intent.chainId, taskId);
        break;
      case "verify":
        task = await handleVerify(intent.agentId, intent.chainId, taskId);
        break;
      case "help":
        task = handleHelp(taskId);
        break;
      default:
        task = {
          id: taskId,
          status: {
            state: "completed",
            message: {
              role: "agent",
              parts: textParts(
                `I didn't understand that request. ${intent.type === "unknown" ? "" : ""}`,
                'Say "help" to see what I can do, or send a structured data part with an intent field.',
              ),
            },
            timestamp: new Date().toISOString(),
          },
        };
    }

    // Attach session and history
    task.sessionId = (metadata?.sessionId as string) || undefined;
    task.history = [message, ...(task.status.message ? [task.status.message] : [])];

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

    if (historyLength !== undefined && task.history) {
      return { ...task, history: task.history.slice(-historyLength) };
    }
    return task;
  },

  async onCancelTask(taskId: string): Promise<Task> {
    const task = taskStore.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

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
          parts: textParts("Task canceled by request."),
        },
        timestamp: new Date().toISOString(),
      },
    };

    taskStore.set(taskId, canceledTask);
    return canceledTask;
  },
};

// ── Request-scoped context ───────────────────────────────────────────────────
// The TaskHandler interface doesn't carry the HTTP request, so we store it
// in a module-scoped variable for the duration of each request.
let currentRequest: NextRequest | undefined;

// ── A2A Server instance ─────────────────────────────────────────────────────

const a2aServer = new A2AServer(registryTaskHandler);

// ── Route handler ───────────────────────────────────────────────────────────

/**
 * POST /api/a2a
 *
 * A2A v0.3.0 JSON-RPC 2.0 endpoint.
 *
 * Accepts JSON-RPC requests for:
 *   - message/send: Send a message to the Self Agent ID Registry
 *   - tasks/get: Retrieve a task by ID
 *   - tasks/cancel: Cancel a task
 *
 * Supported intents (via natural language or structured data parts):
 *   - register: Initiate agent registration (returns QR + deep link)
 *   - register-status: Poll registration progress
 *   - lookup: Get full on-chain agent details
 *   - verify: Check human proof status
 *   - help: List capabilities
 *
 * Optional agent verification: If the request includes an `X-Agent-Id` header,
 * the endpoint verifies that the agent is registered and has a valid human proof
 * on-chain before processing the request.
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const errorResp: JSONRPCResponse = {
      jsonrpc: "2.0",
      id: 0,
      error: {
        code: A2AErrorCodes.CONTENT_TYPE_NOT_SUPPORTED,
        message: "Content-Type must be application/json",
      },
    };
    return NextResponse.json(errorResp, {
      status: 415,
      headers: CORS_HEADERS,
    });
  }

  // Optional: verify requesting agent
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

  // Store request for handlers to derive base URL
  currentRequest = req;

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

  const response = await a2aServer.handleRequest(body);

  let httpStatus = 200;
  if (response.error) {
    switch (response.error.code) {
      case A2AErrorCodes.PARSE_ERROR:
      case A2AErrorCodes.INVALID_REQUEST:
      case A2AErrorCodes.INVALID_PARAMS:
        httpStatus = 400;
        break;
      case A2AErrorCodes.METHOD_NOT_FOUND:
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
    headers: CORS_HEADERS,
  });
}
