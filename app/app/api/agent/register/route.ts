// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * POST /api/agent/register — start an agent registration session.
 *
 * Auth: none. Rate limit: 10/min per IP.
 * Generates the agent key (linked, wallet-free, privy, smartwallet) or
 * verifies the caller's Ed25519 challenge signature (ed25519 modes), then
 * returns a session token, the Self app QR (image, deep link, scan URL) and
 * the agent address.
 */

import type { NextRequest } from "next/server";
import { ethers } from "ethers";
import {
  buildAdvancedRegisterUserDataAscii,
  buildWalletFreeRegisterUserDataAscii,
  signRegistrationChallenge,
  getRegistrationConfigIndex,
  type RegistrationDisclosures,
} from "@selfxyz/agent-sdk";
import { getUniversalLink } from "@selfxyz/sdk-common";
import {
  createQrToken,
  createSessionToken,
  encryptSession,
} from "@/lib/session-token";
import {
  ERRORS,
  requireSessionSecret,
  getNetworkConfig,
  isValidNetwork,
  parseAddress,
  humanInstructions,
  jsonResponse,
  errorResponse,
  corsResponse,
  getClientIp,
  getAppBaseUrl,
  rateLimitResponse,
  readJsonObjectBody,
  parseDisclosures,
} from "@/lib/agent-api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { renderQrBase64 } from "@/lib/render-qr";
import {
  computeEd25519ChallengeHash,
  computeExtKpub,
  buildEd25519UserData,
  isValidEd25519PubkeyHex,
  deriveEd25519Address,
  verifyEd25519Signature,
} from "@/lib/ed25519";
import { typedRegistry } from "@/lib/contract-types";
import {
  MODES_REQUIRING_HUMAN,
  REGISTRATION_MODES,
  normalizeMode,
} from "@/lib/registration-modes";
import { buildSelfApp } from "@/lib/self-app";

/**
 * Validate the request, prepare the agent key and userDefinedData, and open a
 * registration session at stage "qr-ready".
 *
 * @param req - JSON body: {mode, network, humanAddress? (required for linked,
 *   ed25519-linked, privy, smartwallet), ed25519Pubkey?, ed25519Signature?
 *   (both required for ed25519 modes), disclosures?}.
 * @returns 200 {sessionToken, stage: "qr-ready", qrData, deepLink,
 *   qrImageBase64, scanUrl, agentAddress, network, mode, configIndex,
 *   expiresAt, timeRemainingMs, humanInstructions}; 400 {error} validation or
 *   bad Ed25519 signature; 413 {error} body too large; 429 {error,
 *   retryAfterMs}; 500 {error} init failure, ERRORS.qrRender,
 *   or SESSION_SECRET unset; 502 {error} nonce lookup failed.
 */
