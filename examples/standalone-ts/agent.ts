// SPDX-License-Identifier: MIT

/**
 * Reference Ed25519 agent: generate/load a key, register it, sign requests, verify.
 *
 * Env: ED25519_SEED, SERVICE_URL, SELF_AGENT_API_BASE. Pass --register to register. Steps:
 *   1. Generate or load an Ed25519 keypair
 *   2. Register via the Self Agent ID API (requires human QR scan)
 *   3. Authenticate API requests with Ed25519 signatures
 *   4. Verify another agent's identity
 */

import { Ed25519Agent, SelfAgentVerifier } from "@selfxyz/agent-sdk";
import { createPrivateKey, randomBytes, sign } from "crypto";

const API_BASE =
  process.env.SELF_AGENT_API_BASE || "https://agent-api.self.xyz";

// ── 1. Generate or load keypair ──────────────────────────────────────────────

// In production, persist this seed securely (env var, vault, HSM).
const seed = process.env.ED25519_SEED || randomBytes(32).toString("hex");

console.log("Ed25519 seed:", seed);

const agent = new Ed25519Agent({
  privateKey: seed,
  network: "testnet",
});

console.log("Agent address (derived):", agent.address);
console.log("Agent key (Ed25519 public key):", agent.agentKey);

// ── 2. Check registration (register with --register) ────────────────────────

let registered = await agent.isRegistered();
console.log("Registered:", registered);

if (!registered) {
  if (!process.argv.includes("--register")) {
    console.log("\nAgent not registered. Re-run with --register (and the same");
    console.log("ED25519_SEED) to get a QR code for the Self app.");
    process.exit(0);
  }

  // The agent proves key ownership by signing the registry challenge: the raw
  // 32 bytes of challengeHash, with its Ed25519 key.
  const pubkey = agent.agentKey.slice(2); // 64 hex chars, no 0x
  /** POST JSON to the API and return the parsed body; throws on non-2xx. */
  const postJson = async (path: string, body: unknown) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`${path}: ${res.status} ${data.error}`);
    return data;
  };

  const { challengeHash } = await postJson(
    "/api/agent/register/ed25519-challenge",
    { pubkey, network: "testnet" },
  );
  const key = createPrivateKey({
    // PKCS#8 DER prefix for a raw 32-byte Ed25519 seed
    key: Buffer.from(
      "302e020100300506032b657004220420" + seed.replace(/^0x/, ""),
      "hex",
    ),
    format: "der",
    type: "pkcs8",
  });
  const signature = sign(
    null,
    Buffer.from(challengeHash.slice(2), "hex"),
    key,
  ).toString("hex");

  const session = await postJson("/api/agent/register", {
    mode: "ed25519",
    network: "testnet",
    ed25519Pubkey: pubkey,
    ed25519Signature: signature,
  });
  console.log("\nOpen this QR code and scan it with the Self app:");
  console.log(`  ${session.scanUrl}`);
  console.log(`(or open on your phone: ${session.deepLink})`);

  // Completion is visible on-chain; poll until the agent is registered.
  const deadline = Date.parse(session.expiresAt);
  while (!registered && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5_000));
    registered = await agent.isRegistered();
  }
  if (!registered) {
    console.log("Session expired before registration completed.");
    process.exit(1);
  }
  console.log("Registered!");
}

// ── 3. Make signed requests ──────────────────────────────────────────────────

// isRegistered() only means a human proof was recorded (it may have expired);
// isVerified = hasHumanProof && isProofFresh, which is what verifiers require.
const info = await agent.getInfo();
console.log(`\nAgent ID: #${info.agentId}`);
console.log(`Verified (fresh proof): ${info.isVerified}`);

// Sign and send a request to a protected service. Set SERVICE_URL to an
// endpoint that verifies Self agent signatures — the minimal-ts example ships a
// runnable verifier service you can point this at.
const SERVICE_URL = process.env.SERVICE_URL;

if (SERVICE_URL) {
  console.log(`\nSending signed request to ${SERVICE_URL}...`);

  const res = await agent.fetch(SERVICE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Hello from Ed25519 agent" }),
  });

  console.log(`Response: ${res.status}`);
  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
} else {
  console.log(
    "\nSet SERVICE_URL to a protected endpoint to send a signed request.",
  );
}

// ── 4. Verify another agent (service-side) ───────────────────────────────────

console.log("\n--- Service-side verification demo ---");

const verifier = SelfAgentVerifier.create()
  .network("testnet")
  .sybilLimit(0) // disable for demo
  .replayProtection(false)
  .build();

// Self-verify: generate headers and verify them (fails if the proof expired)
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
