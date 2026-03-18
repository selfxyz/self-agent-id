// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

// GET /api/agent/bootstrap — Agent bootstrap / discovery endpoint
//
// Returns a minimal OpenAPI 3.1.0 spec (JSON) containing only the
// registration-relevant endpoints. Agents can curl this to discover
// the registration API and auto-load it as tools.
// Stateless, no auth, cacheable.

import { NextResponse } from "next/server";

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Self Agent ID - Registration API",
    version: "1.0.0",
    description:
      "Minimal OpenAPI spec exposing only the registration-relevant endpoints for agent bootstrap and tool discovery.",
  },
  servers: [{ url: "https://app.ai.self.xyz" }],
  paths: {
    "/api/agent/register": {
      post: {
        operationId: "startRegistration",
        summary: "Start a new agent registration session",
        description:
          "Creates a registration session, generates or accepts a keypair, builds Self app QR data, and returns a session token plus QR/deep-link for the human to scan with the Self app.",
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
                    enum: [
                      "linked",
                      "wallet-free",
                      "ed25519",
                      "ed25519-linked",
                      "privy",
                      "smartwallet",
                    ],
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
                      "Ethereum address of the human owner. Required for linked, ed25519-linked, privy, and smartwallet modes.",
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
                      "Optional disclosure requirements the human must satisfy during passport verification.",
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
              "Session created. Returns session token, QR data, deep link, and scan URL.",
          },
          "400": { description: "Validation error." },
          "429": { description: "Rate limited." },
        },
      },
    },

    "/api/agent/register/status": {
      get: {
        operationId: "pollRegistrationStatus",
        summary: "Poll registration status",
        description:
          "Check the current status of a registration session. Polls on-chain state and returns whether the agent is verified. Call this repeatedly until the stage reaches 'registered'.",
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Session token returned by POST /api/agent/register.",
          },
        ],
        responses: {
          "200": {
            description:
              "Current registration status including stage, on-chain state, and time remaining.",
          },
          "400": { description: "Missing or invalid token." },
        },
      },
    },

    "/api/agent/register/export": {
      post: {
        operationId: "exportPrivateKey",
        summary: "Export the agent private key",
        description:
          "After successful registration, export the server-generated agent private key. Only available for modes where the server generated the keypair (linked, wallet-free). The token is sent in the body (not query string) to avoid leaking via logs.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["token"],
                properties: {
                  token: {
                    type: "string",
                    description:
                      "Session token returned by POST /api/agent/register.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Returns the agent private key and address.",
          },
          "400": {
            description: "Invalid token or key not available for this mode.",
          },
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
              "Returns challengeHash (bytes32 hex) and nonce for the agent to sign with their Ed25519 private key.",
          },
          "400": { description: "Validation error." },
          "429": { description: "Rate limited." },
        },
      },
    },

    "/api/agent/register/qr": {
      get: {
        operationId: "regenerateQr",
        summary: "Regenerate QR code for registration",
        description:
          "Returns QR code data and the deep link for the current registration session so the human can re-scan if the original QR expired or was lost.",
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Session token returned by POST /api/agent/register.",
          },
        ],
        responses: {
          "200": {
            description: "Returns deep link URL and a public QR image URL.",
          },
          "400": { description: "Missing or invalid token." },
        },
      },
    },
  },
} as const;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function GET() {
  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=3600",
      ...CORS_HEADERS,
    },
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}
