// SPDX-License-Identifier: MIT

/**
 * Standalone Ed25519 Agent — Reference Implementation
 *
 * Demonstrates the full lifecycle:
 *   1. Generate or load an Ed25519 keypair
 *   2. Register via the Self Agent ID API (requires human QR scan)
 *   3. Authenticate API requests with Ed25519 signatures
 *   4. Verify another agent's identity
 */

import { Ed25519Agent, SelfAgentVerifier } from "@selfxyz/agent-sdk";
import { randomBytes } from "crypto";

// ── 1. Generate or load keypair ──────────────────────────────────────────────

// In production, persist this seed securely (env var, vault, HSM).
const seed = process.env.ED25519_SEED || randomBytes(32).toString("hex");

console.log("Ed25519 seed:", seed);

const agent = new Ed25519Agent({
  privateKey: seed,
  network: "testnet",
});

console.log("Agent address (derived):", agent.address);
console.log("Agent key (keccak256):", agent.agentKey);

// ── 2. Check registration ────────────────────────────────────────────────────

const registered = await agent.isRegistered();
console.log("Registered:", registered);

if (!registered) {
  console.log("\nAgent not registered. To register:");
  console.log("1. Visit https://app.ai.self.xyz/register");
  console.log("2. Enter your Ed25519 seed (64 hex chars, no 0x prefix)");
  console.log("3. Scan the QR code with your Self app");
  console.log("4. Re-run this script after registration completes");
  process.exit(0);
}

// ── 3. Make signed requests ──────────────────────────────────────────────────

const info = await agent.getInfo();
console.log(`\nAgent ID: #${info.agentId}`);
console.log(`Verified: ${info.isVerified}`);

// Sign and send a request to a protected service
const SERVICE_URL =
  process.env.SERVICE_URL || "http://localhost:3000/api/demo/verify";

console.log(`\nSending signed request to ${SERVICE_URL}...`);

const res = await agent.fetch(SERVICE_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ message: "Hello from Ed25519 agent" }),
});

console.log(`Response: ${res.status}`);
const data = await res.json();
console.log(JSON.stringify(data, null, 2));

// ── 4. Verify another agent (service-side) ───────────────────────────────────

console.log("\n--- Service-side verification demo ---");

const verifier = SelfAgentVerifier.create()
  .network("testnet")
  .sybilLimit(0) // disable for demo
  .replayProtection(false)
  .build();

// Self-verify: generate headers and verify them
const headers = await agent.signRequest("GET", "https://example.com/api/test");
const result = await verifier.verify({
  signature: headers["x-self-agent-signature"],
  timestamp: headers["x-self-agent-timestamp"],
  method: "GET",
  url: "https://example.com/api/test",
  keytype: headers["x-self-agent-keytype"],
  agentKey: headers["x-self-agent-key"],
});

console.log("Verification result:", result.valid ? "PASS" : "FAIL");
if (result.valid) {
  console.log(`  Agent: ${result.agentAddress}`);
  console.log(`  Agent ID: #${result.agentId}`);
}
