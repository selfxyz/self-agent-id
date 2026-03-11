// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// POST /api/agent/identify — Initiate passport scan to discover agents
//
// Creates a Self app QR session with ACTION_IDENTIFY (0x49). The contract
// emits NullifierIdentified(nullifier, agentCount) without any state changes.
// The status endpoint polls for this event and returns the nullifier so the
// frontend can call getAgentsForNullifier() to display all agents.

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
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

/** Self Hub V2 action byte for identify ('I' = 0x49) */
const ACTION_IDENTIFY = 0x49;

interface IdentifyRequestBody {
  network: string;
}

/**
 * Build raw bytes userData for ACTION_IDENTIFY.
 *
 * Layout (2 bytes):
 *   [0] = 0x49 (ACTION_IDENTIFY, ASCII 'I')
 *   [1] = 0x00 (config index — unused but required by contract parser)
 */
function buildIdentifyUserData(): string {
  return String.fromCharCode(ACTION_IDENTIFY) + String.fromCharCode(0x30); // '0'
}

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit({
    key: `identify:${ip}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return errorResponse("Too many requests", 429);
  }

  let body: IdentifyRequestBody;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return errorResponse("Invalid JSON body", 400);
    }
    body = parsed as IdentifyRequestBody;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!body.network || !isValidNetwork(body.network)) {
    return errorResponse(
      `Invalid network: "${body.network}". Valid: mainnet, testnet`,
      400,
    );
  }
  const network = body.network;
  const networkConfig = getNetworkConfig(network);

  try {
    const secret = getSessionSecret();

    const userDefinedData = buildIdentifyUserData();

    // For identify, we use a dummy userId — the contract doesn't care about
    // the caller's identity, only the passport nullifier from the ZK proof.
    const dummyUserId = ethers.ZeroAddress.toLowerCase();

    const selfApp = new SelfAppBuilder({
      version: 2,
      appName: process.env.NEXT_PUBLIC_SELF_APP_NAME || "Self Agent ID",
      scope: process.env.NEXT_PUBLIC_SELF_SCOPE_SEED || "self-agent-id",
      endpoint: networkConfig.registryAddress,
      logoBase64: "https://i.postimg.cc/mrmVf9hm/self.png",
      userId: dummyUserId,
      endpointType: networkConfig.selfEndpointType,
      userIdType: "hex",
      userDefinedData,
      disclosures: {},
    }).build();

    const deepLink = getUniversalLink(selfApp);

    const { data: sessionData } = createSessionToken(
      { type: "identify", network },
      secret,
    );

    const updatedData = {
      ...sessionData,
      stage: "qr-ready",
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
      network,
      expiresAt,
      timeRemainingMs,
      humanInstructions: [
        "Open the Self app on your phone.",
        "Scan the QR code to identify yourself.",
        "Follow the prompts to scan your passport.",
        "Your agents will be shown once identification is complete.",
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[identify] init failed:", message);
    if (message.includes("SESSION_SECRET")) {
      return errorResponse("Server configuration error", 500);
    }
    return errorResponse(`Identify session init failed: ${message}`, 500);
  }
}

export function OPTIONS() {
  return corsResponse();
}
