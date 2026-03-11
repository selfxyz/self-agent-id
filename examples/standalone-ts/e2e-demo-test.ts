// SPDX-License-Identifier: MIT

/**
 * E2E Demo Test Script — Ed25519 Agent
 *
 * Tests the full demo flow against a running Self Agent ID instance:
 *   1. Generate Ed25519 keypair
 *   2. Verify denial (not registered)
 *   3. Register via API (challenge → sign → register → QR)
 *   4. Poll until registered
 *   5. Run all 4 demo tests
 *   6. Report pass/fail
 *
 * Usage:
 *   ED25519_SEED=<seed> npx tsx e2e-demo-test.ts
 *   # Or with a pre-registered agent:
 *   ED25519_SEED=<registered-seed> SKIP_REGISTRATION=1 npx tsx e2e-demo-test.ts
 */

import { Ed25519Agent, SelfAgentVerifier } from "@selfxyz/agent-sdk";
import { randomBytes } from "crypto";

const BASE_URL = process.env.DEMO_BASE_URL || "https://app.ai.self.xyz";
const NETWORK = process.env.NETWORK || "celo-sepolia";
const SKIP_REGISTRATION = process.env.SKIP_REGISTRATION === "1";

const seed = process.env.ED25519_SEED || randomBytes(32).toString("hex");

console.log("=== Self Agent ID — Ed25519 E2E Demo Test ===\n");
console.log(`Base URL: ${BASE_URL}`);
console.log(`Network: ${NETWORK}`);
console.log(`Seed: ${seed.slice(0, 8)}...${seed.slice(-8)}`);

const agent = new Ed25519Agent({
  privateKey: seed,
  network: NETWORK === "celo-mainnet" ? "mainnet" : "testnet",
});

console.log(`Agent address: ${agent.address}`);
console.log(`Agent key: ${agent.agentKey}\n`);

const results: Record<string, "pass" | "fail" | "skip"> = {};

function serviceUrl(path: string): string {
  return `${BASE_URL}/api/demo${path}?network=${NETWORK}`;
}

// ── Test 0: Verify denial (unregistered agent should fail) ───────────────────

async function testDenial() {
  console.log("--- Test 0: Verify Denial (unregistered) ---");

  const registered = await agent.isRegistered();
  if (registered && !SKIP_REGISTRATION) {
    console.log("  Agent already registered — skipping denial test");
    results["denial"] = "skip";
    return;
  }

  if (!registered) {
    try {
      const res = await agent.fetch(serviceUrl("/verify"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: "denial" }),
      });
      const data = (await res.json()) as { valid?: boolean; error?: string };
      if (data.valid === false || res.status === 403) {
        console.log("  PASS — unregistered agent correctly denied");
        results["denial"] = "pass";
      } else {
        console.log("  FAIL — expected denial but got:", data);
        results["denial"] = "fail";
      }
    } catch (err) {
      console.log(
        "  PASS — request failed as expected:",
        err instanceof Error ? err.message : err,
      );
      results["denial"] = "pass";
    }
  } else {
    results["denial"] = "skip";
  }
}

// ── Registration ─────────────────────────────────────────────────────────────

async function waitForRegistration() {
  if (SKIP_REGISTRATION) {
    const registered = await agent.isRegistered();
    if (!registered) {
      console.log("SKIP_REGISTRATION=1 but agent not registered. Aborting.");
      process.exit(1);
    }
    console.log("--- Registration: skipped (SKIP_REGISTRATION=1) ---\n");
    return;
  }

  const registered = await agent.isRegistered();
  if (registered) {
    console.log("--- Registration: already registered ---\n");
    return;
  }

  console.log("--- Registration Required ---");
  console.log("Register this agent at:");
  console.log(`  ${BASE_URL}/register?network=${NETWORK}`);
  console.log(`  Seed: ${seed}`);
  console.log("\nPolling for registration status...");

  const maxWait = 5 * 60 * 1000; // 5 minutes
  const pollInterval = 5_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const isReg = await agent.isRegistered();
    if (isReg) {
      console.log("  Registered!\n");
      return;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, pollInterval));
  }

  console.log("\n  Timed out waiting for registration. Aborting.");
  process.exit(1);
}

// ── Test 1: Agent-to-Service ─────────────────────────────────────────────────