export async function POST(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `register:${getClientIp(req)}`,
    limit: 10,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfterMs);
  }

  const parsedBody = await readJsonObjectBody(req);
  if (!parsedBody.ok) return parsedBody.response;
  const body = parsedBody.body;

  // ── Validate mode ────────────────────────────────────────────────────────
  const mode = normalizeMode(body.mode);
  if (!mode) {
    return errorResponse(
      `Invalid mode. Valid modes: ${REGISTRATION_MODES.join(", ")}`,
      400,
    );
  }

  // ── Validate network ─────────────────────────────────────────────────────
  if (typeof body.network !== "string" || !isValidNetwork(body.network)) {
    return errorResponse(ERRORS.invalidNetwork, 400);
  }
  const network = body.network;
  const networkConfig = getNetworkConfig(network);

  // ── Validate humanAddress (required for linked, ed25519-linked, privy,
  // smartwallet; wallet-free modes have none, but a malformed one is still
  // rejected rather than silently dropped) ──────────────────────────────────
  let humanAddress: string | null = null;
  if (MODES_REQUIRING_HUMAN.has(mode)) {
    humanAddress = parseAddress(body.humanAddress);
    if (!humanAddress) {
      return errorResponse(
        "humanAddress is required for this mode and must be a non-zero 0x-prefixed Ethereum address",
        400,
      );
    }
  } else if (
    body.humanAddress !== undefined &&
    !parseAddress(body.humanAddress)
  ) {
    return errorResponse(
      "humanAddress must be a non-zero 0x-prefixed Ethereum address",
      400,
    );
  }

  // ── Validate disclosures ─────────────────────────────────────────────────
  const parsedDisclosures = parseDisclosures(body.disclosures);
  if (!parsedDisclosures.ok) {
    return errorResponse(parsedDisclosures.error, 400);
  }
  const requested = parsedDisclosures.disclosures;
  const disclosures: RegistrationDisclosures = {
    minimumAge: requested.minimumAge,
    ofac: requested.ofac,
  };

  // ── Validate Ed25519 inputs ──────────────────────────────────────────────
  let ed25519Pubkey: string | undefined;
  let ed25519Signature: string | undefined;
  if (mode === "ed25519" || mode === "ed25519-linked") {
    if (!isValidEd25519PubkeyHex(body.ed25519Pubkey)) {
      return errorResponse(
        "ed25519Pubkey is required and must be a valid 64-char hex Ed25519 public key",
        400,
      );
    }
    if (
      typeof body.ed25519Signature !== "string" ||
      !/^[0-9a-fA-F]{128}$/.test(body.ed25519Signature)
    ) {
      return errorResponse(
        "ed25519Signature is required and must be 128 hex chars (64-byte Ed25519 signature)",
        400,
      );
    }
    ed25519Pubkey = body.ed25519Pubkey.toLowerCase();
    ed25519Signature = body.ed25519Signature.toLowerCase();
  }

  const secret = requireSessionSecret();
  if (secret instanceof Response) return secret;

  try {
    // ── Generate agent keypair or verify the agent's Ed25519 signature ────
    let agentPrivateKey: string | undefined;
    let agentAddress: string;
    let userDefinedData: string;

    if (ed25519Pubkey && ed25519Signature) {
      // ed25519: wallet-free, the derived address is the human identifier.
      // ed25519-linked: the human's wallet is the guardian.
      agentAddress = deriveEd25519Address(ed25519Pubkey);
      humanAddress = humanAddress ?? agentAddress;

      let nonce: bigint;
      try {
        const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
        const registry = typedRegistry(networkConfig.registryAddress, provider);
        nonce = await registry.ed25519Nonce("0x" + ed25519Pubkey);
      } catch (err) {
        console.error("register: ed25519Nonce lookup failed", err);
        return errorResponse(ERRORS.rpc, 502);
      }

      const challengeHash = computeEd25519ChallengeHash({
        humanAddress,
        chainId: BigInt(networkConfig.chainId),
        registryAddress: networkConfig.registryAddress,
        nonce,
      });
      if (
        !verifyEd25519Signature(ed25519Signature, challengeHash, ed25519Pubkey)
      ) {
        return errorResponse("Ed25519 signature verification failed", 400);
      }

      userDefinedData = buildEd25519UserData({
        configIndex: getRegistrationConfigIndex(disclosures),
        ed25519Pubkey,
        signature: ed25519Signature,
        extKpub: computeExtKpub(ed25519Pubkey),
        guardian:
          mode === "ed25519-linked"
            ? humanAddress.slice(2).toLowerCase()
            : undefined,
      });
    } else {
      // linked / privy / smartwallet: server-generated agent key bound to the
      // human's wallet. wallet-free: server-generated key that is also the
      // human identifier. All three non-wallet-free modes behave identically
      // here; the key is exported via /register/export after completion.
      const wallet = ethers.Wallet.createRandom();
      agentPrivateKey = wallet.privateKey;
      agentAddress = wallet.address;
      humanAddress = humanAddress ?? agentAddress;

      // Nonce is 0 for freshly generated agent wallets (never registered before)
      const signedChallenge = await signRegistrationChallenge(agentPrivateKey, {
        humanIdentifier: humanAddress,
        chainId: networkConfig.chainId,
        registryAddress: networkConfig.registryAddress,
        nonce: 0,
      });

      userDefinedData =
        mode === "wallet-free"
          ? buildWalletFreeRegisterUserDataAscii({
              agentAddress,
              signature: signedChallenge,
              disclosures,
            })
          : buildAdvancedRegisterUserDataAscii({
              agentAddress,
              signature: signedChallenge,
              disclosures,
            });
    }

    // ── Build Self app QR config ─────────────────────────────────────────
    // wallet-free / ed25519: humanAddress is the agent's own address.
    const selfApp = buildSelfApp({
      network,
      userId: humanAddress,
      userDefinedData,
      disclosures: requested,
    });

    const deepLink = getUniversalLink(selfApp);
    let qrImageBase64: string;
    try {
      qrImageBase64 = await renderQrBase64(deepLink);
    } catch (err) {
      console.error("register: QR render failed:", err);
      return errorResponse(ERRORS.qrRender, 500);
    }

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
    const updatedData = {
      ...sessionData,
      stage: "qr-ready",
      qrData: selfApp,
      ...(ed25519Pubkey ? { ed25519Pubkey } : {}),
    };
    const sessionToken = encryptSession(updatedData, secret);

    const expiresAt = updatedData.expiresAt!;
    const timeRemainingMs = Math.max(
      0,
      new Date(expiresAt).getTime() - Date.now(),
    );

    // The scan URL carries a QR-only token: it renders the deep link and
    // can never be used as a session token (status / export).
    const scanUrl = `${getAppBaseUrl(req)}/api/qr/${createQrToken(deepLink, expiresAt, secret)}`;

    return jsonResponse({
      sessionToken,
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
    console.error("register: init failed", err);
    return errorResponse("Registration init failed", 500);
  }
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
