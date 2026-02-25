---
name: register-agent
description: >
  Step-by-step guide for registering AI agents with proof-of-human identity
  on the Self Agent ID registry. Covers all 4 registration modes (verified-wallet,
  agent-identity, wallet-free, smart-wallet), 6 verification configs, MCP tools,
  and SDK usage. Use when the user asks to "register an agent", "create agent
  identity", "get verified", "self agent registration", "proof of human",
  "register with self", or "onboard agent".
license: MIT
metadata:
  author: Self Protocol
  version: 1.0.0
  mcp-server: self-agent-id
---

# Register an Agent

## Prerequisites

Before starting the registration flow, ensure the following are in place:

- **Self app** installed on a smartphone (iOS or Android). Download from [selfcrypto.com](https://selfcrypto.com). The app generates ZK proofs locally and communicates with the on-chain Hub V2 contract.
- **Passport with NFC chip** — required for biometric identity verification. The Self app reads the passport's NFC chip to extract identity data, then generates a zero-knowledge proof entirely on-device.
- **Celo network access** — for on-chain registration. Testnet (Celo Sepolia, chain 11142220) requires no real funds. Mainnet (Celo, chain 42220) requires CELO for gas (unless using smart-wallet mode with a paymaster).
- **A wallet or keypair** — depending on the chosen registration mode. Verified-wallet mode uses an existing human wallet. Agent-identity mode generates a fresh ECDSA keypair. Wallet-free and smart-wallet modes handle key management through their respective systems.

## Registration Flow Overview

The full registration lifecycle follows this sequence:

1. **Initiate** — The agent or developer requests registration, specifying a mode and verification config.
2. **QR / Deep Link** — The system generates a QR code (or deep link) encoding the registration session.
3. **Human scans QR** — The human opens the Self app and scans the QR code.
4. **Passport NFC scan** — The Self app prompts the human to scan their passport's NFC chip.
5. **ZK proof generated** — The Self app generates a zero-knowledge proof locally on the device. No passport data leaves the phone.
6. **Proof submitted to Hub V2** — The Self app submits the ZK proof to the Hub V2 contract on-chain.
7. **Hub V2 verifies** — Hub V2 validates the ZK proof against the selected verification config.
8. **Callback to registry** — Hub V2 calls `customVerificationHook()` on the `SelfAgentRegistry` contract.
9. **Soulbound NFT minted** — The registry mints a non-transferable ERC-721 NFT representing the agent identity.
10. **Credentials stored** — ZK-attested credentials (nationality, age threshold, OFAC status) are stored on-chain.

The entire flow typically takes 30-90 seconds from QR scan to NFT mint. The registration session expires after 30 minutes if the human does not complete the Self app flow.

## Mode Selection Guide

Select the registration mode that best fits the use case:

| Mode                         | When to Use                          | Agent Key                            | Trade-off                              |
| ---------------------------- | ------------------------------------ | ------------------------------------ | -------------------------------------- |
| verified-wallet              | Single agent, human IS the agent     | `zeroPadded(humanAddress)`           | Simplest, but human wallet exposed     |
| agent-identity (recommended) | Production agents, dedicated keypair | Agent generates own ECDSA keypair    | Most flexible, agent has own wallet    |
| wallet-free                  | No human wallet needed               | Agent-generated, guardian = Self app | Managed entirely via Self app          |
| smart-wallet                 | Best UX, passkey-based               | ZeroDev Kernel + Pimlico             | Gasless on mainnet, most complex setup |

For most production use cases, choose **agent-identity** mode. It provides the strongest separation between human identity and agent operations, and gives the agent its own wallet for signing requests independently.

For a detailed technical comparison of all four modes, including userDefinedData encoding formats and decision trees, see [`references/registration-modes.md`](references/registration-modes.md).

## Verification Config Selection

At registration time, select one of 6 verification configs. The config digit is placed at position `[1]` in the `userDefinedData` field, encoded as a UTF-8 ASCII character (`'0'` through `'5'`).

| Config | Age Requirement | OFAC Check | Use Case                                   |
| ------ | --------------- | ---------- | ------------------------------------------ |
| `'0'`  | None            | No         | Development, testing, minimum verification |
| `'1'`  | 18+             | No         | Age-gated (18+), no sanctions screening    |
| `'2'`  | 21+             | No         | Age-gated (21+), no sanctions screening    |
| `'3'`  | None            | Yes        | OFAC sanctions screening only              |
| `'4'`  | 18+             | Yes        | Most common for production services        |
| `'5'`  | 21+             | Yes        | Strictest compliance (age 21+ and OFAC)    |

**Recommendation:** Use config `'4'` (age 18+ with OFAC) for most production deployments. Use config `'0'` for development and testing.

## Step-by-Step Registration Using MCP

When registering through an AI coding assistant (Claude Code, Cursor, etc.) with the `@selfxyz/mcp-server` installed:

### Step 1: Initiate Registration

Call the `self_register_agent` tool with:

- `minimum_age`: `0`, `18`, or `21`
- `ofac`: `true` or `false`
- `network`: `"testnet"` or `"mainnet"`

The tool returns:

```
session_id     — Unique identifier for this registration session
agent_address  — The agent's Ethereum address
qr_url         — URL to display as a QR code for the Self app
deep_link      — Direct link to open the Self app (mobile)
private_key_hex — The agent's ECDSA private key (SAVE THIS IMMEDIATELY)
expires_at     — Session expiry timestamp (30 minutes from creation)
```

### Step 2: Present QR Code or Deep Link

Display the `qr_url` to the human. The human opens the Self app, scans the QR code, then scans their passport NFC chip. The Self app handles ZK proof generation and on-chain submission automatically.

For mobile contexts, provide the `deep_link` instead, which opens the Self app directly.

### Step 3: Poll Registration Status

Call the `self_check_registration` tool with:

- `session_id`: The session ID from Step 1

Poll every 5-10 seconds. The tool returns:

```
status: "pending" | "verified" | "expired" | "failed"
agent_id: (present when status is "verified") — the on-chain agent ID (uint256)
```

Continue polling until the status changes from `"pending"`. The session expires after 30 minutes. A `"verified"` status means the soulbound NFT has been minted and credentials stored on-chain.

### Step 4: Store the Private Key Securely

Save the `private_key_hex` returned in Step 1 immediately. This is the agent's ECDSA signing key — it is generated once and **cannot be recovered** if lost.

Store as an environment variable:

```
SELF_AGENT_PRIVATE_KEY=0x...
```

Add to `.env` and ensure `.env` is listed in `.gitignore`. See the Private Key Security section below for production recommendations.

### Step 5: Verify the Identity

Call the `self_get_identity` tool to confirm registration:

- Input: the chain ID and agent ID from Step 3
- Output: registered status, verification details, credentials, proof provider

This confirms the full registration is complete and the agent identity is queryable on-chain.

## Step-by-Step Registration Using SDK

For programmatic registration in TypeScript:

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

// Generate a new agent (creates a fresh ECDSA keypair)
const agent = new SelfAgent({ network: "testnet" });

// Or use an existing private key
// const agent = new SelfAgent({ privateKey: "0x...", network: "testnet" });

// Initiate registration with config: age 18+, OFAC check
const session = await agent.register("agent-identity", {
  minimumAge: 18,
  ofac: true,
});

// Display QR code to the human
console.log("Scan this QR code with the Self app:", session.deepLink);
console.log("Session token received");

// Poll for completion
let status = await agent.getRegistrationStatus();
while (status.status === "pending") {
  await new Promise((r) => setTimeout(r, 5000)); // Wait 5 seconds
  status = await agent.getRegistrationStatus();
}

if (status.status === "verified") {
  console.log("Agent registered! ID:", status.agentId);

  // Confirm identity
  const info = await agent.getInfo();
  console.log("Registered:", info.registered);
  console.log("Agent ID:", info.agentId);
  console.log("Credentials:", info.credentials);
}
```

Python and Rust SDKs expose the same API surface. Replace `SelfAgent` import with the equivalent package:

- Python: `from selfxyz_agent_sdk import SelfAgent`
- Rust: `use self_agent_sdk::SelfAgent;`

## Private Key Security

The agent's private key is the sole credential for signing authenticated requests. Compromise of this key allows impersonation of the agent.

**Development:**

- Store in a `.env` file: `SELF_AGENT_PRIVATE_KEY=0x...`
- Add `.env` to `.gitignore` immediately
- Never log or print the private key in application output

**Production:**

- Use a secrets manager: AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, or Doppler
- Rotate keys by deregistering and re-registering with a new keypair
- Restrict access to the secret to only the agent's runtime environment
- Enable audit logging on the secrets manager to detect unauthorized access

**Critical rules:**

- NEVER commit private keys to version control
- NEVER share private keys in chat, email, or documentation
- NEVER embed private keys in client-side code or mobile apps
- The private key is generated during registration and **cannot be recovered** if lost. Losing the key means the agent can no longer sign requests, and a new registration is required.

## Post-Registration Verification

After successful registration, verify the agent identity is correctly recorded on-chain:

1. **Call `self_get_identity`** (MCP) or `agent.getInfo()` (SDK) — confirm `registered: true`, the agent ID is non-zero, and the proof provider is the Self Protocol address.

2. **Check credentials** — verify the stored credentials match the selected verification config (e.g., `olderThan: 18` for config `'1'` or `'4'`, OFAC booleans set for configs `'3'`, `'4'`, or `'5'`).

3. **Verify on a block explorer** — navigate to the registry contract on Celoscan or Blockscout and look up the agent ID. The soulbound NFT should be visible under the NFT owner's address.

4. **Test request signing** — use the `self_sign_request` MCP tool or `agent.signRequest()` SDK method to generate auth headers, then verify them with `SelfAgentVerifier` to confirm the full authentication pipeline works end-to-end.

## Proof Expiry & Refreshing Registration

Human proofs are **not permanent**. Each registration sets a `proofExpiresAt` timestamp equal to `min(passport_document_expiry, now + maxProofAge)`, where `maxProofAge` defaults to **365 days**.

After expiry:

- `isProofFresh(agentId)` returns `false` — services using freshness checks will reject the agent.
- `hasHumanProof(agentId)` still returns `true` — the historical proof record is preserved.
- The soulbound NFT remains, but the agent is functionally inactive for freshness-gated operations.

### How to Refresh

There is no in-place refresh function. To renew:

1. **Deregister** the expired agent using the `self_deregister_agent` MCP tool, `agent.requestDeregistration()` SDK method, or CLI `deregister` flow. This burns the NFT and clears all state (including `proofExpiresAt`).
2. **Re-register** with the same agent key. The human scans their passport again via the Self app. A **new agentId** is minted with a fresh expiry.

The old agentId is permanently burned. The new agentId is monotonically higher. Plan for this in applications that store agentIds — they will change on refresh.

### Proactive Monitoring

SDKs include a 30-day warning threshold. Check `proofExpiresAt` and prompt the human to re-verify before expiry to avoid service disruption.

## Troubleshooting

| Symptom                        | Cause                                        | Resolution                                                                                                           |
| ------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| QR code not scanning           | Self app outdated                            | Update the Self app to the latest version                                                                            |
| NFC scan fails                 | Phone NFC disabled or passport not supported | Enable NFC in phone settings; ensure passport has an NFC chip (look for the chip icon on the bio page)               |
| Status stays "pending"         | Human has not completed the Self app flow    | Wait for the human to scan passport; check Self app for errors                                                       |
| Status is "expired"            | 30-minute session timeout elapsed            | Start a new registration session                                                                                     |
| Status is "failed"             | ZK proof verification failed on-chain        | Check the verification config matches the passport capabilities; retry with a fresh session                          |
| `TooManyAgentsForHuman` error  | Sybil limit reached                          | The same human has already registered the maximum number of agents (default: 1). Deregister an existing agent first. |
| `AgentAlreadyRegistered` error | Agent key already has a registration         | The agent address is already registered. Use a different keypair or deregister the existing agent.                   |

## Reference Documentation

For detailed comparison of all four registration modes, userDefinedData encoding formats, and decision trees, see [`references/registration-modes.md`](references/registration-modes.md).