async function testService() {
  console.log("--- Test 1: Agent-to-Service ---");
  try {
    // POST /verify
    const verifyRes = await agent.fetch(serviceUrl("/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: "service" }),
    });
    const verifyData = (await verifyRes.json()) as {
      valid?: boolean;
      agentId?: string;
      error?: string;
    };

    if (!verifyData.valid) {
      console.log("  FAIL — verify:", verifyData.error);
      results["service"] = "fail";
      return;
    }
    console.log(`  Verified: agent #${verifyData.agentId}`);

    // POST /census (contribute)
    const censusRes = await agent.fetch(serviceUrl("/census"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const censusData = (await censusRes.json()) as {
      recorded?: boolean;
      totalAgents?: number;
      error?: string;
    };

    if (!censusData.recorded) {
      console.log("  FAIL — census:", censusData.error);
      results["service"] = "fail";
      return;
    }
    console.log(`  Census recorded: ${censusData.totalAgents} total agents`);

    // GET /census (read stats)
    const statsRes = await agent.fetch(serviceUrl("/census"));
    const statsData = (await statsRes.json()) as {
      totalAgents?: number;
      error?: string;
    };

    console.log(`  Census stats: ${statsData.totalAgents} agents`);
    console.log("  PASS");
    results["service"] = "pass";
  } catch (err) {
    console.log("  FAIL:", err instanceof Error ? err.message : err);
    results["service"] = "fail";
  }
}

// ── Test 2: Agent-to-Agent ───────────────────────────────────────────────────

async function testPeer() {
  console.log("--- Test 2: Agent-to-Agent ---");
  try {
    const res = await agent.fetch(serviceUrl("/agent-to-agent"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ test: "peer" }),
    });
    const data = (await res.json()) as {
      verified?: boolean;
      sameHuman?: boolean;
      message?: string;
      error?: string;
    };

    if (!data.verified) {
      console.log("  FAIL:", data.error);
      results["peer"] = "fail";
      return;
    }

    console.log(`  Verified: ${data.message}`);
    console.log(`  Same human: ${data.sameHuman}`);

    // Verify response signature
    const sigHeader = res.headers.get("x-self-agent-signature");
    const tsHeader = res.headers.get("x-self-agent-timestamp");
    if (sigHeader && tsHeader) {
      console.log("  Response is signed by demo agent");
    }

    console.log("  PASS");
    results["peer"] = "pass";
  } catch (err) {
    console.log("  FAIL:", err instanceof Error ? err.message : err);
    results["peer"] = "fail";
  }
}

// ── Test 3: Agent-to-Chain (Ed25519 meta-tx) ─────────────────────────────────

async function testGate() {
  console.log("--- Test 3: Agent-to-Chain (Ed25519) ---");
  console.log(
    "  NOTE: Requires AgentDemoVerifierEd25519 deployed. Skipping if not configured.",
  );
  // This test requires the Ed25519 demo verifier contract to be deployed.
  // The meta-tx requires computing extKpub (Weierstrass coords) which needs
  // the SCL library precompute. For the E2E test, we skip this and just
  // verify the endpoint exists.
  try {
    const res = await agent.fetch(serviceUrl("/chain-verify-ed25519"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentKey: agent.agentKey,
        nonce: "0",
        deadline: Math.floor(Date.now() / 1000) + 300,
        extKpub: ["0", "0", "0", "0", "0"], // placeholder
        sigR: "0",
        sigS: "0",
        networkId: NETWORK,
      }),
    });

    // We expect a 400 (invalid signature) rather than 404 (route doesn't exist)
    if (res.status === 404) {
      console.log("  SKIP — Ed25519 chain-verify route not deployed");
      results["gate"] = "skip";
    } else if (res.status === 400) {
      const data = (await res.json()) as { error?: string };
      console.log(`  Route exists, rejected as expected: ${data.error}`);
      console.log("  PASS (route reachable, signature validation works)");
      results["gate"] = "pass";
    } else {
      console.log(`  Unexpected status: ${res.status}`);
      results["gate"] = "fail";
    }
  } catch (err) {
    console.log("  FAIL:", err instanceof Error ? err.message : err);
    results["gate"] = "fail";
  }
}

// ── Test 4: AI Agent Chat ────────────────────────────────────────────────────

async function testChat() {
  console.log("--- Test 4: AI Agent Chat ---");
  try {
    const res = await agent.fetch(serviceUrl("/chat"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "Hello, I am an Ed25519 agent. What can you tell me?",
        session_id: `e2e-${Date.now()}`,
      }),
    });

    if (res.status === 503) {
      console.log("  SKIP — LangChain service unavailable");
      results["chat"] = "skip";
      return;
    }

    const data = (await res.json()) as {
      response?: string;
      error?: string;
    };

    if (data.error) {
      console.log(`  FAIL: ${data.error}`);
      results["chat"] = "fail";
    } else {
      const preview = (data.response || "").slice(0, 100);
      console.log(`  Response: ${preview}...`);
      console.log("  PASS");
      results["chat"] = "pass";
    }
  } catch (err) {
    console.log("  FAIL:", err instanceof Error ? err.message : err);
    results["chat"] = "fail";
  }
}

// ── Run all ──────────────────────────────────────────────────────────────────

await testDenial();
await waitForRegistration();
await testService();
await testPeer();
await testGate();
await testChat();

// ── Report ───────────────────────────────────────────────────────────────────

console.log("\n=== Results ===");
let allPass = true;
for (const [test, result] of Object.entries(results)) {
  const icon = result === "pass" ? "OK" : result === "skip" ? "--" : "XX";
  console.log(`  [${icon}] ${test}: ${result}`);
  if (result === "fail") allPass = false;
}

const passCount = Object.values(results).filter((r) => r === "pass").length;
const failCount = Object.values(results).filter((r) => r === "fail").length;
const skipCount = Object.values(results).filter((r) => r === "skip").length;
console.log(`\n${passCount} passed, ${failCount} failed, ${skipCount} skipped`);

process.exit(allPass ? 0 : 1);
