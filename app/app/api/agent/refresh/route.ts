// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// POST /api/agent/refresh — Initiate proof refresh for an existing agent
//
// Verifies the agent exists on-chain and has a non-zero configId (meaning it
// was registered via Hub V2 and supports refresh). Builds userData with
// ACTION_REFRESH (0x46) + configIndex + agentId, creates a Self app QR
// session, and returns deep link + session token for polling.

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  getRegistrationConfigIndex,
  type RegistrationDisclosures,
} from "@selfxyz/agent-sdk";
import { SelfAppBuilder, getUniversalLink } from "@selfxyz/qrcode";
import { createSessionToken, encryptSession } from "@/lib/session-token";
import {
  getSessionSecret,
  getNetworkConfig,
  isValidNetwork,
  jsonResponse,
  errorResponse,
  corsResponse,
} from "@/lib/agent-api-helpers";
import { checkRateLimit } from "@/lib/rateLimit";
import { typedRegistry } from "@/lib/contract-types";

/** Self Hub V2 action byte for proof refresh ('F' = 0x46) */
const ACTION_REFRESH = 0x46;

/** The zero bytes32 value — agents with this configId cannot be refreshed */
const ZERO_BYTES32 = "0x" + "0".repeat(64);

interface RefreshRequestBody {
  agentId: number;
  network: string;
  disclosures?: {
    minimumAge?: number;
    ofac?: boolean;
    nationality?: boolean;
    name?: boolean;
    date_of_birth?: boolean;
    gender?: boolean;
    issuing_state?: boolean;
  };
}

/**
 * Build raw bytes userData for ACTION_REFRESH.
 *
 * Layout (34 bytes total):
 *   [0]      = 0x46 (ACTION_REFRESH, ASCII 'F')
 *   [1]      = configIndex as ASCII digit ('0'..'5')
 *   [2..33]  = agentId as uint256, big-endian, 32 bytes
 *
 * The contract reads bytes[0] as the action byte, bytes[1] as config index
 * (supporting both ASCII '0'-'5' and raw 0x00-0x05), and bytes[2..33] via
 * assembly mload as a raw uint256.
 *
 * We return a JavaScript string where each character's code point corresponds
 * to one byte. This is what SelfAppBuilder expects for userDefinedData.
 */
