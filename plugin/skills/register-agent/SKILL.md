---
name: register-agent
description: >
  Step-by-step guide for registering AI agents with proof-of-human identity
  on the Self Agent ID registry. Covers all 6 registration modes (linked,
  wallet-free, privy, smartwallet, ed25519, ed25519-linked), 6 verification
  configs, MCP tools, SDK and REST usage, and proof refresh. Use when the user asks to "register an agent", "create agent
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
- **No gas or wallet setup for the agent** — the Self app submits the proof to Hub V2 and the registry mints the identity; the agent itself never sends a transaction to register. Testnet (Celo Sepolia, chain 11142220) is the place to try things first.
- **A human wallet address (optional)** — `linked`, `ed25519-linked`, `privy` and `smartwallet` modes take the human's wallet address (`humanAddress`), which owns or guards the agent. `wallet-free` and `ed25519` need no wallet.

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

`POST /api/agent/register` accepts six modes (the server also accepts the legacy spellings `walletfree` and `smart-wallet`):

| Mode             | When to Use                                        | Agent Key                                      | NFT owner / guardian                         |
| ---------------- | -------------------------------------------------- | ---------------------------------------------- | -------------------------------------------- |
| `linked`         | Agent linked to a human's existing wallet          | Server-generated ECDSA key, exported later     | Human wallet (`humanAddress`) owns the NFT   |
| `wallet-free`    | Quick start, no wallet at all                      | Server-generated ECDSA key, exported later     | The agent address owns its own NFT           |
| `privy`          | Human signed in with email/social login via Privy  | Same as `linked`                               | Human's Privy embedded wallet                |
| `smartwallet`    | Human uses a passkey smart wallet                  | Same as `linked`                               | Human's smart wallet address                 |
| `ed25519`        | Agent already has an Ed25519 key (OpenClaw, Eliza) | Agent's own Ed25519 pubkey (signs a challenge) | Address derived from the pubkey; no guardian |
| `ed25519-linked` | Ed25519 agent with a human wallet for revocation   | Agent's own Ed25519 pubkey (signs a challenge) | Derived address; human wallet is guardian    |

`privy` and `smartwallet` behave exactly like `linked` on the server: the server generates the agent key and the human's wallet address is passed as `humanAddress`. Nothing is sent through a bundler or paymaster; the agent key is a plain ECDSA key.

For most production use cases, choose **linked** (ECDSA) or **ed25519-linked** (Ed25519). Both give the agent its own signing key while a human wallet keeps control over the identity.

The CLI (`self-agent register init`) supports only `--mode linked` and `--mode wallet-free`; use the SDK or REST API for the other modes.

For a detailed technical comparison, including userDefinedData encoding formats and a decision tree, see [`references/registration-modes.md`](references/registration-modes.md).

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

