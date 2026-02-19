import { NextRequest, NextResponse } from "next/server";
import { SelfAgentVerifier, HEADERS } from "@selfxyz/agent-sdk";
import { getNetwork, NETWORKS, type NetworkId } from "@/lib/network";

// In-memory verification counter (resets on server restart — fine for demo)
let verificationCount = 0;

function resolveNetwork(req: NextRequest): NetworkId {
  const param = req.nextUrl.searchParams.get("network");
  if (param && param in NETWORKS) return param as NetworkId;
  return "celo-sepolia";
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get(HEADERS.SIGNATURE);
  const timestamp = req.headers.get(HEADERS.TIMESTAMP);

  if (!signature || !timestamp) {
    return NextResponse.json(
      { valid: false, error: "Missing agent authentication headers" },
      { status: 401 }
    );
  }

  const network = getNetwork(resolveNetwork(req));
  const verifier = new SelfAgentVerifier({
    registryAddress: network.registryAddress,
    rpcUrl: network.rpcUrl,
    maxAgentsPerHuman: 0, // disable sybil check for demo
    includeCredentials: true,
  });

  const body = await req.text();

  const result = await verifier.verify({
    signature,
    timestamp,
    method: "POST",
    url: req.url,
    body: body || undefined,
  });

  if (result.valid) verificationCount++;

  // Convert BigInt values to strings for JSON serialization
  return NextResponse.json({
    valid: result.valid,
    agentAddress: result.agentAddress,
    agentKey: result.agentKey,
    agentId: result.agentId.toString(),
    agentCount: result.agentCount.toString(),
    verificationCount,
    credentials: result.credentials
      ? {
          ...result.credentials,
          olderThan: result.credentials.olderThan.toString(),
        }
      : undefined,
    error: result.error,
  });
}
