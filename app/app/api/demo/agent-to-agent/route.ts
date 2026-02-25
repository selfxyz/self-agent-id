// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { SelfAgent, HEADERS } from "@selfxyz/agent-sdk";
import { getNetwork, NETWORKS, type NetworkId } from "@/lib/network";
import { getCachedVerifier } from "@/lib/selfVerifier";
import { checkAndRecordReplay } from "@/lib/replayGuard";

// Per-network demo agent private keys
const DEMO_KEYS: Record<NetworkId, string | undefined> = {
  "celo-sepolia": process.env.DEMO_AGENT_PRIVATE_KEY_SEPOLIA,
  "celo-mainnet": process.env.DEMO_AGENT_PRIVATE_KEY_MAINNET,
};

// In-memory counters (resets on server restart — fine for demo)
let verificationCount = 0;
const uniqueHumans = new Set<string>();

function resolveNetwork(req: NextRequest): NetworkId {
  const param = req.nextUrl.searchParams.get("network");
  if (param && param in NETWORKS) return param as NetworkId;
  return "celo-sepolia";
}

export async function POST(req: NextRequest) {
  const network = getNetwork(resolveNetwork(req));
  const demoAgentPk = DEMO_KEYS[network.id];

  if (!demoAgentPk) {
    return NextResponse.json(
      { error: `Demo agent not configured for ${network.label} (missing DEMO_AGENT_PRIVATE_KEY_${network.isTestnet ? "SEPOLIA" : "MAINNET"})` },
      { status: 500 }
    );
  }

  // 1. Extract caller's signature headers
  const signature = req.headers.get(HEADERS.SIGNATURE);
  const timestamp = req.headers.get(HEADERS.TIMESTAMP);

  if (!signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing agent authentication headers" },
      { status: 401 }
    );
  }

  const body = await req.text();

  // 2. Demo agent verifies the caller's identity on-chain
  const verifier = getCachedVerifier(network.id, {
    maxAgentsPerHuman: 0,
    includeCredentials: false,
    enableReplayProtection: true,
  });

  const verifyResult = await verifier.verify({
    signature,
    timestamp,
    method: "POST",
    url: req.url,
    body: body || undefined,
  });

  if (!verifyResult.valid) {
    return NextResponse.json(
      {
        verified: false,
        error: verifyResult.error || "Agent verification failed",
      },
      { status: 403 }
    );
  }

  const replay = await checkAndRecordReplay({
    signature,
    timestamp,
    method: "POST",
    url: req.url,
    body: body || undefined,
    scope: "demo-agent-to-agent",
  });
  if (!replay.ok) {
    return NextResponse.json(
      {
        verified: false,
        error: replay.error || "Replay detected",
      },
      { status: 409 },
    );
  }

  // 3. Demo agent does on-chain sameHuman check
  const demoAgent = new SelfAgent({
    privateKey: demoAgentPk,
    registryAddress: network.registryAddress,
    rpcUrl: network.rpcUrl,
  });

  const provider = new ethers.JsonRpcProvider(network.rpcUrl);
  const registry = new ethers.Contract(
    network.registryAddress,
    [
      "function getAgentId(bytes32) view returns (uint256)",
      "function sameHuman(uint256, uint256) view returns (bool)",
      "function isVerifiedAgent(bytes32) view returns (bool)",
    ],
    provider
  );

  const demoKey = ethers.zeroPadValue(demoAgent.address, 32);
  const callerKey = verifyResult.agentKey!;

  const [demoVerified, demoId, callerId, callerVerified] = await Promise.all([
    registry.isVerifiedAgent(demoKey),
    registry.getAgentId(demoKey),
    registry.getAgentId(callerKey),
    registry.isVerifiedAgent(callerKey),
  ]);

  let sameHumanResult = false;
  if (demoId > 0n && callerId > 0n) {
    sameHumanResult = await registry.sameHuman(demoId, callerId);
  }

  // Track verification stats
  verificationCount++;
  // Use callerAgent address as a proxy for unique human (nullifier not available here)
  if (verifyResult.agentAddress) {
    uniqueHumans.add(verifyResult.agentAddress.toLowerCase());
  }

  const message = `Beep boop! You are agent #${verificationCount} that I have verified as being verified by a human. I have seen ${uniqueHumans.size} unique agent${uniqueHumans.size === 1 ? "" : "s"} so far.`;

  // 4. Build response payload
  const responsePayload = {
    verified: true,
    demoAgent: {
      address: demoAgent.address,
      agentId: demoId.toString(),
      verified: demoVerified,
    },
    callerAgent: {
      address: verifyResult.agentAddress,
      agentId: callerId.toString(),
      verified: callerVerified,
    },
    sameHuman: sameHumanResult,
    verificationCount,
    uniqueAgents: uniqueHumans.size,
    message,
  };

  const responseBody = JSON.stringify(responsePayload);

  // 5. Demo agent signs the response so caller can verify it came from us
  const responseHeaders = await demoAgent.signRequest(
    "POST",
    req.url,
    responseBody
  );

  return new NextResponse(responseBody, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      [HEADERS.ADDRESS]: responseHeaders[HEADERS.ADDRESS],
      [HEADERS.SIGNATURE]: responseHeaders[HEADERS.SIGNATURE],
      [HEADERS.TIMESTAMP]: responseHeaders[HEADERS.TIMESTAMP],
    },
  });
}
