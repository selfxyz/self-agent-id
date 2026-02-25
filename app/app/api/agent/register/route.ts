// POST /api/agent/register — Initiate agent registration
//
// Creates a session, generates keypair (for agent-identity / wallet-free modes),
// builds userDefinedData, and returns Self app QR data + deep link.

import { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  buildSimpleRegisterUserDataAscii,
  buildAdvancedRegisterUserDataAscii,
  buildWalletFreeRegisterUserDataAscii,
  signRegistrationChallenge,
  getRegistrationConfigIndex,
  type RegistrationDisclosures,
} from "@selfxyz/agent-sdk";
import { SelfAppBuilder, getUniversalLink } from "@selfxyz/qrcode";
import { createSessionToken, encryptSession } from "@/lib/session-token";
import {
  getSessionSecret,
  getNetworkConfig,
  isValidNetwork,
  isValidAddress,
  humanInstructions,
  jsonResponse,
  errorResponse,
  corsResponse,
  type ApiNetwork,
} from "@/lib/agent-api-helpers";

type Mode = "simple" | "verified-wallet" | "agent-identity" | "wallet-free" | "privy";

const VALID_MODES = new Set<Mode>([
  "simple",
  "verified-wallet",
  "agent-identity",
  "wallet-free",
  "privy",
]);

interface RegisterRequestBody {
  mode: string;
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
  humanAddress?: string;
  agentName?: string;
  agentDescription?: string;
  callbackUrl?: string;
}

export async function POST(req: NextRequest) {
  let body: RegisterRequestBody;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // ── Validate mode ────────────────────────────────────────────────────────
  const rawMode = body.mode === "verified-wallet" ? "simple" : body.mode;
  if (!rawMode || !VALID_MODES.has(rawMode as Mode)) {
    return errorResponse(
      `Invalid mode: "${body.mode}". Valid modes: simple, verified-wallet, agent-identity, wallet-free, privy`,
      400,
    );
  }
  const mode = rawMode as Mode;

  // ── Validate network ─────────────────────────────────────────────────────
  if (!body.network || !isValidNetwork(body.network)) {
    return errorResponse(
      `Invalid network: "${body.network}". Valid: mainnet, testnet`,
      400,
    );
  }
  const network = body.network as ApiNetwork;
  const networkConfig = getNetworkConfig(network);

  // ── Validate humanAddress (required for simple + agent-identity) ────────
  const needsHumanAddress = mode === "simple" || mode === "agent-identity" || mode === "privy";
  if (needsHumanAddress && (!body.humanAddress || !isValidAddress(body.humanAddress))) {
    return errorResponse(
      "humanAddress is required and must be a valid Ethereum address for this mode",
      400,
    );
  }

  // ── Build disclosures ────────────────────────────────────────────────────
  const disclosures: RegistrationDisclosures = {
    minimumAge: (body.disclosures?.minimumAge ?? 0) as 0 | 18 | 21,
    ofac: body.disclosures?.ofac ?? false,
  };

  // Validate minimumAge
  if (![0, 18, 21].includes(disclosures.minimumAge!)) {
    return errorResponse("minimumAge must be 0, 18, or 21", 400);
  }

  try {
    const secret = getSessionSecret();

    // ── Generate agent keypair or derive address ─────────────────────────
    let agentPrivateKey: string | undefined;
    let agentAddress: string;
    let humanAddress: string;
    let userDefinedData: string;

    if (mode === "simple") {
      // Simple / verified-wallet: agent address = human address
      humanAddress = ethers.getAddress(body.humanAddress!);
      agentAddress = humanAddress;
      userDefinedData = buildSimpleRegisterUserDataAscii(disclosures);
    } else if (mode === "agent-identity" || mode === "privy") {
      // Agent-identity: generate fresh keypair, human wallet signs nothing server-side
      humanAddress = ethers.getAddress(body.humanAddress!);
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;

      const signedChallenge = await signRegistrationChallenge(
        agentPrivateKey,
        {
          humanIdentifier: humanAddress,
          chainId: networkConfig.chainId,
          registryAddress: networkConfig.registryAddress,
        },
      );

      userDefinedData = buildAdvancedRegisterUserDataAscii({
        agentAddress,
        signature: signedChallenge,
        disclosures,
      });
    } else {
      // Wallet-free: generate fresh keypair, agent address is also the userId
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;
      humanAddress = agentAddress; // userId = agent address for wallet-free

      const signedChallenge = await signRegistrationChallenge(
        agentPrivateKey,
        {
          humanIdentifier: ethers.getAddress(agentAddress),
          chainId: networkConfig.chainId,
          registryAddress: networkConfig.registryAddress,
        },
      );

      userDefinedData = buildWalletFreeRegisterUserDataAscii({
        agentAddress,
        signature: signedChallenge,
        disclosures,
      });
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

    // userId for the Self app: lowercase address without 0x prefix (the builder strips 0x for hex type)
    const userId =
      mode === "wallet-free"
        ? ethers.getAddress(agentAddress).toLowerCase()
        : humanAddress.toLowerCase();

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
        type: "register",
        mode,
        network,
        agentPrivateKey,
        humanAddress,
        agentAddress,
      },
      secret,
    );

    // Update stage to qr-ready and store QR data in the token
    const updatedData = { ...sessionData, stage: "qr-ready", qrData: selfApp };
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
      network,
      mode,
      configIndex: getRegistrationConfigIndex(disclosures),
      expiresAt,
      timeRemainingMs,
      humanInstructions: humanInstructions("qr-ready"),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("SESSION_SECRET")) {
      return errorResponse(message, 500);
    }
    return errorResponse(`Registration init failed: ${message}`, 500);
  }
}

export async function OPTIONS() {
  return corsResponse();
}
