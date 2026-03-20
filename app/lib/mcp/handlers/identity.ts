// app/lib/mcp/handlers/identity.ts

import { SelfAgent } from "@selfxyz/agent-sdk";
import type { McpConfig } from "../config";
import { toolError, toolSuccess, formatCredentialsSummary } from "../utils";
import { renderQrBase64 } from "@/lib/renderQr";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

async function readJsonObject(response: Response): Promise<JsonObject> {
  const raw = (await response.json()) as unknown;
  return isJsonObject(raw) ? raw : {};
}

// ── Get Identity ────────────────────────────────────────────────────────────

interface GetIdentityArgs {
  network?: "mainnet" | "testnet";
}

export async function handleGetIdentity(
  args: GetIdentityArgs,
  config: McpConfig,
) {
  if (!config.privateKey) {
    return toolError(
      "No agent identity configured. Set SELF_AGENT_PRIVATE_KEY in your MCP server configuration, " +
        "or use self_register_agent to create a new agent identity.",
    );
  }

  const network = args.network ?? config.network;

  try {
    const agent = new SelfAgent({
      privateKey: config.privateKey,
      network,
      rpcUrl: config.rpcUrl,
    });

    const registered = await agent.isRegistered();

    if (!registered) {
      return toolSuccess({
        registered: false,
        address: agent.address,
        network,
        message:
          "This agent address is not registered on-chain. " +
          "Use self_register_agent to register, or self_lookup_agent to check a different agent.",
      });
    }

    const [info, credentials, verificationStrength] = await Promise.all([
      agent.getInfo(),
      agent.getCredentials(),
      agent.getVerificationStrength(),
    ]);

    const credentialsSummary = formatCredentialsSummary(
      credentials as
        | {
            nationality?: string;
            olderThan?: bigint | number;
            ofac?: boolean[];
          }
        | undefined,
    );

    return toolSuccess({
      registered: true,
      address: info.address,
      agentKey: info.agentKey,
      agentId:
        typeof info.agentId === "bigint" ? Number(info.agentId) : info.agentId,
      isVerified: info.isVerified,
      nullifier:
        typeof info.nullifier === "bigint"
          ? Number(info.nullifier)
          : info.nullifier,
      agentCount:
        typeof info.agentCount === "bigint"
          ? Number(info.agentCount)
          : info.agentCount,
      verificationStrength,
      credentials_summary: credentialsSummary,
      network,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to get agent identity: ${message}`);
  }
}

// ── Register Agent (via REST API) ───────────────────────────────────────────

interface RegisterAgentArgs {
  minimum_age?: 0 | 18 | 21;
  ofac?: boolean;
  human_address?: string;
  network?: "mainnet" | "testnet";
}

export async function handleRegisterAgent(
  args: RegisterAgentArgs,
  config: McpConfig,
) {
  const network = args.network ?? config.network;

  try {
    const response = await fetch(`${config.apiUrl}/api/agent/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "linked",
        network,
        disclosures: {
          ...(args.minimum_age != null ? { minimumAge: args.minimum_age } : {}),
          ...(args.ofac != null ? { ofac: args.ofac } : {}),
        },
        ...(args.human_address ? { humanAddress: args.human_address } : {}),
      }),
    });

    if (!response.ok) {
      const err = await readJsonObject(response).catch(
        () => ({ error: response.statusText }) as JsonObject,
      );
      return toolError(
        `Registration failed: ${asString(err.error) || response.statusText}`,
      );
    }

    const data = await readJsonObject(response);
    const instructions = asStringArray(data.humanInstructions)?.join("\n");

    const sessionToken = asString(data.sessionToken);
    const agentAddress = asString(data.agentAddress);
    const deepLink = asString(data.deepLink);
    const expiresAt = asString(data.expiresAt);
    // scanUrl is the single URL the agent should share with the human.
    // It opens a hosted page that shows the QR and deep link button,
    // works on every device and platform, and polls for completion.
    const scanUrl =
      asString(data.scanUrl as unknown) ??
      `${config.apiUrl}/scan/${sessionToken}`;

    // Prefer the pre-rendered base64 from the API; fall back to rendering from deepLink.
    let qrBase64 = asString(data.qrImageBase64 as unknown);
    if (!qrBase64 && deepLink) {
      qrBase64 = await renderQrBase64(deepLink).catch(() => undefined);
    }

    const textContent = {
      type: "text" as const,
      text: JSON.stringify(
        {
          scan_url: scanUrl,
          session_token: sessionToken,
          agent_address: agentAddress,
          deep_link: deepLink,
          expires_at: expiresAt,
          instructions:
            `Share this URL with the human to complete registration: ${scanUrl}\n` +
            (instructions ?? "Scan the QR code with the Self app."),
          next_step:
            "Share scan_url with the human — they open it on any device to scan the QR or tap the deep link. " +
            "Then call self_check_registration with this session_token to poll for completion.",
        },
        null,
        2,
      ),
    };

    if (qrBase64) {
      return {
        content: [
          { type: "image" as const, data: qrBase64, mimeType: "image/png" },
          textContent,
        ],
      };
    }

    return { content: [textContent] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to initiate registration: ${message}`);
  }
}

// ── Check Registration (via REST API) ───────────────────────────────────────

interface CheckRegistrationArgs {
  session_token: string;
}

export async function handleCheckRegistration(
  args: CheckRegistrationArgs,
  config: McpConfig,
) {
  try {
    const response = await fetch(`${config.apiUrl}/api/agent/register/status`, {
      headers: {
        Authorization: `Bearer ${args.session_token}`,
      },
    });

    if (!response.ok) {
      const err = await readJsonObject(response).catch(
        () => ({ error: response.statusText }) as JsonObject,
      );
      const msg = asString(err.error) || response.statusText;

      if (response.status === 410) {
        return toolSuccess({
          status: "expired",
          message:
            "Registration session expired. Use self_register_agent to start a new registration.",
        });
      }

      return toolError(`Failed to check registration: ${msg}`);
    }

    const data = await readJsonObject(response);
    const stage = asString(data.stage);

    if (stage === "completed") {
      return toolSuccess({
        status: "verified",
        agent_id: data.agentId,
        agent_address: asString(data.agentAddress),
        session_token: asString(data.sessionToken),
        credentials: data.credentials,
        message:
          "Agent registered successfully! " +
          "The agent address is now verified on-chain.",
      });
    }

    return toolSuccess({
      status: "pending",
      session_token: asString(data.sessionToken),
      message:
        "Registration not yet complete. The human has not scanned the QR code yet. " +
        "Call self_check_registration again with the updated session_token to keep polling.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to check registration status: ${message}`);
  }
}

