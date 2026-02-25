// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextResponse } from "next/server";

const DISCOVERY = {
  name: "Self Agent ID",
  version: "1.0",
  description:
    "On-chain AI agent identity registry with proof-of-human verification",
  apiBase: process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/agent`
    : "https://selfagentid.xyz/api/agent",
  networks: ["mainnet", "testnet"],
  registrationModes: [
    "verified-wallet",
    "agent-identity",
    "wallet-free",
    "smart-wallet",
  ],
  capabilities: [
    "register",
    "deregister",
    "verify",
    "credentials",
    "agent-card",
    "a2a",
  ],
  sessionTtlMs: 30 * 60_000,
};

export function GET() {
  return NextResponse.json(DISCOVERY, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  });
}
