// POST /api/agent/deregister — Initiate agent deregistration
//
// Validates the agent is registered on-chain, builds the deregistration
// userDefinedData, and returns Self app QR data + deep link.

import { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  buildSimpleDeregisterUserDataAscii,
  buildAdvancedDeregisterUserDataAscii,
  getRegistrationConfigIndex,
  type RegistrationDisclosures,
} from "@selfxyz/agent-sdk";
import { SelfAppBuilder, getUniversalLink } from "@selfxyz/qrcode";
import { createSessionToken, encryptSession } from "@/lib/session-token";
import { REGISTRY_ABI } from "@/lib/constants";
import {
  getSessionSecret,
  getNetworkConfig,
  isValidNetwork,
  isValidAddress,
  checkAgentOnChain,
  jsonResponse,
  errorResponse,
  corsResponse,
  type ApiNetwork,
} from "@/lib/agent-api-helpers";

interface DeregisterRequestBody {
  network: string;
  agentAddress: string;
  agentPrivateKey?: string;
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

export async function POST(req: NextRequest) {
  let body: DeregisterRequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // ── Validate network ─────────────────────────────────────────────────────
  if (!body.network || !isValidNetwork(body.network)) {
    return errorResponse(
      `Invalid network: "${body.network}". Valid: mainnet, testnet`,
      400,
    );
  }
  const network = body.network as ApiNetwork;
  const networkConfig = getNetworkConfig(network);

  // ── Validate agentAddress ────────────────────────────────────────────────
  if (!body.agentAddress || !isValidAddress(body.agentAddress)) {
    return errorResponse(
      "agentAddress is required and must be a valid Ethereum address",
      400,
    );
  }
  const agentAddress = ethers.getAddress(body.agentAddress);

  // ── Build disclosures ────────────────────────────────────────────────────
  const disclosures: RegistrationDisclosures = {
    minimumAge: (body.disclosures?.minimumAge ?? 0) as 0 | 18 | 21,
    ofac: body.disclosures?.ofac ?? false,
  };

  if (![0, 18, 21].includes(disclosures.minimumAge!)) {
    return errorResponse("minimumAge must be 0, 18, or 21", 400);
  }

  try {
    const secret = getSessionSecret();

    // ── Verify agent is registered on-chain ──────────────────────────────
    const { isVerified, agentId } = await checkAgentOnChain(
      agentAddress,
      networkConfig,
    );
    if (!isVerified) {
      return errorResponse(
        "Agent is not currently registered on-chain",
        404,
      );
    }

    // ── Determine mode from on-chain data ────────────────────────────────
    // If the agentPubKey == zeroPadValue(humanAddress), it was a simple registration.
    // Otherwise it was advanced or wallet-free.
    const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
    const registry = new ethers.Contract(
      networkConfig.registryAddress,
      REGISTRY_ABI,
      provider,
    );
    const nftOwner: string = await registry.ownerOf(agentId);

    // Determine the userId for the QR: the human who originally registered.
    // For simple mode: nftOwner == agentAddress (human wallet).
    // For advanced mode: nftOwner == humanAddress (the wallet that initiated).
    // For wallet-free: nftOwner == agentAddress (agent owns the NFT).
    const isSimple =
      ethers.zeroPadValue(nftOwner, 32) ===
      ethers.zeroPadValue(agentAddress, 32);

    let userDefinedData: string;
    let userId: string;

    if (isSimple) {
      // Simple deregistration: action D + config
      userDefinedData = buildSimpleDeregisterUserDataAscii(disclosures);
      userId = agentAddress.toLowerCase();
    } else {
      // Advanced deregistration: action X + config + agentAddr
      userDefinedData = buildAdvancedDeregisterUserDataAscii({
        agentAddress,
        disclosures,
      });
      userId = nftOwner.toLowerCase();
    }

    // ── Build Self app QR config ─────────────────────────────────────────
    const selfAppDisclosures: Record<string, boolean | number> = {};
    if (body.disclosures?.nationality) selfAppDisclosures.nationality = true;
    if (body.disclosures?.name) selfAppDisclosures.name = true;
    if (body.disclosures?.date_of_birth) selfAppDisclosures.date_of_birth = true;
    if (body.disclosures?.gender) selfAppDisclosures.gender = true;
    if (body.disclosures?.issuing_state) selfAppDisclosures.issuing_state = true;
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
        type: "deregister",
        mode: isSimple ? "simple" : "advanced",
        network,
        humanAddress: isSimple ? agentAddress : nftOwner,
        agentAddress,
      },
      secret,
    );

    // Set stage to qr-ready and store QR data
    const updatedData = {
      ...sessionData,
      stage: "qr-ready",
      agentId: Number(agentId),
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
      agentAddress,
      agentId: Number(agentId),
      network,
      configIndex: getRegistrationConfigIndex(disclosures),
      expiresAt,
      timeRemainingMs,
      humanInstructions: [
        "Open the Self app on your phone.",
        "Scan the QR code to deregister your agent.",
        "This will burn your agent NFT and remove on-chain verification.",
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("SESSION_SECRET")) {
      return errorResponse(message, 500);
    }
    return errorResponse(`Deregistration init failed: ${message}`, 500);
  }
}

export async function OPTIONS() {
  return corsResponse();
}