// ── Deregister Agent ────────────────────────────────────────────────────────

interface DeregisterAgentArgs {
  network?: "mainnet" | "testnet";
}

interface DeregistrationRequestSession {
  sessionToken: string;
  deepLink?: string;
  expiresAt?: string;
  humanInstructions: string[];
}

export async function handleDeregisterAgent(
  args: DeregisterAgentArgs,
  config: McpConfig,
) {
  if (!config.privateKey) {
    return toolError(
      "No agent identity configured. Set SELF_AGENT_PRIVATE_KEY in your MCP server configuration " +
        "to deregister an agent.",
    );
  }

  const network = args.network ?? config.network;

  try {
    const agent = new SelfAgent({
      privateKey: config.privateKey,
      network,
      rpcUrl: config.rpcUrl,
    });

    const session = (await agent.requestDeregistration({
      apiBase: config.apiUrl,
    })) as DeregistrationRequestSession;
    const scanUrl = `${config.apiUrl}/scan/${session.sessionToken}`;

    let qrBase64: string | undefined;
    if (session.deepLink) {
      qrBase64 = await renderQrBase64(session.deepLink).catch(() => undefined);
    }

    const textContent = {
      type: "text" as const,
      text: JSON.stringify(
        {
          scan_url: scanUrl,
          session_id: session.sessionToken,
          deep_link: session.deepLink,
          expires_at: session.expiresAt,
          instructions:
            `Share this URL with the human to confirm deregistration: ${scanUrl}\n` +
            session.humanInstructions.join("\n"),
          warning:
            "WARNING: Deregistration is IRREVERSIBLE. The agent's on-chain identity will be permanently revoked. " +
            "The human owner must scan the QR code with the Self app to confirm.",
        },
        null,
        2,
      ),
    };

    if (qrBase64) {
      return {
        content: [
          { type: "image" as const, data: qrBase64, mimeType: "image/png" },
          textContent,
        ],
      };
    }

    return { content: [textContent] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to initiate deregistration: ${message}`);
  }
}
