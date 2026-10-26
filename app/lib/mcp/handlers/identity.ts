// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * MCP identity tools: get this server's agent identity, register a new agent
 * (and poll / export it), deregister this server's agent.
 *
 * Register and check-registration are public; get-identity and deregister use
 * SELF_AGENT_PRIVATE_KEY (privileged). All flows call the REST routes.
 */

import { safeErrorDescription } from "@/lib/agent-api-helpers";
import { ethers } from "ethers";
import { SelfAgent } from "@selfxyz/agent-sdk";
import { rpcUrlFor, type McpConfig } from "../config";
import {
  apiErrorText,
  apiFetch,
  formatCredentialsSummary,
  toolError,
  toolSuccess,
} from "../utils";
import { renderQrBase64 } from "@/lib/render-qr";
import { POST as registerPOST } from "@/app/api/agent/register/route";
import { GET as registerStatusGET } from "@/app/api/agent/register/status/route";
import { POST as exportPOST } from "@/app/api/agent/register/export/route";
import { POST as deregisterPOST } from "@/app/api/agent/deregister/route";
import { NO_AGENT_KEY_ERROR } from "./auth";

/** A parsed JSON object body. */
type JsonObject = Record<string, unknown>;

/**
 * Narrow an unknown JSON value to a string.
 *
 * @param value - Any JSON value.
 * @returns The string, or undefined for other types.
 */
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Narrow an unknown JSON value to a string array.
 *
 * @param value - Any JSON value.
 * @returns The string items, or [] when not an array.
 */
function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/**
 * Build a tool result for a new human-in-the-loop session.
 *
 * Uses the route's qrImageBase64, or renders the deep link when it is missing
 * (render failures just drop the image).
 *
 * @param data - Body of the session-start route.
 * @param fields - Extra fields for the JSON text block.
 * @returns MCP content: a PNG image block (when available) plus a text block
 *   with deep_link, scan_url, expires_at, human_instructions and `fields`.
 */
async function sessionContent(data: JsonObject, fields: JsonObject) {
  const deepLink = asString(data.deepLink);
  let qrBase64 = asString(data.qrImageBase64);
  if (!qrBase64 && deepLink) {
    qrBase64 = await renderQrBase64(deepLink).catch(() => undefined);
  }
  const text = {
    type: "text" as const,
    text: JSON.stringify(
      {
        deep_link: deepLink,
        scan_url: asString(data.scanUrl),
        expires_at: asString(data.expiresAt),
        human_instructions: asStringArray(data.humanInstructions),
        ...fields,
      },
      null,
      2,
    ),
  };
  return {
    content: qrBase64
      ? [
          { type: "image" as const, data: qrBase64, mimeType: "image/png" },
          text,
        ]
      : [text],
  };
}

// ── Get Identity ────────────────────────────────────────────────────────────

/** Arguments of the get-identity tool. */
interface GetIdentityArgs {
  network?: "mainnet" | "testnet";
}

/**
 * Report the on-chain identity of this server's configured agent.
 *
 * @param args.network - Network (default: the server's configured network).
 * @param config - The request's MCP config (needs privateKey).
 * @returns Tool success with `registered: false` and the address when not
 *   registered, or the agent ID, verification (hasHumanProof &&
 *   isProofFresh), expiry, nullifier, agent count, strength and credentials
 *   summary; tool error when no key is configured or on RPC failure.
 */