function buildRefreshUserData(agentId: number, configIndex: number): string {
  // Action byte: 'F' (0x46)
  const actionChar = String.fromCharCode(ACTION_REFRESH);

  // Config index as ASCII digit (same pattern as registration)
  const configChar = String(configIndex);

  // AgentId as 32 raw bytes (big-endian uint256)
  // Encode as 0x-prefixed 64-char hex, then convert each byte pair to a char
  const idHex = ethers.zeroPadValue(ethers.toBeHex(agentId), 32).slice(2); // 64 hex chars
  let idChars = "";
  for (let i = 0; i < 64; i += 2) {
    idChars += String.fromCharCode(parseInt(idHex.slice(i, i + 2), 16));
  }

  return actionChar + configChar + idChars;
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 refresh requests per minute per IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit({
    key: `refresh:${ip}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return errorResponse("Too many requests", 429);
  }

  let body: RefreshRequestBody;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return errorResponse("Invalid JSON body", 400);
    }
    body = parsed as RefreshRequestBody;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // ── Validate agentId ────────────────────────────────────────────────────
  if (
    body.agentId == null ||
    !Number.isInteger(body.agentId) ||
    body.agentId <= 0
  ) {
    return errorResponse(
      "agentId is required and must be a positive integer",
      400,
    );
  }
  const agentId = body.agentId;

  // ── Validate network ────────────────────────────────────────────────────
  if (!body.network || !isValidNetwork(body.network)) {
    return errorResponse(
      `Invalid network: "${body.network}". Valid: mainnet, testnet`,
      400,
    );
  }
  const network = body.network;
  const networkConfig = getNetworkConfig(network);

  // ── Build disclosures ───────────────────────────────────────────────────
  const disclosures: RegistrationDisclosures = {
    minimumAge: (body.disclosures?.minimumAge ?? 0) as 0 | 18 | 21,
    ofac: body.disclosures?.ofac ?? false,
  };

  if (![0, 18, 21].includes(disclosures.minimumAge!)) {
    return errorResponse("minimumAge must be 0, 18, or 21", 400);
  }

  try {
    const secret = getSessionSecret();
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = typedRegistry(networkConfig.registryAddress, provider);

    // ── Verify agent exists and has a valid configId ──────────────────────
    const configId = await registry.agentConfigId(BigInt(agentId));

    if (configId === ZERO_BYTES32) {
      return errorResponse(
        "Agent does not support proof refresh (configId is zero). " +
          "This may mean the agent was registered via an external provider or has been deregistered.",
        400,
      );
    }

    // Verify the agent is currently verified
    const hasProof = await registry.hasHumanProof(BigInt(agentId));
    if (!hasProof) {
      return errorResponse(
        "Agent does not currently have a valid human proof. " +
          "The agent may need to re-register instead of refreshing.",
        400,
      );
    }

    // Read current proof expiry so the status endpoint can detect when it changes
    const currentExpiry = await registry.proofExpiresAt(BigInt(agentId));

    // ── Determine the config index from the stored configId ──────────────
    // The contract stores configIds[0..5]. We match against them to find
    // the index, but also allow the caller to specify disclosures which
    // we use as the primary source. We validate they match the on-chain config.
    const configIndex = getRegistrationConfigIndex(disclosures);
    const expectedConfigId = await registry.configIds(BigInt(configIndex));

    if (configId !== expectedConfigId) {
      return errorResponse(
        "Disclosure mismatch: the provided disclosures do not match the agent's " +
          "on-chain verification config. Use the same disclosures as the original registration.",
        400,
      );
    }

    // ── Look up the NFT owner (the human who needs to scan) ──────────────
    const nftOwner: string = await registry.ownerOf(BigInt(agentId));
    const userId = nftOwner.toLowerCase();

    // ── Build userData ───────────────────────────────────────────────────
    const userDefinedData = buildRefreshUserData(agentId, configIndex);

    // ── Build Self app QR config ─────────────────────────────────────────
    const selfAppDisclosures: Record<string, boolean | number> = {};
    if (body.disclosures?.nationality) selfAppDisclosures.nationality = true;
    if (body.disclosures?.name) selfAppDisclosures.name = true;
    if (body.disclosures?.date_of_birth)
      selfAppDisclosures.date_of_birth = true;
    if (body.disclosures?.gender) selfAppDisclosures.gender = true;
    if (body.disclosures?.issuing_state)
      selfAppDisclosures.issuing_state = true;
    if (body.disclosures?.ofac) selfAppDisclosures.ofac = true;
    if (disclosures.minimumAge && disclosures.minimumAge > 0) {
      selfAppDisclosures.minimumAge = disclosures.minimumAge;
    }

    const selfApp = new SelfAppBuilder({
      version: 2,
      appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
      scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
      endpoint: networkConfig.registryAddress,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      userId,
      endpointType: networkConfig.selfEndpointType,
      userIdType: "hex",
      userDefinedData,
      disclosures: selfAppDisclosures,
    }).build();

    const deepLink = getUniversalLink(selfApp);

    // ── Create encrypted session token ───────────────────────────────────
    const { data: sessionData } = createSessionToken(
      {
        type: "refresh",
        network,
        humanAddress: nftOwner,
      },
      secret,
    );

    // Store refresh-specific fields and update stage.
    // originalProofExpiry lets the status endpoint detect when the expiry changes.
    const updatedData = {
      ...sessionData,
      stage: "qr-ready",
      agentId,
      originalProofExpiry: currentExpiry.toString(),
      qrData: selfApp,
    };
    const finalToken = encryptSession(updatedData, secret);

    const expiresAt = updatedData.expiresAt!;
    const timeRemainingMs = Math.max(
      0,
      new Date(expiresAt).getTime() - Date.now(),
    );

    return jsonResponse({
      sessionToken: finalToken,
      stage: "qr-ready",
      qrData: selfApp,
      deepLink,
      agentId,
      network,
      configIndex,
      expiresAt,
      timeRemainingMs,
      humanInstructions: [
        "Open the Self app on your phone.",
        "Scan the QR code to refresh your agent's proof.",
        "Follow the prompts to scan your passport.",
        "Wait for the updated proof to be recorded on-chain.",
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[refresh] init failed:", message);
    if (message.includes("SESSION_SECRET")) {
      return errorResponse("Server configuration error", 500);
    }
    return errorResponse(`Proof refresh init failed: ${message}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