When registering through an AI coding assistant (Claude Code, Cursor, etc.) connected to the hosted MCP server (`https://agent-api.self.xyz/api/mcp`, configured by this plugin's `.mcp.json`):

### Step 1: Initiate Registration

Call the public `self_register_agent` tool with:

- `minimum_age` (optional): `0`, `18`, or `21`
- `ofac` (optional): `true` or `false`
- `human_address` (optional): the human's wallet. With it the agent is registered in `linked` mode; without it, in `wallet-free` mode.
- `network`: `"testnet"` or `"mainnet"`

The tool returns a QR image plus JSON:

```
deep_link          — Link that opens the Self app (mobile)
scan_url           — URL of a PNG QR code to show the human
expires_at         — Session expiry (ISO-8601, 30 minutes from creation)
human_instructions — Steps to show the human
session_token      — Pass to self_check_registration
agent_address      — The new agent's address
mode, network      — "linked" or "wallet-free"; the network used
```

The server generates the agent key. It is **not** returned here; it is exported in Step 4.

### Step 2: Present QR Code or Deep Link

Show the QR image (or `scan_url`) to the human. The human opens the Self app, scans the QR code, then scans their passport NFC chip. The Self app handles ZK proof generation and on-chain submission automatically.

For mobile contexts, provide the `deep_link` instead, which opens the Self app directly.

### Step 3: Poll Registration Status

Call the public `self_check_registration` tool with:

- `session_token`: the newest `session_token` (from Step 1 or the previous poll — the token rotates on every poll)

Poll every 5-10 seconds. The tool returns:

```
stage:          "qr-ready" | "completed" | "expired"
session_token:  rotated token for the next call
agent_id, agent_address, credentials, export_expires_at   (when completed)
```

Continue polling while the stage is `"qr-ready"`. The session expires after 30 minutes. `"completed"` means the soulbound NFT has been minted and credentials stored on-chain.

### Step 4: Export and Store the Private Key

Once completed, call `self_check_registration` again with the latest `session_token` and `reveal_private_key: true` before `export_expires_at` (30 minutes after completion). It returns `private_key` — the agent's ECDSA signing key. It **cannot be recovered** after the session expires.

Store it as an environment variable:

```
SELF_AGENT_PRIVATE_KEY=0x...
```

Add to `.env` and ensure `.env` is listed in `.gitignore`. See the Private Key Security section below for production recommendations.

### Step 5: Verify the Identity

Call the public `self_lookup_agent` tool with the `agent_id` (or `agent_address`) from Step 3 and the same `network`. It returns verification status, proof provider, proof expiry and disclosed credentials.

(`self_get_identity` is a privileged tool that reports on the MCP **server's** own configured agent; it does not look up the agent you just registered.)

## Step-by-Step Registration Using SDK

### TypeScript (ECDSA)

```typescript
import { SelfAgent, requestRegistration } from "@selfxyz/agent-sdk";

const session = await requestRegistration({
  mode: "linked", // or "wallet-free", "privy", "smartwallet"
  network: "testnet",
  disclosures: { minimumAge: 18, ofac: true },
  humanAddress: "0x...", // required for linked, privy and smartwallet
});

// Show the QR code to the human (or send them session.deepLink)
console.log("Scan this QR code with the Self app:", session.scanUrl);

// Poll until the human finishes (default timeout 30 minutes)
const result = await session.waitForCompletion();
console.log("Agent registered! ID:", result.agentId);

// Export the server-generated key (allowed for 30 minutes after completion)
const privateKey = await session.exportKey();
const agent = new SelfAgent({ privateKey, network: "testnet" });

const info = await agent.getInfo();
console.log("Verified:", info.isVerified); // hasHumanProof && isProofFresh
console.log("Proof expires:", info.proofExpiresAt);
```

`SelfAgent.requestRegistration(...)` is the same function as a static method.

### TypeScript (Ed25519)

Ed25519 modes register a key the agent already has. The agent signs a challenge from the server with that key; the server never sees the private key, so there is nothing to export afterwards.

```typescript
import * as ed from "@noble/ed25519";
import { Ed25519Agent, requestRegistration } from "@selfxyz/agent-sdk";

const API = "https://agent-api.self.xyz";
const seedHex = process.env.ED25519_SEED!; // 64 hex chars, no 0x
const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
const pubkey = Buffer.from(await ed.getPublicKeyAsync(seed)).toString("hex");
const humanAddress = "0x..."; // omit for mode "ed25519"

// 1. Get the challenge (include humanAddress for ed25519-linked)
const { challengeHash } = await fetch(
  `${API}/api/agent/register/ed25519-challenge`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pubkey, network: "testnet", humanAddress }),
  },
).then((r) => r.json());

// 2. Sign the raw 32 bytes of challengeHash
const signature = Buffer.from(
  await ed.signAsync(Buffer.from(challengeHash.slice(2), "hex"), seed),
).toString("hex");

// 3. Register
const session = await requestRegistration({
  mode: "ed25519-linked",
  network: "testnet",
  disclosures: { minimumAge: 18, ofac: true },
  humanAddress,
  ed25519Pubkey: pubkey,
  ed25519Signature: signature,
});
console.log("Scan:", session.scanUrl);
await session.waitForCompletion();

// 4. Sign requests with the same key
const agent = new Ed25519Agent({ privateKey: seedHex, network: "testnet" });
const headers = await agent.signRequest("POST", url, body);
// Headers include x-self-agent-keytype: "ed25519"
```

Ed25519 agents send `x-self-agent-key` and `x-self-agent-keytype: ed25519` in place of `x-self-agent-address`, alongside the usual signature and timestamp headers, and are verified transparently by `SelfAgentVerifier`.

### REST API (curl, any language)

The TypeScript SDK is the only SDK; from other languages call the REST API directly.

```bash
API=https://agent-api.self.xyz

# 1. Start a session (wallet-free: no humanAddress)
curl -s -X POST $API/api/agent/register \
  -H 'Content-Type: application/json' \
  -d '{"mode":"wallet-free","network":"testnet","disclosures":{"minimumAge":18,"ofac":true}}'
# → { sessionToken, stage: "qr-ready", deepLink, scanUrl, qrImageBase64, agentAddress, expiresAt, ... }

# 2. Poll (session tokens go in the Authorization header only; use the rotated token each time)
curl -s $API/api/agent/register/status -H "Authorization: Bearer $TOKEN"

# 3. After stage "completed", export the generated key
curl -s -X POST $API/api/agent/register/export -H "Authorization: Bearer $TOKEN"
```

## Private Key Security

The agent's private key is the sole credential for signing authenticated requests. Compromise of this key allows impersonation of the agent.

**Development:**

- Store in a `.env` file: `SELF_AGENT_PRIVATE_KEY=0x...`
- Add `.env` to `.gitignore` immediately
- Never log or print the private key in application output

**Production:**

- Use a secrets manager: AWS Secrets Manager, GCP Secret Manager, HashiCorp Vault, or Doppler
- Rotate keys by deregistering and registering a new agent (a new agentId is minted)
- Restrict access to the secret to only the agent's runtime environment
- Enable audit logging on the secrets manager to detect unauthorized access

**Critical rules:**

- NEVER commit private keys to version control
- NEVER share private keys in chat, email, or documentation
- NEVER embed private keys in client-side code or mobile apps
- For server-generated keys (`linked`, `wallet-free`, `privy`, `smartwallet`), the key can be exported only while the session token is valid (30 minutes after completion) and **cannot be recovered** afterwards. Losing the key means the agent can no longer sign requests, and a new registration is required.

## Post-Registration Verification

After successful registration, verify the agent identity is correctly recorded on-chain:

1. **Call `self_lookup_agent`** (MCP), `agent.getInfo()` (SDK) or `GET /api/agent/info/{chainId}/{agentId}` (REST) — confirm `isVerified: true` (human proof present **and** fresh), the agent ID is non-zero, and the proof provider is the Self Protocol address.

2. **Check credentials** — verify the stored credentials match the selected verification config (e.g., `olderThan: 18` for config `'1'` or `'4'`, OFAC booleans set for configs `'3'`, `'4'`, or `'5'`).

3. **Verify on a block explorer** — navigate to the registry contract on Celoscan or Blockscout and look up the agent ID. The soulbound NFT should be visible under the NFT owner's address.

4. **Test request signing** — use `agent.signRequest()` (SDK) to generate auth headers, then verify them with `SelfAgentVerifier` or the public `self_verify_request` MCP tool to confirm the full authentication pipeline works end-to-end.

## Proof Expiry & Refreshing Registration

Human proofs are **not permanent**. Each registration sets a `proofExpiresAt` timestamp equal to `min(passport_document_expiry, now + maxProofAge)`, where `maxProofAge` defaults to **365 days**.

After expiry:

- `isProofFresh(agentId)` returns `false` — services using freshness checks will reject the agent, and the API reports `isVerified: false`.
- `hasHumanProof(agentId)` still returns `true` — the historical proof record is preserved.
- The soulbound NFT remains, but the agent is functionally inactive for freshness-gated operations.

### How to Refresh (In-Place)

Use `requestProofRefresh()` (TypeScript SDK) or `POST /api/agent/refresh` to refresh a proof without changing the agentId. The human scans their passport again via the Self app, and the contract updates `proofExpiresAt` in-place.

```typescript
import { requestProofRefresh } from "@selfxyz/agent-sdk";

const session = await requestProofRefresh({
  agentId: 5, // existing agent ID to refresh
  network: "mainnet",
  // disclosures default to the agent's on-chain config
});

console.log("Scan QR to refresh:", session.scanUrl);

const { proofExpiresAt } = await session.waitForCompletion(); // Date | undefined (only if the server reported it)
// proofExpiresAt is updated. agentId stays the same.
```

The contract emits `HumanProofRefreshed(agentId, nullifier, newExpiresAt, configId)` on success.

Limitations:

- Agents registered through an external proof provider cannot be refreshed (400).
- Agent ids whose 32-byte big-endian encoding contains a byte `>= 0x80` (for example 128–255, 384, …) are rejected with **422**: the Self app encodes `userDefinedData` as UTF-8, so such bytes cannot reach the contract intact. Use deregister + re-register for those agents.

### Alternative: Deregister and Re-Register

If in-place refresh is not possible (422 above, changing verification config, or switching key types), deregister and re-register:

1. **Deregister** with `agent.requestDeregistration()` (SDK), `POST /api/agent/deregister`, or the CLI `deregister` flow. This burns the NFT and clears all state. Ed25519 agents cannot be deregistered through the API; use `guardianRevoke()` from the guardian wallet on-chain.
2. **Re-register** with the desired configuration. A **new agentId** is minted.

The old agentId is permanently burned. Plan for this in applications that store agentIds — they will change.

### Proactive Monitoring

The SDK includes a 30-day warning threshold (`isExpiringSoon` on `getInfo()`). Check `proofExpiresAt` and prompt the human to refresh before expiry to avoid service disruption.

## Troubleshooting

| Symptom                        | Cause                                        | Resolution                                                                                                           |
| ------------------------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| QR code not scanning           | Self app outdated                            | Update the Self app to the latest version                                                                            |
| NFC scan fails                 | Phone NFC disabled or passport not supported | Enable NFC in phone settings; ensure passport has an NFC chip (look for the chip icon on the bio page)               |
| Stage stays "qr-ready"         | Human has not completed the Self app flow    | Wait for the human to scan passport; check Self app for errors. A proof rejected on-chain also leaves the stage here |
| Stage is "expired" / 410       | 30-minute session timeout elapsed            | Start a new registration session                                                                                     |
| 401 on status/export           | Stale or missing session token               | Send `Authorization: Bearer <token>` with the newest rotated `sessionToken`                                          |
| `TooManyAgentsForHuman` error  | Sybil limit reached                          | The same human has already registered the maximum number of agents (default: 1). Deregister an existing agent first. |
| `AgentAlreadyRegistered` error | Agent key already has a registration         | The agent address is already registered. Use a different keypair or deregister the existing agent.                   |

## Reference Documentation

For a detailed comparison of all six registration modes, userDefinedData encoding formats, and decision trees, see [`references/registration-modes.md`](references/registration-modes.md).
