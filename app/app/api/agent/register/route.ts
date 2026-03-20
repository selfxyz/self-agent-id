// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// POST /api/agent/register — Initiate agent registration
//
// Creates a session, generates keypair (for linked / wallet-free modes),
// builds userDefinedData, and returns Self app QR data + deep link.

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
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
} from "@/lib/agent-api-helpers";
import { checkRateLimit } from "@/lib/rateLimit";
import { renderQrBase64 } from "@/lib/renderQr";
import {
  computeEd25519ChallengeHash,
  computeExtKpub,
  buildEd25519UserData,
  isValidEd25519PubkeyHex,
  deriveEd25519Address,
} from "@/lib/ed25519";
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — noble/curves v2 export map
import { ed25519 } from "@noble/curves/ed25519.js";
import { typedRegistry } from "@/lib/contract-types";

type Mode =
  | "linked"
  | "wallet-free"
  | "ed25519"
  | "ed25519-linked"
  | "privy"
  | "smartwallet";

const VALID_MODES = new Set<Mode>([
  "linked",
  "wallet-free",
  "ed25519",
  "ed25519-linked",
  "privy",
  "smartwallet",
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
  ed25519Pubkey?: string; // 64 hex chars (no 0x)
  ed25519Signature?: string; // 128 hex chars (no 0x)
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 registration requests per minute per IP
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await checkRateLimit({
    key: `register:${ip}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return errorResponse("Too many requests", 429);
  }

  let body: RegisterRequestBody;
  try {
    const parsed = (await req.json()) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return errorResponse("Invalid JSON body", 400);
    }
    body = parsed as RegisterRequestBody;
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  // ── Validate mode ────────────────────────────────────────────────────────
  const rawMode = body.mode;
  if (!rawMode || !VALID_MODES.has(rawMode as Mode)) {
    return errorResponse(
      `Invalid mode: "${body.mode}". Valid modes: linked, wallet-free, ed25519, ed25519-linked, privy, smartwallet`,
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
  const network = body.network;
  const networkConfig = getNetworkConfig(network);

  // ── Validate humanAddress (required for linked, ed25519-linked, privy, smartwallet) ──
  const needsHumanAddress =
    mode === "linked" ||
    mode === "ed25519-linked" ||
    mode === "privy" ||
    mode === "smartwallet";
  if (
    needsHumanAddress &&
    (!body.humanAddress || !isValidAddress(body.humanAddress))
  ) {
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

    if (mode === "linked" || mode === "privy" || mode === "smartwallet") {
      // Linked: generate fresh keypair, human wallet signs nothing server-side
      humanAddress = ethers.getAddress(body.humanAddress!);
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;

      // Nonce is 0 for freshly generated agent wallets (never registered before)
      const signedChallenge = await signRegistrationChallenge(agentPrivateKey, {
        humanIdentifier: humanAddress,
        chainId: networkConfig.chainId,
        registryAddress: networkConfig.registryAddress,
        nonce: 0,
      });

      userDefinedData = buildAdvancedRegisterUserDataAscii({
        agentAddress,
        signature: signedChallenge,
        disclosures,
      });
    } else if (mode === "ed25519") {
      // Ed25519 wallet-free: derive humanAddress from pubkey, no human wallet needed
      const pubkey = body.ed25519Pubkey;
      const signature = body.ed25519Signature;

      if (!pubkey || !isValidEd25519PubkeyHex(pubkey)) {
        return errorResponse(
          "ed25519Pubkey is required and must be a valid 64-char hex Ed25519 public key",
          400,
        );
      }
      if (!signature || !/^[0-9a-fA-F]{128}$/.test(signature)) {
        return errorResponse(
          "ed25519Signature is required and must be 128 hex chars (64-byte Ed25519 signature)",
          400,
        );
      }

      agentAddress = deriveEd25519Address(pubkey);
      humanAddress = agentAddress; // wallet-free: human = derived agent address

      // Fetch nonce from contract
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
      const registry = typedRegistry(networkConfig.registryAddress, provider);
      const nonce = await registry.ed25519Nonce("0x" + pubkey);

      // Compute challenge hash using derived address
      const challengeHash = computeEd25519ChallengeHash({
        humanAddress,
        chainId: BigInt(networkConfig.chainId),
        registryAddress: networkConfig.registryAddress,
        nonce,
      });

      // Verify Ed25519 signature off-chain
      const msgBytes = ethers.getBytes(challengeHash);
      const sigBytes = hexToBytes(signature);
      const pubBytes = hexToBytes(pubkey);
      const isValid = ed25519.verify(sigBytes, msgBytes, pubBytes);
      if (!isValid) {
        return errorResponse("Ed25519 signature verification failed", 400);
      }

      const extKpub = computeExtKpub(pubkey);
      const configIndex = getRegistrationConfigIndex(disclosures);
      userDefinedData = buildEd25519UserData({
        configIndex,
        ed25519Pubkey: pubkey,
        signature: signature,
        extKpub,
      });
    } else if (mode === "ed25519-linked") {
      // Ed25519-linked: agent provides their own keypair and pre-signed challenge
      humanAddress = ethers.getAddress(body.humanAddress!);

      const pubkey = body.ed25519Pubkey;
      const signature = body.ed25519Signature;

      if (!pubkey || !isValidEd25519PubkeyHex(pubkey)) {
        return errorResponse(
          "ed25519Pubkey is required and must be a valid 64-char hex Ed25519 public key",
          400,
        );
      }
      if (!signature || !/^[0-9a-fA-F]{128}$/.test(signature)) {
        return errorResponse(
          "ed25519Signature is required and must be 128 hex chars (64-byte Ed25519 signature)",
          400,
        );
      }

      // Fetch nonce from contract
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
      const registry = typedRegistry(networkConfig.registryAddress, provider);
      const nonce = await registry.ed25519Nonce("0x" + pubkey);

      // Compute challenge hash
      const challengeHash = computeEd25519ChallengeHash({
        humanAddress,
        chainId: BigInt(networkConfig.chainId),
        registryAddress: networkConfig.registryAddress,
        nonce,
      });

      // Verify Ed25519 signature off-chain
      const msgBytes = ethers.getBytes(challengeHash);
      const sigBytes = hexToBytes(signature);
      const pubBytes = hexToBytes(pubkey);
      const isValid = ed25519.verify(sigBytes, msgBytes, pubBytes);
      if (!isValid) {
        return errorResponse("Ed25519 signature verification failed", 400);
      }

      // Compute extKpub
      const extKpub = computeExtKpub(pubkey);

      // Build userData
      const configIndex = getRegistrationConfigIndex(disclosures);
      userDefinedData = buildEd25519UserData({
        configIndex,
        ed25519Pubkey: pubkey,
        signature: signature,
        extKpub,
        guardian: humanAddress.replace(/^0x/, "").toLowerCase(),
      });

      agentAddress = deriveEd25519Address(pubkey);
      // No private key to store — the agent has their own
    } else {
      // Wallet-free: generate fresh keypair, agent address is also the userId
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;
      humanAddress = agentAddress; // userId = agent address for wallet-free

      // Nonce is 0 for freshly generated agent wallets (never registered before)
      const signedChallenge = await signRegistrationChallenge(agentPrivateKey, {
        humanIdentifier: ethers.getAddress(agentAddress),
        chainId: networkConfig.chainId,
        registryAddress: networkConfig.registryAddress,
        nonce: 0,
      });

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
    if (body.disclosures?.date_of_birth)
      selfAppDisclosures.date_of_birth = true;
    if (body.disclosures?.gender) selfAppDisclosures.gender = true;
    if (body.disclosures?.issuing_state)
      selfAppDisclosures.issuing_state = true;
    if (body.disclosures?.ofac) selfAppDisclosures.ofac = true;
    if (disclosures.minimumAge && disclosures.minimumAge > 0) {
      selfAppDisclosures.minimumAge = disclosures.minimumAge;
    }

    // userId for the Self app: lowercase address without 0x prefix (the builder strips 0x for hex type)
    // For ed25519 mode, the userId is the humanAddress (the human doing the passport scan)
    const userId =
      mode === "wallet-free" || mode === "ed25519"
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
    const qrImageBase64 = await renderQrBase64(deepLink);

    // Construct scanUrl after finalToken is available (set below), so we
    // build it just before the response. Derive base URL from request origin
    // or NEXT_PUBLIC_APP_URL env var.
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      `${req.headers.get("x-forwarded-proto") ?? "https"}://${req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000"}`;

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

    // Store ed25519 pubkey in session for status polling
    if (
      (mode === "ed25519" || mode === "ed25519-linked") &&
      body.ed25519Pubkey
    ) {
      sessionData.ed25519Pubkey = body.ed25519Pubkey;
    }

    // Update stage to qr-ready and store QR data in the token
    const updatedData = { ...sessionData, stage: "qr-ready", qrData: selfApp };
    const finalToken = encryptSession(updatedData, secret);

    const expiresAt = updatedData.expiresAt!;
    const timeRemainingMs = Math.max(
      0,
      new Date(expiresAt).getTime() - Date.now(),
    );

    const scanUrl = `${appUrl}/scan/${finalToken}`;

    return jsonResponse({
      sessionToken: finalToken,
      stage: "qr-ready",
      qrData: selfApp,
      deepLink,
      qrImageBase64,
      scanUrl,
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

export function OPTIONS() {
  return corsResponse();
}
