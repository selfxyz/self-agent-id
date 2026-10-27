// SPDX-License-Identifier: MIT

/**
 * Minimal agent: check on-chain status, then send a signed request to the minimal-ts service.
 *
 * Env: AGENT_PRIVATE_KEY (a registered testnet agent key).
 */

import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  network: "testnet",
});

// isRegistered() = a human proof was recorded (it may have expired)
const registered = await agent.isRegistered();
console.log("Registered:", registered);

const info = await agent.getInfo();
// isVerified = hasHumanProof && isProofFresh (what verifiers require)
const verified = info.isVerified;
console.log("Agent ID:", info.agentId);
console.log("Verified (fresh proof):", verified);

if (registered && !verified) {
  console.log(
    "Human proof expired — refresh it before calling verified services.",
  );
}

if (verified) {
  // Make a signed request to a protected API
  const res = await agent.fetch("http://localhost:3000/api/data", {
    method: "POST",
    body: JSON.stringify({ message: "Hello from a verified agent" }),
  });
  console.log("Response:", res.status, await res.text());
}
