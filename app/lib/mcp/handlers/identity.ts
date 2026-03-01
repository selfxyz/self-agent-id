// app/lib/mcp/handlers/identity.ts

import { SelfAgent } from "@selfxyz/agent-sdk";
import type { McpConfig } from "../config";
import { toolError, toolSuccess, formatCredentialsSummary } from "../utils";

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
        mode: "agent-identity",
        network,
        disclosures: {
          ...(args.minimum_age != null ? { minimumAge: args.minimum_age } : {}),
          ...(args.ofac != null ? { ofac: args.ofac } : {}),
        },
        ...(args.human_address ? { humanAddress: args.human_address } : {}),
      }),
    });

    if (!response.ok) {
      const err = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      return toolError(
        `Registration failed: ${err.error || response.statusText}`,
      );
    }

    const data = await response.json();

    return toolSuccess({
      session_token: data.sessionToken,
      agent_address: data.agentAddress,
      qr_data: data.qrData,
      deep_link: data.deepLink,
      expires_at: data.expiresAt,
      instructions:
        data.humanInstructions?.join("\n") ||
        "Scan the QR code with the Self app.",
      next_step:
        "Have the human scan the QR/deep link, then call self_check_registration " +
        "with this session_token. The private key will be returned only after verification completes.",
    });
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
      const err = await response
        .json()
        .catch(() => ({ error: response.statusText }));
      const msg = err.error || response.statusText;

      if (response.status === 410) {
        return toolSuccess({
          status: "expired",
          message:
            "Registration session expired. Use self_register_agent to start a new registration.",
        });
      }

      return toolError(`Failed to check registration: ${msg}`);
    }

    const data = await response.json();

    if (data.stage === "completed") {
      return toolSuccess({
        status: "verified",
        agent_id: data.agentId,
        agent_address: data.agentAddress,
        session_token: data.sessionToken,
        credentials: data.credentials,
        message:
          "Agent registered successfully! " +
          "The agent address is now verified on-chain.",
      });
    }

    return toolSuccess({
      status: "pending",
      session_token: data.sessionToken,
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

    const session = await agent.requestDeregistration({
      apiBase: config.apiUrl,
    });
    const qrUrl = `${config.apiUrl}/qr/${session.sessionToken}`;

    return toolSuccess({
      session_id: session.sessionToken,
      qr_url: qrUrl,
      deep_link: session.deepLink,
      expires_at: session.expiresAt,
      instructions: session.humanInstructions.join("\n"),
      warning:
        "WARNING: Deregistration is IRREVERSIBLE. The agent's on-chain identity will be permanently revoked. " +
        "The human owner must scan the QR code with the Self app to confirm.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return toolError(`Failed to initiate deregistration: ${message}`);
  }
}
