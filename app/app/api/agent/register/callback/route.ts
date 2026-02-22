// POST /api/agent/register/callback?token=<encrypted_token>
//
// Receives the callback from the Self app after passport scan.
// Updates session stage based on the callback payload.

import { NextRequest } from "next/server";
import {
  decryptAndValidateSession,
  sessionResponse,
  humanInstructions,
  errorResponse,
  corsResponse,
} from "@/lib/agent-api-helpers";

export async function POST(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) {
    return errorResponse("Missing token query parameter", 400);
  }

  let session;
  let secret: string;
  try {
    const result = decryptAndValidateSession(token);
    session = result.session;
    secret = result.secret;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("expired")) {
      return errorResponse("Session expired", 410);
    }
    return errorResponse(`Invalid session token: ${msg}`, 401);
  }

  if (session.type !== "register") {
    return errorResponse("Token is not for a registration session", 400);
  }

  if (session.stage === "completed") {
    return sessionResponse(session, secret, {
      agentAddress: session.agentAddress,
      agentId: session.agentId,
      humanInstructions: humanInstructions("completed"),
    });
  }

  // Parse callback body
  let callbackData: Record<string, unknown>;
  try {
    callbackData = await req.json();
  } catch {
    return errorResponse("Invalid callback payload", 400);
  }

  // The Self app sends a proof payload on success. If we receive any data,
  // mark the session as proof-received. The status endpoint will then
  // confirm on-chain.
  if (callbackData && Object.keys(callbackData).length > 0) {
    session.stage = "proof-received";
    session.proof = callbackData;

    return sessionResponse(session, secret, {
      agentAddress: session.agentAddress,
      humanInstructions: humanInstructions("proof-received"),
    });
  }

  // If callback has error field, mark as failed
  if (callbackData && (callbackData as Record<string, unknown>).error) {
    session.stage = "failed";
    return sessionResponse(session, secret, {
      agentAddress: session.agentAddress,
      error: (callbackData as Record<string, unknown>).error,
      humanInstructions: humanInstructions("failed"),
    });
  }

  return errorResponse("Empty callback payload", 400);
}

export async function OPTIONS() {
  return corsResponse();
}
