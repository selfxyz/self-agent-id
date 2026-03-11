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
  | {
      type: "register";
      network: string;
      humanAddress?: string;
      mode?: string;
      pushConfig?: TaskPushNotificationConfig;
      ed25519Pubkey?: string;
      ed25519Signature?: string;
    }
  | { type: "register-status"; sessionToken: string }
  | { type: "register-poll"; taskId: string }
  | { type: "lookup"; agentId: number; chainId?: number }
  | { type: "verify"; agentId: number; chainId?: number }
  | { type: "deregister"; agentId: number; chainId?: number }
  | { type: "check-freshness"; agentId: number; chainId?: number }
  | { type: "refresh-proof"; agentId: number; chainId?: number }
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
  let data = extractData(message);

  // If no data part, try to parse text as JSON (agents sometimes send structured JSON as text)
  // Use the raw (non-lowercased) text to preserve key casing
  if (!data && text.startsWith("{")) {
    const rawText = extractText(message).trim();
    try {
      data = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      // Not valid JSON, fall through to NLP
    }
  }

  // Structured data takes priority (for programmatic agent callers)
  if (data) {
    const intent = data.intent as string | undefined;
    if (intent === "register" || intent === "registration") {
      const hasEd25519 = !!data.ed25519Pubkey;
      return {
        type: "register",
        network: (data.network as string) || "mainnet",
        humanAddress: data.humanAddress as string | undefined,
        mode:
          (data.mode as string) ||
          (hasEd25519
            ? data.humanAddress
              ? "ed25519-linked"
              : "ed25519"
            : "wallet-free"),
        pushConfig: data.pushNotificationUrl
          ? {
              url: data.pushNotificationUrl as string,
              token: data.pushNotificationToken as string | undefined,
            }
          : undefined,
        ed25519Pubkey: data.ed25519Pubkey as string | undefined,
        ed25519Signature: data.ed25519Signature as string | undefined,
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
      return {
        type: "unknown",
        text: "Please provide either a taskId or sessionToken to check status.",
      };
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
    if (
      intent === "deregister" ||
      intent === "unregister" ||
      intent === "revoke"
    ) {
      return {
        type: "deregister",
        agentId: Number(data.agentId),
        chainId: data.chainId ? Number(data.chainId) : undefined,
      };
    }
    if (intent === "freshness" || intent === "check-freshness") {
      return {
        type: "check-freshness",
        agentId: Number(data.agentId),
        chainId: data.chainId ? Number(data.chainId) : undefined,
      };
    }
    if (
      intent === "refresh-proof" ||
      intent === "refresh" ||
      intent === "renew" ||
      intent === "re-verify" ||
      intent === "reauthenticate"
    ) {
      return {
        type: "refresh-proof",
        agentId: Number(data.agentId),
        chainId: data.chainId ? Number(data.chainId) : undefined,
      };
    }
  }

  // Natural language parsing

  // "deregister agent #5" / "unregister agent 5" / "revoke agent 5"
  // Must come before the register check since "deregister" contains "register"
  const deregMatch = text.match(
    /(?:deregister|unregister|revoke|remove|delete)\s+(?:agent\s*)?#?(\d+)/,
  );
  if (deregMatch) {
    const chainId = text.includes("mainnet")
      ? 42220
      : text.includes("testnet")
        ? 11142220
        : undefined;
    return { type: "deregister", agentId: Number(deregMatch[1]), chainId };
  }

  if (
    (text.includes("register") &&
      !text.includes("deregister") &&
      !text.includes("unregister")) ||
    text.includes("sign up") ||
    text.includes("create agent") ||
    text.includes("new agent")
  ) {
    // Extract address if present (0x...)
    const addrMatch = text.match(/0x[a-fA-F0-9]{40}/);
    const network = text.includes("testnet") ? "testnet" : "mainnet";
    return {
      type: "register",
      network,
      humanAddress: addrMatch?.[0],
      mode:
        text.includes("ed25519-linked") || text.includes("ed25519 linked")
          ? "ed25519-linked"
          : text.includes("ed25519")
            ? "ed25519"
            : text.includes("linked")
              ? "linked"
              : addrMatch
                ? "linked"
                : "wallet-free",
    };
  }

  if (text.includes("status") && text.includes("registration")) {
    // Look for session token in data parts
    const token = data?.sessionToken as string | undefined;
    if (token) return { type: "register-status", sessionToken: token };
    return {
      type: "unknown",
      text: "Please provide your session token to check registration status. Send a data part with { intent: 'register-status', sessionToken: '<token>' }.",
    };
  }

  // "refresh proof for agent #5" / "renew agent 5" / "re-verify agent 5"
  const refreshMatch = text.match(
    /(?:refresh|renew|re-?verif)\w*\s+(?:proof\s+(?:for\s+)?)?(?:agent\s*)?#?(\d+)/i,
  );
  if (refreshMatch) {
    const chainId = text.includes("mainnet")
      ? 42220
      : text.includes("testnet")
        ? 11142220
        : undefined;
    return { type: "refresh-proof", agentId: Number(refreshMatch[1]), chainId };
  }

  // "freshness agent #5" / "is agent 5 expired" / "check freshness of agent #1"
  const freshMatch = text.match(
    /(?:fresh|expir)\w*\s+(?:of\s+)?(?:agent\s*)?#?(\d+)/,
  );
  if (freshMatch) {
    const chainId = text.includes("mainnet")
      ? 42220
      : text.includes("testnet")
        ? 11142220
        : undefined;
    return { type: "check-freshness", agentId: Number(freshMatch[1]), chainId };
  }

  // "look up agent #5" / "info agent 5" / "agent 5"
  const lookupMatch = text.match(
    /(?:look\s*up|info|details|get|fetch|card)\s+(?:agent\s*)?#?(\d+)/,
  );
  if (lookupMatch) {
    const chainId = text.includes("mainnet")
      ? 42220
      : text.includes("testnet")
        ? 11142220
        : undefined;
    return { type: "lookup", agentId: Number(lookupMatch[1]), chainId };
  }

  // "verify agent 5" / "is agent 5 verified" / "check agent 5" / "has human proof"
  const verifyMatch = text.match(
    /(?:verify|check|is|has|does)\s+(?:agent\s*)?#?(\d+)/,
  );
  if (verifyMatch) {
    const chainId = text.includes("mainnet")
      ? 42220
      : text.includes("testnet")
        ? 11142220
        : undefined;
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
  // wallet-free and ed25519 modes don't need a human address — the server generates everything
  const isWalletFree =
    intent.mode === "wallet-free" || intent.mode === "ed25519";

  if (!intent.humanAddress && !isWalletFree) {
    // Non-wallet-free modes need a human address
    return {
      id: taskId,
      status: {
        state: "input-required",
        message: {
          role: "agent",
          parts: [
            ...textParts(
              "To register with this mode, I need the human wallet address that will verify this agent.",
              "Please provide your Ethereum address (0x...), or use wallet-free mode (no wallet needed):",
            ),
            dataPart({
              examples: [
                {
                  intent: "register",
                  network: "mainnet",
                  mode: "wallet-free",
                  note: "Simplest — no human wallet needed, human just scans QR",
                },
                {
                  intent: "register",
                  network: "mainnet",
                  humanAddress: "0xYourAddress...",
                  mode: "linked",
                  note: "Ties agent to a specific human wallet",
                },
              ],
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

    const registerBody: Record<string, unknown> = {
      mode: intent.mode || "wallet-free",
      network: intent.network,
      disclosures: { minimumAge: 18, ofac: true },
    };
    if (intent.humanAddress) {
      registerBody.humanAddress = intent.humanAddress;
    }
    if (intent.ed25519Pubkey) {
      registerBody.ed25519Pubkey = intent.ed25519Pubkey;
    }
    if (intent.ed25519Signature) {
      registerBody.ed25519Signature = intent.ed25519Signature;
    }

    const res = await fetch(`${appUrl}/api/agent/register`, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify(registerBody),
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
              `Registration failed: ${typeof result.error === "string" ? result.error : JSON.stringify(result.error) || "Unknown error"}`,
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
              "A human needs to scan this QR code with their phone to open the Self app and verify this agent.",
              "If the human is already on their phone, they can open this link directly instead:",
              `${deepLink}`,
              "",
              "Steps for the human:",
              "1. Scan the QR code below with your phone camera (or tap the link above if on mobile)",
              "2. The Self app will open — follow the prompts",
              "3. Scan your passport (NFC chip) when prompted",
              "4. The agent will be verified on-chain automatically",
            ),
            ...qrParts,
            ...textParts(
              "",
              `Session expires at: ${String(result.expiresAt)} (${Math.round((result.timeRemainingMs as number) / 1000)}s remaining)`,
              "",
              "To check status, send:",
              `  { "intent": "status", "taskId": "${taskId}" }`,
            ),
            dataPart({
              taskId,
              sessionToken: result.sessionToken,
              deepLink,
              qrImageIncluded: qrParts.length > 0,
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
                    network: "mainnet",
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
                `Agent ID: ${String(result.agentId)}`,
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
            parts: textParts(
              "Registration failed. The proof was rejected or the user cancelled.",
            ),
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
    const expiryWarning =
      timeRemaining < 120_000
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

    const [
      agentKey,
      hasProof,
      providerAddr,
      registeredAt,
      credentials,
      proofExpiry,
    ] = await Promise.all([
      registry.agentIdToAgentKey(BigInt(agentId)),
      registry.hasHumanProof(BigInt(agentId)),
      registry.getProofProvider(BigInt(agentId)),
      registry.agentRegisteredAt(BigInt(agentId)),
      registry.getAgentCredentials(BigInt(agentId)) as Promise<{
        nationality: string;
        olderThan: bigint;
        ofac: [boolean, boolean, boolean];
      }>,
      registry.proofExpiresAt(BigInt(agentId)).catch(() => 0n),
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

    // Compute expiry fields
    const proofExpiresAtMs = Number(proofExpiry) * 1000;
    const daysUntilExpiry =
      proofExpiresAtMs > 0
        ? Math.floor((proofExpiresAtMs - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
    const isExpiringSoon =
      daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
    const proofExpiresAtISO =
      proofExpiresAtMs > 0 ? new Date(proofExpiresAtMs).toISOString() : null;

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
              ...(proofExpiresAtISO
                ? [
                    `- Proof expires: ${proofExpiresAtISO}${daysUntilExpiry !== null ? ` (${daysUntilExpiry} days)` : ""}`,
                  ]
                : []),
              ...(isExpiringSoon
                ? ["- WARNING: Proof is expiring soon! Consider refreshing."]
                : []),
            ),
            dataPart({
              agentId,
              chainId: Number(cid),
              agentAddress,
              isVerified: hasProof,
              verificationStrength,
              strengthLabel,
              proofExpiresAt: proofExpiresAtISO,
              daysUntilExpiry,
              isExpiringSoon,
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
    if (
      msg.includes("coalesce") ||
      msg.includes("BAD_DATA") ||
      msg.includes("ERC721")
    ) {
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

    const [hasProof, proofExpiry] = await Promise.all([
      registry.hasHumanProof(BigInt(agentId)),
      registry.proofExpiresAt(BigInt(agentId)).catch(() => 0n),
    ]);

    let isFresh = true;
    try {
      isFresh = await registry.isProofFresh(BigInt(agentId));
    } catch {
      // isProofFresh may not exist on older contracts
    }

    const verified = hasProof && isFresh;

    // Compute expiry fields
    const proofExpiresAtMs = Number(proofExpiry) * 1000;
    const daysUntilExpiry =
      proofExpiresAtMs > 0
        ? Math.floor((proofExpiresAtMs - Date.now()) / (1000 * 60 * 60 * 24))
        : null;
    const isExpiringSoon =
      daysUntilExpiry !== null && daysUntilExpiry >= 0 && daysUntilExpiry <= 30;
    const proofExpiresAtISO =
      proofExpiresAtMs > 0 ? new Date(proofExpiresAtMs).toISOString() : null;

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
              ...(proofExpiresAtISO && hasProof
                ? [
                    `Proof expires: ${proofExpiresAtISO}${daysUntilExpiry !== null ? ` (${daysUntilExpiry} days remaining)` : ""}`,
                  ]
                : []),
              ...(isExpiringSoon
                ? ["WARNING: Proof is expiring soon! Consider refreshing."]
                : []),
            ),
            dataPart({
              agentId,
              chainId: Number(cid),
              hasHumanProof: hasProof,
              isProofFresh: isFresh,
              isVerified: verified,
              proofExpiresAt: proofExpiresAtISO,
              daysUntilExpiry,
              isExpiringSoon,
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

async function handleDeregister(
  intent: Extract<Intent, { type: "deregister" }>,
  taskId: string,
  req?: NextRequest,
): Promise<Task> {
  const appUrl = getAppBaseUrl(req);
  const { chainId: cid, config } = resolveChainConfig(intent.chainId);
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

  // Map chainId to the "mainnet"/"testnet" string the deregister API expects
  const network = cid === "42220" ? "mainnet" : "testnet";

  try {
    // Look up agent address from on-chain registry
    const rpc = new ethers.JsonRpcProvider(config.rpc);
    const registry = typedRegistry(config.registry, rpc);
    const agentKey = await registry.agentIdToAgentKey(BigInt(intent.agentId));

    if (agentKey === ethers.ZeroHash) {
      return {
        id: taskId,
        status: {
          state: "failed",
          message: {
            role: "agent",
            parts: textParts(`Agent #${intent.agentId} not found on-chain.`),
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    const agentAddress = ethers.getAddress("0x" + agentKey.slice(-40));

    const fetchHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypassSecret) fetchHeaders["x-vercel-protection-bypass"] = bypassSecret;
    const cookies = req?.headers.get("cookie");
    if (cookies) fetchHeaders["cookie"] = cookies;

    const res = await fetch(`${appUrl}/api/agent/deregister`, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify({
        agentAddress,
        network,
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
              `Deregistration failed: ${typeof result.error === "string" ? result.error : JSON.stringify(result.error) || "Unknown error"}`,
            ),
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    const deepLink = result.deepLink as string;
    let qrParts: Part[] = [];
    try {
      const qrDataUrl = await generateQRBase64(deepLink);
      const base64 = qrDataUrl.split(",")[1];
      qrParts = [
        {
          type: "file" as const,
          file: {
            name: "deregister-qr.png",
            mimeType: "image/png",
            bytes: base64,
          },
        },
      ];
    } catch {
      /* QR gen failed — deep link still available */
    }

    taskSessionStore.set(taskId, result.sessionToken as string);

    return {
      id: taskId,
      status: {
        state: "input-required",
        message: {
          role: "agent",
          parts: [
            ...textParts(
              `Deregistration initiated for Agent #${intent.agentId}.`,
              "",
              "WARNING: This is permanent. The NFT will be burned and all on-chain proof data removed.",
              "",
              "A human must scan this QR code with the Self app to confirm deregistration.",
              "If on mobile, open this link instead:",
              `${deepLink}`,
            ),
            ...qrParts,
            dataPart({
              taskId,
              sessionToken: result.sessionToken,
              deepLink,
              agentId: intent.agentId,
              action: "deregister",
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
            `Deregistration failed: ${err instanceof Error ? err.message : "Network error"}`,
          ),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }
}

async function handleCheckFreshness(
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

    const [hasProof, expiresAt, nullifier] = await Promise.all([
      registry.hasHumanProof(BigInt(agentId)),
      registry.proofExpiresAt(BigInt(agentId)),
      registry.getHumanNullifier(BigInt(agentId)).catch(() => 0n),
    ]);

    // Fetch sibling agent IDs (other agents registered by the same human)
    let siblingAgentIds: number[] = [];
    if (nullifier && nullifier !== 0n) {
      try {
        const allAgents = await registry.getAgentsForNullifier(nullifier);
        siblingAgentIds = allAgents
          .map((id) => Number(id))
          .filter((id) => id !== agentId);
      } catch {
        // getAgentsForNullifier may not be available on older contracts
      }
    }

    if (!hasProof) {
      return {
        id: taskId,
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: [
              ...textParts(
                `Agent #${agentId} has no human proof. Registration required first.`,
              ),
              dataPart({ agentId, hasProof: false, action: "register" }),
            ],
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    const expiresAtMs = Number(expiresAt) * 1000;
    const now = Date.now();
    const remainingMs = expiresAtMs - now;
    const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const isExpired = remainingMs <= 0;
    const isWarning = !isExpired && remainingDays <= 30;

    if (isExpired) {
      return {
        id: taskId,
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: [
              ...textParts(
                `Agent #${agentId} proof has EXPIRED (expired ${new Date(expiresAtMs).toISOString()}).`,
                "",
                "To get a fresh proof, the agent must re-register:",
                `1. Deregister: { intent: "deregister", agentId: ${agentId} }`,
                `2. Re-register: { intent: "register" }`,
                "",
                "The human will need to scan their passport again.",
              ),
              dataPart({
                agentId,
                hasProof: true,
                isExpired: true,
                expiresAt: new Date(expiresAtMs).toISOString(),
                siblingAgentIds,
                action: "re-register",
                steps: [
                  { intent: "deregister", agentId },
                  { intent: "register" },
                ],
              }),
            ],
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    if (isWarning) {
      return {
        id: taskId,
        status: {
          state: "completed",
          message: {
            role: "agent",
            parts: [
              ...textParts(
                `Agent #${agentId} proof expires in ${remainingDays} days (${new Date(expiresAtMs).toISOString()}).`,
                "",
                "Consider re-registering soon to maintain continuity:",
                `1. Deregister: { intent: "deregister", agentId: ${agentId} }`,
                `2. Re-register: { intent: "register" }`,
              ),
              dataPart({
                agentId,
                hasProof: true,
                isExpired: false,
                isWarning: true,
                remainingDays,
                expiresAt: new Date(expiresAtMs).toISOString(),
                siblingAgentIds,
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
        state: "completed",
        message: {
          role: "agent",
          parts: [
            ...textParts(
              `Agent #${agentId} proof is fresh. Expires in ${remainingDays} days (${new Date(expiresAtMs).toISOString()}).`,
            ),
            dataPart({
              agentId,
              hasProof: true,
              isExpired: false,
              isWarning: false,
              remainingDays,
              expiresAt: new Date(expiresAtMs).toISOString(),
              siblingAgentIds,
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
            `Freshness check failed: ${err instanceof Error ? err.message : "Network error"}`,
          ),
        },
        timestamp: new Date().toISOString(),
      },
    };
  }
}

async function handleRefreshProof(
  agentId: number,
  chainId: number | undefined,
  taskId: string,
  req?: NextRequest,
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

  const network = cid === "42220" ? "mainnet" : "testnet";
  const appUrl = getAppBaseUrl(req);

  try {
    const fetchHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypassSecret) fetchHeaders["x-vercel-protection-bypass"] = bypassSecret;
    const cookies = req?.headers.get("cookie");
    if (cookies) fetchHeaders["cookie"] = cookies;

    const res = await fetch(`${appUrl}/api/agent/refresh`, {
      method: "POST",
      headers: fetchHeaders,
      body: JSON.stringify({ agentId, network }),
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
              `Proof refresh failed: ${typeof result.error === "string" ? result.error : JSON.stringify(result.error) || "Unknown error"}`,
            ),
          },
          timestamp: new Date().toISOString(),
        },
      };
    }

    const deepLink = result.deepLink as string;
    let qrParts: Part[] = [];
    try {
      const qrDataUrl = await generateQRBase64(deepLink);
      const base64 = qrDataUrl.split(",")[1];
      qrParts = [
        {
          type: "file" as const,
          file: {
            name: "refresh-proof-qr.png",
            mimeType: "image/png",
            bytes: base64,
          },
        },
      ];
    } catch {
      /* QR gen failed — deep link still available */
    }

    taskSessionStore.set(taskId, result.sessionToken as string);

    return {
      id: taskId,
      status: {
        state: "input-required",
        message: {
          role: "agent",
          parts: [
            ...textParts(
              `Proof refresh initiated for Agent #${agentId}.`,
              "",
              "A human must scan this QR code with the Self app to provide a fresh proof.",
              "If on mobile, open this link instead:",
              `${deepLink}`,
              "",
              "Steps for the human:",
              "1. Scan the QR code below with your phone camera (or tap the link above if on mobile)",
              "2. The Self app will open — follow the prompts",
              "3. Scan your passport (NFC chip) when prompted",
              "4. The proof will be refreshed on-chain automatically",
              "",
              `Session expires at: ${String(result.expiresAt)} (${Math.round((result.timeRemainingMs as number) / 1000)}s remaining)`,
              "",
              "To check status, send:",
              `  { "intent": "status", "taskId": "${taskId}" }`,
            ),
            ...qrParts,
            dataPart({
              taskId,
              sessionToken: result.sessionToken,
              deepLink,
              qrImageIncluded: qrParts.length > 0,
              agentId,
              network,
              action: "refresh-proof",
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
            `Proof refresh failed: ${err instanceof Error ? err.message : "Network error"}`,
          ),
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
            "1. Register an agent — Get human-verified on-chain identity",
            '   Say: "Register a new agent" or send { intent: "register" }',
            "",
            "   IMPORTANT — Networks:",
            "   • mainnet (default): Celo Mainnet. Requires a REAL passport via the Self app.",
            "   • testnet: Celo Sepolia. For testing only — uses MOCK documents generated in the Self app.",
            '     Use network: "testnet" for development. The Self app is still required, but you can generate mock documents instead of using a real passport.',
            "",
            "   Registration modes:",
            "",
            "   - wallet-free (default): No wallet needed. Server generates everything.",
            "     The human just scans a QR code with the Self app. Simplest option.",
            '     Example: { intent: "register" }',
            "",
            "   - ed25519: For agents using Ed25519 keys (OpenClaw, Eliza, IronClaw).",
            "     No human wallet needed — derives address from pubkey. Bring your own",
            "     public key and a pre-signed challenge to prove key ownership.",
            '     Example: { intent: "register", ed25519Pubkey: "...", ed25519Signature: "..." }',
            "",
            "   - linked: Separate agent EVM keys, linked to a human wallet. For agents",
            "     that want their own keypair tied to a specific human wallet address.",
            '     Requires: { humanAddress: "0x...", mode: "linked" }',
            "",
            "   - ed25519-linked: Agent's Ed25519 keys, linked to a human wallet.",
            "     Like ed25519 but requires an explicit human wallet binding.",
            '     Requires: { humanAddress: "0x...", ed25519Pubkey: "...", ed25519Signature: "..." }',
            "",
            "   Quick decision guide:",
            "   ┌─ Do you have Ed25519 keys? (OpenClaw, Eliza, IronClaw)",
            "   │  ├─ YES + want to link a human wallet? → ed25519-linked",
            "   │  └─ YES + no human wallet needed?      → ed25519 (default for Ed25519 agents)",
            "   └─ No Ed25519 keys?",
            "      ├─ Want to link a human wallet?       → linked (recommended)",
            "      └─ No human wallet needed?            → wallet-free (default)",
            "",
            "2. Check registration status — Poll an in-progress registration",
            '   Send: { intent: "status", taskId: "<taskId>" }',
            "",
            "3. Look up an agent — Get full on-chain details",
            '   Say: "Look up agent #1" or send { intent: "lookup", agentId: 1 }',
            "",
            "4. Verify an agent — Check if an agent has a valid human proof",
            '   Say: "Verify agent #1" or send { intent: "verify", agentId: 1 }',
            "",
            "5. Deregister an agent — Permanently remove an agent (burns NFT, clears proof)",
            '   Say: "Deregister agent #5" or send { intent: "deregister", agentId: 5 }',
            "   WARNING: This is irreversible. The human must confirm via Self app scan.",
            "",
            "6. Check proof freshness — See if an agent's proof is still valid or expiring soon",
            '   Say: "Is agent #5 still fresh?" or send { intent: "freshness", agentId: 5 }',
            "   Returns: days remaining, expiry date, and re-registration steps if expired.",
            "",
            "7. Refresh proof — Initiate a proof refresh for an existing agent (re-verify without deregistering)",
            '   Say: "Refresh proof for agent #5" or send { intent: "refresh-proof", agentId: 5 }',
            "   The human scans their passport again; the on-chain proof expiry is updated.",
            "",
            'All queries default to mainnet (Celo). Add chainId: 11142220 or network: "testnet" for Celo Sepolia (mock documents via the Self app, no real passport needed).',
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
        task = await handleRegisterStatus(
          intent.sessionToken,
          taskId,
          undefined,
          currentRequest,
        );
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
                  "Start a new registration with: { intent: 'register' }",
                ),
              },
              timestamp: new Date().toISOString(),
            },
          };
        } else {
          task = await handleRegisterStatus(
            storedToken,
            taskId,
            intent.taskId,
            currentRequest,
          );
        }
        break;
      }
      case "lookup":
        task = await handleLookup(intent.agentId, intent.chainId, taskId);
        break;
      case "verify":
        task = await handleVerify(intent.agentId, intent.chainId, taskId);
        break;
      case "deregister":
        task = await handleDeregister(intent, taskId, currentRequest);
        break;
      case "check-freshness":
        task = await handleCheckFreshness(
          intent.agentId,
          intent.chainId,
          taskId,
        );
        break;
      case "refresh-proof":
        task = await handleRefreshProof(
          intent.agentId,
          intent.chainId,
          taskId,
          currentRequest,
        );
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
              parts: [
                ...textParts(
                  "I didn't understand that request.",
                  'Send { intent: "help" } to see what I can do. Quick examples:',
                ),
                dataPart({
                  examples: [
                    { intent: "register" },
                    { intent: "lookup", agentId: 1 },
                    { intent: "verify", agentId: 1 },
                    { intent: "deregister", agentId: 1 },
                    { intent: "freshness", agentId: 1 },
                    { intent: "refresh-proof", agentId: 1 },
                    { intent: "help" },
                  ],
                }),
              ],
            },
            timestamp: new Date().toISOString(),
          },
        };
    }

    // Attach session and history
    task.sessionId = (metadata?.sessionId as string) || undefined;
    task.history = [
      message,
      ...(task.status.message ? [task.status.message] : []),
    ];

    taskStore.set(taskId, task);
    return task;
  },

  // eslint-disable-next-line @typescript-eslint/require-await
  async onGetTask(taskId: string, historyLength?: number): Promise<Task> {
    const task = taskStore.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    if (historyLength !== undefined && task.history) {
      return { ...task, history: task.history.slice(-historyLength) };
    }
    return task;
  },

  // eslint-disable-next-line @typescript-eslint/require-await
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
 *   - deregister: Permanently remove an agent (burns NFT)
 *   - check-freshness: Check if an agent's proof is still valid or expiring
 *   - refresh-proof: Initiate a proof refresh for an existing agent
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
