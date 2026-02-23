import { SelfAgent } from "@selfxyz/agent-sdk";

// Create an agent from a private key
const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  network: "testnet",
});

// Check registration status
const registered = await agent.isRegistered();
console.log("Registered:", registered);

if (registered) {
  const info = await agent.getInfo();
  console.log("Agent ID:", info.agentId);
  console.log("Verified:", info.isVerified);

  // Make a signed request to a protected API
  const res = await agent.fetch("http://localhost:3000/api/data", {
    method: "POST",
    body: JSON.stringify({ message: "Hello from a verified agent" }),
  });
  console.log("Response:", res.status, await res.text());
}