export async function handleGetIdentity(
  args: GetIdentityArgs,
  config: McpConfig,
) {
  if (!config.privateKey) return toolError(NO_AGENT_KEY_ERROR);

  const network = args.network ?? config.network;

  try {
    const agent = new SelfAgent({
      privateKey: config.privateKey,
      network,
      rpcUrl: rpcUrlFor(config, network),
    });

    const info = await agent.getInfo();
    if (info.agentId === 0n) {
      return toolSuccess({
        registered: false,
        address: agent.address,
        network,
        message:
          "This agent address is not registered on-chain. " +
          "Use self_register_agent to register a new agent, or self_lookup_agent to check a different agent.",
      });
    }

    const [credentials, verificationStrength] = await Promise.all([
      agent.getCredentials(),
      agent.getVerificationStrength(),
    ]);
    const verified = info.isVerified && info.isProofFresh;

    return toolSuccess({
      registered: true,
      address: info.address,
      agentKey: info.agentKey,
      agentId: Number(info.agentId),
      isVerified: verified,
      proofExpiresAt:
        info.proofExpiresAt > 0n
          ? new Date(Number(info.proofExpiresAt) * 1000).toISOString()
          : null,
      nullifier: info.nullifier.toString(),
      agentCount: Number(info.agentCount),
      verificationStrength,
      credentials_summary: formatCredentialsSummary(credentials, verified),
      network,
    });
  } catch (err) {
    console.error("[mcp] get identity failed:", safeErrorDescription(err));
    return toolError("Failed to get agent identity: RPC error");
  }
}

// ── Register Agent (via REST API) ───────────────────────────────────────────

/** Arguments of the register-agent tool. */
interface RegisterAgentArgs {
  minimum_age?: 0 | 18 | 21;
  ofac?: boolean;
  human_address?: string;
  network?: "mainnet" | "testnet";
}

/**
 * Start a registration via POST /api/agent/register.
 *
 * Mode is "linked" when human_address is given, otherwise "wallet-free".
 *
 * @param args.minimum_age - Age disclosure to request (0, 18 or 21).
 * @param args.ofac - Request the OFAC disclosure.
 * @param args.human_address - Human's wallet, which will own the agent.
 * @param args.network - Network (default: the server's configured network).
 * @param config - The request's MCP config.
 * @returns QR image + session details (session token, agent address, next
 *   step); tool error when the route rejects the request or is unreachable.
 */
export async function handleRegisterAgent(
  args: RegisterAgentArgs,
  config: McpConfig,
) {
  const network = args.network ?? config.network;
  const mode = args.human_address ? "linked" : "wallet-free";

  try {
    const result = await apiFetch(config, "/api/agent/register", registerPOST, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode,
        network,
        disclosures: {
          ...(args.minimum_age != null ? { minimumAge: args.minimum_age } : {}),
          ...(args.ofac != null ? { ofac: args.ofac } : {}),
        },
        ...(args.human_address ? { humanAddress: args.human_address } : {}),
      }),
    });

    if (!result.ok) {
      return toolError(`Registration failed: ${apiErrorText(result)}`);
    }

    const data = result.data;
    return sessionContent(data, {
      session_token: asString(data.sessionToken),
      agent_address: asString(data.agentAddress),
      mode,
      network,
      next_step:
        "Show the QR image (or scan_url) to the human, or share deep_link to open the Self app. " +
        "Then call self_check_registration with session_token to poll; always use the newest " +
        "session_token it returns.",
    });
  } catch (err) {
    console.error("[mcp] register failed:", err);
    return toolError("Failed to initiate registration: API unreachable");
  }
}

// ── Check Registration (via REST API) ───────────────────────────────────────

/** Arguments of the check-registration tool. */
interface CheckRegistrationArgs {
  session_token: string;
  reveal_private_key?: boolean;
}

/** Guidance shown for each non-completed registration stage. */
const STAGE_MESSAGES: Record<string, string> = {
  "qr-ready":
    "Waiting for the human to scan the QR code with the Self app. " +
    "Call self_check_registration again with the new session_token.",
  "proof-received":
    "The human's proof was received; waiting for the on-chain registration. " +
    "Call self_check_registration again with the new session_token.",
  pending:
    "Registration is in progress. Call self_check_registration again with the new session_token.",
  failed:
    "Registration failed. Start a new registration with self_register_agent.",
  expired:
    "Registration session expired. Start a new registration with self_register_agent.",
};

/**
 * Poll a registration and, on request, export the generated private key.
 *
 * @param args.session_token - Newest session token for the registration.
 * @param args.reveal_private_key - When completed, also call
 *   /api/agent/register/export and include `private_key`.
 * @param config - The request's MCP config.
 * @returns Tool success with the stage, rotated session_token and guidance
 *   (stage "expired" on HTTP 410); when completed, agent ID, address,
 *   credentials and optionally the private key. Tool error on other route
 *   errors, a failed export, or when the API is unreachable.
 */
