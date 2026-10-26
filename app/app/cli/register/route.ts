// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /cli/register?payload=<base64url(json)> — QR for a CLI registration
 * handoff.
 *
 * Auth: none. Rate limit: 60/min per IP.
 * The URL printed by `self-agent register open`. Rebuilds the Self request
 * from the CLI payload and returns its QR as a PNG; the CLI's `register wait`
 * then polls the registry. The payload is attacker-controllable (it is just a
 * URL), so only requests for this app's registry, app name and scope are
 * rendered: it must not mint Self disclosure QRs for arbitrary verifiers.
 */

import type { NextRequest } from "next/server";
import { getUniversalLink } from "@selfxyz/qrcode";
import { renderQrPng } from "@/lib/render-qr";
import {
  errorResponse,
  corsResponse,
  getClientIp,
  getNetworkConfig,
  parseAddress,
  parseDisclosures,
  pngResponse,
  rateLimitResponse,
  type ApiNetwork,
  ERRORS,
} from "@/lib/agent-api-helpers";
import { checkRateLimit } from "@/lib/rate-limit";
import { buildSelfApp, selfAppIdentity } from "@/lib/self-app";

/** Longest accepted base64url payload, in characters. */
const MAX_ENCODED_PAYLOAD_LENGTH = 8 * 1024;

/**
 * Registration userData is short ASCII ("R"/"K"/"W"/"D"/"X" + config digit +
 * hex); 600 chars covers every format with room to spare.
 */
const USER_DEFINED_DATA_RE = /^[0-9A-Za-z]{2,600}$/;

/** Self endpoint type in the payload → API network. */
const NETWORK_BY_ENDPOINT_TYPE = new Map<string, ApiNetwork>([
  ["celo", "mainnet"],
  ["staging_celo", "testnet"],
]);

/**
 * Accepted payload modes. The current CLI sends linked / wallet-free;
 * published 0.2.x CLIs also sent self-custody and smartwallet, so those labels
 * are still accepted. The QR is built from userDefinedData either way.
 */
const CLI_MODES = new Set([
  "linked",
  "wallet-free",
  "self-custody",
  "smartwallet",
]);

/**
 * Validate the CLI handoff payload and render its Self request as a QR.
 *
 * @param req - Query: `payload`, base64url JSON {version: 1, operation
 *   (register | deregister), mode, endpointType, chainId, registryAddress,
 *   appName, scope, humanIdentifier, userDefinedData, disclosures?,
 *   expiresAt (ms)}.
 * @returns 200 image/png; 400 {error} malformed or foreign payload, ed25519 or
 *   smartwallet registration, or the Self request cannot be built; 410
 *   {error} payload expired; 429 {error, retryAfterMs}; 500 {error: "Failed
 *   to render QR code"}.
 */
export async function GET(req: NextRequest) {
  const rl = await checkRateLimit({
    key: `cli-register:${getClientIp(req)}`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return rateLimitResponse(rl.retryAfterMs);
  }

  const encoded = req.nextUrl.searchParams.get("payload");
  if (!encoded) {
    return errorResponse("Missing payload query parameter", 400);
  }
  if (encoded.length > MAX_ENCODED_PAYLOAD_LENGTH) {
    return errorResponse("Payload too large", 400);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return errorResponse("Invalid payload encoding", 400);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return errorResponse("Payload must be a JSON object", 400);
  }
  const payload = parsed as Record<string, unknown>;

  if (payload.version !== 1) {
    return errorResponse("Unsupported payload version", 400);
  }

  if (typeof payload.expiresAt !== "number") {
    return errorResponse("expiresAt must be a number (ms since epoch)", 400);
  }
  if (Date.now() > payload.expiresAt) {
    return errorResponse("Session expired. Run `register init` again.", 410);
  }

  if (payload.operation !== "register" && payload.operation !== "deregister") {
    return errorResponse("operation must be register or deregister", 400);
  }

  if (payload.mode === "ed25519" || payload.mode === "ed25519-linked") {
    return errorResponse(
      "ed25519 modes are not supported by the CLI handoff; use POST /api/agent/register",
      400,
    );
  }
  if (typeof payload.mode !== "string" || !CLI_MODES.has(payload.mode)) {
    return errorResponse("mode must be linked or wallet-free", 400);
  }
  // Published CLIs (0.2.x) left smartwallet registrations without
  // userDefinedData: the removed web page filled it in after creating the
  // passkey wallet. The current CLI refuses the mode, so there is nothing a
  // static QR could render; smartwallet registration goes through
  // POST /api/agent/register (it behaves like linked there).
  if (payload.operation === "register" && payload.mode === "smartwallet") {
    return errorResponse(
      "smartwallet registration is not supported by the CLI handoff; use POST /api/agent/register (or the SDK's requestRegistration)",
      400,
    );
  }

  // ── Must target this app's own registry on a supported network ──────────
  const apiNetwork =
    typeof payload.endpointType === "string"
      ? NETWORK_BY_ENDPOINT_TYPE.get(payload.endpointType)
      : undefined;
  if (!apiNetwork) {
    return errorResponse("endpointType must be celo or staging_celo", 400);
  }
  const network = getNetworkConfig(apiNetwork);
  if (payload.chainId !== network.chainId) {
    return errorResponse(
      `chainId must be ${network.chainId} for endpointType ${network.selfEndpointType}`,
      400,
    );
  }
  if (
    typeof payload.registryAddress !== "string" ||
    payload.registryAddress.toLowerCase() !==
      network.registryAddress.toLowerCase()
  ) {
    return errorResponse(
      `registryAddress must be the Self Agent ID registry (${network.registryAddress})`,
      400,
    );
  }

  const { appName, scope } = selfAppIdentity();
  if (payload.appName !== appName || payload.scope !== scope) {
    return errorResponse(
      `appName and scope must be "${appName}" and "${scope}"`,
      400,
    );
  }

  const humanIdentifier = parseAddress(payload.humanIdentifier);
  if (!humanIdentifier) {
    return errorResponse(
      "humanIdentifier must be a non-zero 0x-prefixed Ethereum address",
      400,
    );
  }

  if (payload.userDefinedData === undefined) {
    return errorResponse("Missing userDefinedData in payload", 400);
  }
  if (
    typeof payload.userDefinedData !== "string" ||
    !USER_DEFINED_DATA_RE.test(payload.userDefinedData)
  ) {
    return errorResponse(
      "userDefinedData must be 2-600 alphanumeric characters",
      400,
    );
  }

  const parsedDisclosures = parseDisclosures(payload.disclosures);
  if (!parsedDisclosures.ok) {
    return errorResponse(parsedDisclosures.error, 400);
  }

  let deepLink: string;
  try {
    const selfApp = buildSelfApp({
      network: apiNetwork,
      userId: humanIdentifier,
      userDefinedData: payload.userDefinedData,
      disclosures: parsedDisclosures.disclosures,
    });
    deepLink = getUniversalLink(selfApp);
  } catch (err) {
    console.error("cli/register: failed to build Self request", err);
    return errorResponse("Failed to build verification request", 400);
  }

  let png: Buffer;
  try {
    png = await renderQrPng(deepLink);
  } catch (err) {
    console.error("cli/register: QR render failed", err);
    return errorResponse(ERRORS.qrRender, 500);
  }

  return pngResponse(png, "self-agent-id-cli-qr.png");
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
