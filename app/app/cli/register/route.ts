// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /cli/register?payload=<base64url(json)>
//
// CLI browser-handoff endpoint. The `self-agent` CLI's `register open` prints
// this URL for the human to open; scanning the returned QR with the Self app
// starts the on-chain verification. The former interactive page was removed in
// the API-only build, so this route reconstructs the Self verification request
// from the CLI handoff payload and serves the QR as a PNG image — no client-side
// SDK or JavaScript required. Registration completes on-chain; the CLI's
// `register wait` polls the registry until the mint lands.

import type { NextRequest } from "next/server";
import { SelfAppBuilder, getUniversalLink } from "@selfxyz/qrcode";
import { renderQrPng } from "@/lib/renderQr";
import { errorResponse, corsResponse } from "@/lib/agent-api-helpers";

interface CliDisclosures {
  nationality?: boolean;
  name?: boolean;
  date_of_birth?: boolean;
  gender?: boolean;
  issuing_state?: boolean;
  ofac?: boolean;
  minimumAge?: number;
}

interface CliHandoffPayload {
  version: number;
  operation: "register" | "deregister";
  mode: string;
  chainId: number;
  registryAddress: string;
  endpointType: "celo" | "staging_celo";
  appName: string;
  scope: string;
  humanIdentifier: string;
  userDefinedData?: string;
  disclosures?: CliDisclosures;
  expiresAt: number;
}

function buildDisclosures(
  input?: CliDisclosures,
): Record<string, boolean | number> {
  if (!input) return {};
  const out: Record<string, boolean | number> = {};
  if (input.nationality) out.nationality = true;
  if (input.name) out.name = true;
  if (input.date_of_birth) out.date_of_birth = true;
  if (input.gender) out.gender = true;
  if (input.issuing_state) out.issuing_state = true;
  if (input.ofac) out.ofac = true;
  if ((input.minimumAge ?? 0) > 0) out.minimumAge = input.minimumAge as number;
  return out;
}

export async function GET(req: NextRequest) {
  const encoded = req.nextUrl.searchParams.get("payload");
  if (!encoded) {
    return errorResponse("Missing payload query parameter", 400);
  }

  let payload: CliHandoffPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as CliHandoffPayload;
  } catch {
    return errorResponse("Invalid payload encoding", 400);
  }

  if (payload.version !== 1) {
    return errorResponse(
      `Unsupported payload version: ${String(payload.version)}`,
      400,
    );
  }

  if (payload.expiresAt && Date.now() > payload.expiresAt) {
    return errorResponse("Session expired. Run `register init` again.", 410);
  }

  // The smartwallet flow needs an interactive passkey/account-abstraction
  // browser session, which a static QR cannot provide. Use linked, wallet-free,
  // or ed25519 mode, or register with the SDK.
  if (payload.operation === "register" && payload.mode === "smartwallet") {
    return errorResponse(
      "smartwallet registration needs an interactive client; use linked, wallet-free, or ed25519 mode, or the SDK",
      400,
    );
  }

  if (!payload.userDefinedData) {
    return errorResponse("Missing userDefinedData in payload", 400);
  }

  let deepLink: string;
  try {
    const selfApp = new SelfAppBuilder({
      version: 2,
      appName: payload.appName,
      scope: payload.scope,
      endpoint: payload.registryAddress,
      userId: payload.humanIdentifier,
      endpointType: payload.endpointType,
      userIdType: "hex",
      userDefinedData: payload.userDefinedData,
      disclosures: buildDisclosures(payload.disclosures),
    }).build();
    deepLink = getUniversalLink(selfApp);
  } catch (err) {
    return errorResponse(
      `Failed to build verification request: ${err instanceof Error ? err.message : String(err)}`,
      400,
    );
  }

  const png = await renderQrPng(deepLink);
  return new Response(png as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

export function OPTIONS() {
  return corsResponse();
}
