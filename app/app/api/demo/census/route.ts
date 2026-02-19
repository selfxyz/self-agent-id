import { NextRequest, NextResponse } from "next/server";
import { SelfAgentVerifier, HEADERS } from "@selfxyz/agent-sdk";
import { getNetwork, NETWORKS, type NetworkId } from "@/lib/network";

// ---------------------------------------------------------------------------
// In-memory census store (portable to Firestore later)
// ---------------------------------------------------------------------------

interface CensusEntry {
  agentAddress: string;
  agentId: string;
  nationality: string;
  olderThan: number;
  ofac: boolean[];
  timestamp: number;
}

const census = new Map<string, CensusEntry>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resolveNetwork(req: NextRequest): NetworkId {
  const param = req.nextUrl.searchParams.get("network");
  if (param && param in NETWORKS) return param as NetworkId;
  return "celo-sepolia";
}

function createVerifier(req: NextRequest) {
  const network = getNetwork(resolveNetwork(req));
  return new SelfAgentVerifier({
    registryAddress: network.registryAddress,
    rpcUrl: network.rpcUrl,
    maxAgentsPerHuman: 0,
    includeCredentials: true,
  });
}

async function verifyAgent(req: NextRequest, body: string) {
  const signature = req.headers.get(HEADERS.SIGNATURE);
  const timestamp = req.headers.get(HEADERS.TIMESTAMP);

  if (!signature || !timestamp) {
    return { valid: false as const, error: "Missing agent authentication headers" };
  }

  const verifier = createVerifier(req);
  return verifier.verify({
    signature,
    timestamp,
    method: req.method,
    url: req.url,
    body: body || undefined,
  });
}

function computeStats() {
  const countryCounts = new Map<string, number>();
  let verifiedOver18 = 0;
  let verifiedOver21 = 0;
  let ofacClear = 0;

  for (const entry of census.values()) {
    if (entry.nationality && entry.nationality.trim()) {
      const nat = entry.nationality.trim();
      countryCounts.set(nat, (countryCounts.get(nat) || 0) + 1);
    }
    if (entry.olderThan >= 18) verifiedOver18++;
    if (entry.olderThan >= 21) verifiedOver21++;
    if (entry.ofac?.some(Boolean)) ofacClear++;
  }

  const topCountries = [...countryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([country, count]) => ({ country, count }));

  return {
    topCountries,
    verifiedOver18,
    verifiedOver21,
    ofacClear,
    totalAgents: census.size,
  };
}

// ---------------------------------------------------------------------------
// POST — contribute credentials to census
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const body = await req.text();
  const result = await verifyAgent(req, body);

  if (!result.valid) {
    return NextResponse.json(
      { error: result.error || "Agent verification failed" },
      { status: 403 },
    );
  }

  const creds = result.credentials;
  const entry: CensusEntry = {
    agentAddress: result.agentAddress!,
    agentId: result.agentId.toString(),
    nationality: creds?.nationality || "",
    olderThan: Number(creds?.olderThan || 0),
    ofac: creds?.ofac ? creds.ofac.map(Boolean) : [false, false, false],
    timestamp: Date.now(),
  };

  census.set(result.agentAddress!.toLowerCase(), entry);

  return NextResponse.json({
    recorded: true,
    totalAgents: census.size,
    yourEntry: entry,
  });
}

// ---------------------------------------------------------------------------
// GET — read aggregate stats (gated)
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const result = await verifyAgent(req, "");

  if (!result.valid) {
    return NextResponse.json(
      { error: result.error || "Agent verification failed" },
      { status: 403 },
    );
  }

  return NextResponse.json(computeStats());
}
