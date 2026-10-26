// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

/**
 * GET /api/agent/bootstrap — registration tool spec for agents.
 *
 * Auth: none. Rate limit: none.
 * Returns a minimal OpenAPI 3.1.0 document (JSON) of the registration
 * endpoints only, so agents can load them as tools. Cacheable for 1 h.
 */

import { NextResponse } from "next/server";
import { AGENT_CORS_HEADERS, corsResponse } from "@/lib/agent-api-helpers";
import { REGISTRATION_MODES } from "@/lib/registration-modes";

/** Security requirement for routes that take the session token as a bearer. */
const sessionTokenAuth = [{ sessionToken: [] }];

/** Error responses shared by the session-token routes. */
const sessionErrors = {
  "400": {
    description:
      "Missing Authorization header, or the token is not for a registration session.",
  },
  "401": { description: "Invalid session token." },
  "410": { description: "Session expired. Start a new registration." },
  "500": {
    description: "Server configuration error (SESSION_SECRET is not set).",
  },
};

/** The served OpenAPI document. */
const spec = {
  openapi: "3.1.0",
  info: {
    title: "Self Agent ID - Registration API",
    version: "1.0.0",
    description:
      "Minimal OpenAPI spec exposing only the registration-relevant endpoints for agent bootstrap and tool discovery. Flow: POST /api/agent/register → show the human the QR (open scanUrl, or render deepLink) → poll GET /api/agent/register/status with Authorization: Bearer <sessionToken> (use the rotated sessionToken from each response) until stage is 'completed' → for server-generated keys, POST /api/agent/register/export within 30 minutes of completion.",
  },
  servers: [{ url: "https://agent-api.self.xyz" }],
  components: {
    securitySchemes: {
      sessionToken: {
        type: "http",
        scheme: "bearer",
        description:
          "The sessionToken returned by POST /api/agent/register (or the rotated one from the latest status response). Session tokens are never accepted in the query string.",
      },
    },
  },
  paths: {
    "/api/agent/register": {
      post: {
        operationId: "startRegistration",
        summary: "Start a new agent registration session",
        description:
          "Creates a registration session, generates a keypair (linked, wallet-free, privy, smartwallet) or verifies the agent's Ed25519 challenge signature (ed25519, ed25519-linked), and returns a session token plus the QR/deep link for the human to scan with the Self app. privy and smartwallet currently behave exactly like linked: the server generates the agent key and no passkey or Privy login is involved.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["mode", "network"],
                properties: {
                  mode: {
                    type: "string",
                    enum: REGISTRATION_MODES,
                    description:
                      "Registration mode. 'wallet-free' and 'ed25519' do not require a human wallet address. 'linked', 'ed25519-linked', 'privy', and 'smartwallet' require humanAddress.",
                  },
                  network: {
                    type: "string",
                    enum: ["mainnet", "testnet"],
                    description: "Target network for on-chain registration.",
                  },
                  humanAddress: {
                    type: "string",
                    description:
                      "0x-prefixed, non-zero Ethereum address of the human owner. Required for linked, ed25519-linked, privy, and smartwallet modes.",
                    pattern: "^0x[0-9a-fA-F]{40}$",
                  },
                  ed25519Pubkey: {
                    type: "string",
                    description:
                      "64-char hex Ed25519 public key (no 0x prefix). Required for ed25519 and ed25519-linked modes.",
                    pattern: "^[0-9a-fA-F]{64}$",
                  },
                  ed25519Signature: {
                    type: "string",
                    description:
                      "128-char hex Ed25519 signature over the challenge hash (no 0x prefix). Required for ed25519 and ed25519-linked modes. Obtain the challenge hash from POST /api/agent/register/ed25519-challenge first.",
                    pattern: "^[0-9a-fA-F]{128}$",
                  },
                  disclosures: {
                    type: "object",
                    description:
                      "Optional disclosure requirements the human must satisfy during passport verification. Boolean fields must be JSON booleans.",
                    properties: {
                      minimumAge: {
                        type: "integer",
                        enum: [0, 18, 21],
                        description: "Minimum age requirement (0 = none).",
                      },
                      ofac: {
                        type: "boolean",
                        description: "Require OFAC sanctions screening.",
                      },
                      nationality: {
                        type: "boolean",
                        description: "Disclose nationality.",
                      },
                      name: {
                        type: "boolean",
                        description: "Disclose full name.",
                      },
                      date_of_birth: {
                        type: "boolean",
                        description: "Disclose date of birth.",
                      },
                      gender: {
                        type: "boolean",
                        description: "Disclose gender.",
                      },
                      issuing_state: {
                        type: "boolean",
                        description: "Disclose passport issuing state.",
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Session created (stage 'qr-ready'). Returns sessionToken, stage, deepLink, qrImageBase64 (PNG, base64), scanUrl (public URL serving the QR as a PNG; it cannot be used as a session token), qrData, agentAddress, network, mode, configIndex, expiresAt, timeRemainingMs, humanInstructions.",
          },
          "400": { description: "Validation error." },
          "413": { description: "Request body too large." },
          "429": { description: "Rate limited (see Retry-After)." },
          "500": {
            description:
              "Server configuration error (SESSION_SECRET is not set), 'Failed to render QR code', or registration init failure.",
          },
          "502": { description: "RPC error." },
        },
      },
    },

    "/api/agent/register/status": {
      get: {
        operationId: "pollRegistrationStatus",
        summary: "Poll registration status",
        description:
          "Checks on-chain whether the agent is registered. Stages: 'qr-ready' (waiting for the human) → 'completed'. Each response carries a rotated sessionToken; use it for the next call. When 'completed' is first observed, expiresAt is reset to 30 minutes from that poll so the key can be exported.",
        security: sessionTokenAuth,
        responses: {
          "200": {
            description:
              "sessionToken, stage, expiresAt, timeRemainingMs, humanInstructions, agentAddress; when completed also agentId (number). credentials are included only on the poll that first observes completion (and only if they could be read).",
          },
          ...sessionErrors,
          "429": { description: "Rate limited (see Retry-After)." },
          "502": { description: "RPC error." },
        },
      },
    },

    "/api/agent/register/export": {
      post: {
        operationId: "exportPrivateKey",
        summary: "Export the agent private key",
        description:
          "After the session reaches 'completed', export the server-generated agent private key (linked, wallet-free, privy, smartwallet). ed25519 modes have no server-held key. Send the session token as Authorization: Bearer (preferred) or as { token } in the JSON body. Every response is sent with Cache-Control: no-store.",
        security: sessionTokenAuth,
        requestBody: {
          required: false,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  token: {
                    type: "string",
                    description:
                      "Session token, if not sent in the Authorization header.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "privateKey, agentAddress, agentId (number), network, mode.",
          },
          ...sessionErrors,
          "409": { description: "Registration is not completed yet." },
        },
      },
    },

    "/api/agent/register/ed25519-challenge": {
      post: {
        operationId: "getEd25519Challenge",
        summary: "Get Ed25519 challenge hash for signing",
        description:
          "Step 1 of the two-step Ed25519 registration flow. Send the agent's Ed25519 public key plus the target network; the server fetches the on-chain nonce and returns the challenge hash that the agent must sign before calling POST /api/agent/register.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["pubkey", "network"],
                properties: {
                  pubkey: {
                    type: "string",
                    description:
                      "64-char hex Ed25519 public key (no 0x prefix).",
                    pattern: "^[0-9a-fA-F]{64}$",
                  },
                  network: {
                    type: "string",
                    enum: ["mainnet", "testnet"],
                    description: "Target network.",
                  },
                  humanAddress: {
                    type: "string",
                    description:
                      "Ethereum address of the human owner. Required for ed25519-linked mode; omit for wallet-free ed25519.",
                    pattern: "^0x[0-9a-fA-F]{40}$",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description:
              "Returns challengeHash (bytes32 hex) and nonce (decimal string) for the agent to sign with their Ed25519 private key.",
          },
          "400": { description: "Validation error." },
          "429": { description: "Rate limited (see Retry-After)." },
          "502": { description: "RPC error." },
        },
      },
    },

    "/api/agent/register/qr": {
      get: {
        operationId: "regenerateQr",
        summary: "Get the QR for a pending registration",
        description:
          "Returns the Self app request for a session still at stage 'qr-ready', so the human can re-scan.",
        security: sessionTokenAuth,
        responses: {
          "200": {
            description:
              "deepLink, qrData (Self app request object), scanUrl (public URL serving the QR as a PNG).",
          },
          ...sessionErrors,
          "409": { description: "Session is no longer at stage 'qr-ready'." },
        },
      },
    },
  },
} as const;

/**
 * Serve the registration OpenAPI document.
 *
 * @returns 200 OpenAPI 3.1.0 JSON.
 */
export function GET() {
  return NextResponse.json(spec, {
    headers: {
      ...AGENT_CORS_HEADERS,
      "Cache-Control": "public, max-age=3600",
    },
  });
}

/**
 * Answer the CORS preflight.
 *
 * @returns 204 with CORS headers.
 */
export function OPTIONS() {
  return corsResponse();
}
