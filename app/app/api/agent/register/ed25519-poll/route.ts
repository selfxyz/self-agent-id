// GET /api/agent/register/ed25519-poll?pubkey=<hex>
//
// Polls the in-memory relay store for QR session data after an agent
// has called the register endpoint with an Ed25519 signature.

import type { NextRequest } from "next/server";
import { getEd25519Relay } from "@/lib/ed25519-relay";
import { isValidEd25519PubkeyHex } from "@/lib/ed25519";
import { jsonResponse, errorResponse, corsResponse } from "@/lib/agent-api-helpers";

export async function GET(req: NextRequest) {
  const pubkey = req.nextUrl.searchParams.get("pubkey");

  if (!pubkey || !isValidEd25519PubkeyHex(pubkey)) {
    return errorResponse("Invalid pubkey parameter", 400);
  }

  const relay = getEd25519Relay(pubkey);

  if (!relay) {
    return jsonResponse({ ready: false });
  }

  return jsonResponse({
    ready: true,
    qrData: relay.qrData,
    deepLink: relay.deepLink,
    sessionToken: relay.sessionToken,
    agentAddress: relay.agentAddress,
    scanUrl: relay.scanUrl,
  });
}

export function OPTIONS() {
  return corsResponse();
}
