// SPDX-FileCopyrightText: 2025-2026 Social Connect Labs, Inc.
// SPDX-License-Identifier: BUSL-1.1
// NOTE: Converts to Apache-2.0 on 2029-06-11 per LICENSE.

import { http } from "@google-cloud/functions-framework";
import { SelfAgentVerifier, HEADERS } from "@selfxyz/agent-sdk";

const REGISTRY = process.env.REGISTRY_ADDRESS!;
const RPC = process.env.RPC_URL!;

const verifier = new SelfAgentVerifier({
  registryAddress: REGISTRY,
  rpcUrl: RPC,
  maxAgentsPerHuman: 0,
  includeCredentials: true,
});

// In-memory verification counter
let verificationCount = 0;

// ---------------------------------------------------------------------------
// In-memory census store
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

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .filter(Boolean);

function setCors(
  req: Parameters<Parameters<typeof http>[1]>[0],
  res: Parameters<Parameters<typeof http>[1]>[1],
) {
  const origin = req.headers.origin || "";
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*")) {
    res.set("Access-Control-Allow-Origin", origin);
  }
  res.set(
    "Access-Control-Allow-Headers",
    "Content-Type, x-self-agent-address, x-self-agent-signature, x-self-agent-timestamp",
  );
  res.set(
    "Access-Control-Expose-Headers",
    "x-self-agent-address, x-self-agent-signature, x-self-agent-timestamp",
  );
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function computeStats() {
  const countryCounts = new Map<string, number>();
  let verifiedOver18 = 0;
  let verifiedOver21 = 0;
  let ofacClear = 0;

  for (const entry of census.values()) {
    if (entry.nationality) {
      countryCounts.set(
        entry.nationality,
        (countryCounts.get(entry.nationality) || 0) + 1,
      );
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
// Cloud Function entry point
// ---------------------------------------------------------------------------

http("demoService", async (req, res) => {
  setCors(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const path = req.path;

  // GET /health
  if (req.method === "GET" && path === "/health") {
    res.status(200).json({ status: "ok", service: "agent-id-demo-service" });
    return;
  }

  // All other routes require agent verification
  const signature = req.headers[HEADERS.SIGNATURE] as string | undefined;
  const timestamp = req.headers[HEADERS.TIMESTAMP] as string | undefined;

  if (!signature || !timestamp) {
    res.status(401).json({ error: "Missing agent authentication headers" });
    return;
  }

  // Reconstruct the URL the agent signed against.
  // Cloud Run terminates TLS at the LB, so req.protocol is "http" internally.
  // Use x-forwarded-proto for the real protocol the client used.
  const proto = (req.headers["x-forwarded-proto"] as string) || req.protocol;
  const host = req.get("host")!;
  // Remove trailing slash from originalUrl when it's just "/" (base path)
  // because the client signs "https://host" not "https://host/"
  const urlPath = req.originalUrl === "/" ? "" : req.originalUrl;
  const fullUrl = `${proto}://${host}${urlPath}`;
  const body = req.rawBody?.toString("utf-8") || "";

  const result = await verifier.verify({
    signature,
    timestamp,
    method: req.method,
    url: fullUrl,
    body: body || undefined,
  });

  // POST /verify — verify agent, return credentials
  if (req.method === "POST" && path === "/verify") {
    if (result.valid) verificationCount++;

    res.status(result.valid ? 200 : 403).json({
      valid: result.valid,
      agentAddress: result.agentAddress,
      agentKey: result.agentKey,
      agentId: result.agentId?.toString(),
      agentCount: result.agentCount?.toString(),
      verificationCount,
      credentials: result.credentials
        ? {
            ...result.credentials,
            olderThan: result.credentials.olderThan.toString(),
          }
        : undefined,
      error: result.error,
    });
    return;
  }

  // POST /census — contribute credentials
  if (req.method === "POST" && path === "/census") {
    if (!result.valid) {
      res
        .status(403)
        .json({ error: result.error || "Agent verification failed" });
      return;
    }

    const creds = result.credentials;
    const entry: CensusEntry = {
      agentAddress: result.agentAddress!,
      agentId: result.agentId!.toString(),
      nationality: creds?.nationality || "",
      olderThan: Number(creds?.olderThan || 0),
      ofac: creds?.ofac ? creds.ofac.map(Boolean) : [false, false, false],
      timestamp: Date.now(),
    };

    census.set(result.agentAddress!.toLowerCase(), entry);

    res.status(200).json({
      recorded: true,
      totalAgents: census.size,
      yourEntry: entry,
    });
    return;
  }

  // GET /census — read aggregate stats (gated)
  if (req.method === "GET" && path === "/census") {
    if (!result.valid) {
      res
        .status(403)
        .json({ error: result.error || "Agent verification failed" });
      return;
    }

    res.status(200).json(computeStats());
    return;
  }

  res.status(404).json({ error: "Not found" });
});