export async function handleCheckRegistration(
  args: CheckRegistrationArgs,
  config: McpConfig,
) {
  try {
    const status = await apiFetch(
      config,
      "/api/agent/register/status",
      registerStatusGET,
      {
        headers: { Authorization: `Bearer ${args.session_token}` },
      },
    );

    if (status.status === 410) {
      return toolSuccess({ stage: "expired", message: STAGE_MESSAGES.expired });
    }
    if (!status.ok) {
      return toolError(`Failed to check registration: ${apiErrorText(status)}`);
    }

    const data = status.data;
    const stage = asString(data.stage) ?? "unknown";
    const sessionToken = asString(data.sessionToken);

    if (stage !== "completed") {
      return toolSuccess({
        stage,
        session_token: sessionToken,
        expires_at: asString(data.expiresAt),
        message: STAGE_MESSAGES[stage] ?? `Registration stage: ${stage}`,
      });
    }

    const completed: JsonObject = {
      stage,
      agent_id: data.agentId,
      agent_address: asString(data.agentAddress),
      credentials: data.credentials,
      session_token: sessionToken,
      export_expires_at: asString(data.expiresAt),
    };

    if (!args.reveal_private_key) {
      return toolSuccess({
        ...completed,
        message:
          "Agent registered on-chain. To use it, retrieve the agent private key before " +
          "export_expires_at: call self_check_registration again with this session_token and " +
          "reveal_private_key=true, or POST /api/agent/register/export with " +
          "Authorization: Bearer <session_token>. The key is only shown to the session token holder.",
      });
    }

    const exported = await apiFetch(
      config,
      "/api/agent/register/export",
      exportPOST,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionToken ?? args.session_token}`,
        },
      },
    );
    if (!exported.ok) {
      return toolError(`Failed to export agent key: ${apiErrorText(exported)}`);
    }
    return toolSuccess({
      ...completed,
      private_key: asString(exported.data.privateKey),
      message:
        "Agent registered. Store private_key securely (e.g. as SELF_AGENT_PRIVATE_KEY); it signs " +
        "requests as this agent and cannot be recovered after the session expires.",
    });
  } catch (err) {
    // The routes called above log their own failures; log no token, key or
    // secret-derived text here.
    console.error(
      "[mcp] check registration failed:",
      safeErrorDescription(err),
    );
    return toolError("Failed to check registration status: API unreachable");
  }
}

// ── Deregister Agent ────────────────────────────────────────────────────────

/** Arguments of the deregister-agent tool. */
interface DeregisterAgentArgs {
  network?: "mainnet" | "testnet";
}

/**
 * Start deregistration of this server's agent via POST /api/agent/deregister.
 *
 * @param args.network - Network (default: the server's configured network).
 * @param config - The request's MCP config (needs privateKey).
 * @returns QR image + session details with an irreversibility warning; tool
 *   error when no key is configured, the route rejects, or it is unreachable.
 */
export async function handleDeregisterAgent(
  args: DeregisterAgentArgs,
  config: McpConfig,
) {
  if (!config.privateKey) return toolError(NO_AGENT_KEY_ERROR);

  const network = args.network ?? config.network;

  try {
    const agentAddress = new ethers.Wallet(config.privateKey).address;
    const result = await apiFetch(
      config,
      "/api/agent/deregister",
      deregisterPOST,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ network, agentAddress }),
      },
    );
    if (!result.ok) {
      return toolError(`Deregistration failed: ${apiErrorText(result)}`);
    }

    return sessionContent(result.data, {
      session_token: asString(result.data.sessionToken),
      agent_address: agentAddress,
      network,
      warning:
        "WARNING: Deregistration is IRREVERSIBLE. The agent's on-chain identity will be permanently revoked. " +
        "The human owner must scan the QR code with the Self app to confirm. Poll " +
        "GET /api/agent/deregister/status with Authorization: Bearer <session_token> for progress.",
    });
  } catch (err) {
    console.error("[mcp] deregister failed:", safeErrorDescription(err));
    return toolError("Failed to initiate deregistration: API unreachable");
  }
}
