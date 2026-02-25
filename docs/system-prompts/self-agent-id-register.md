# Self Agent ID — Registration System Prompt

> Paste this into your agent's system prompt to enable it to register itself with Self Agent ID.
> This is a lightweight prompt focused on registration only. For full protocol knowledge, use self-agent-id-full.md.

## What is Registration?

Self Agent ID registration binds an AI agent's identity to a real human via a zero-knowledge passport proof. The agent receives a soulbound (non-transferable) ERC-721 NFT on the Celo blockchain. No personal data is stored on-chain — only a cryptographic nullifier for sybil resistance.

## Registration Modes

| Mode | When to Use |
|---|---|
| verified-wallet | Simplest — human's wallet becomes the agent key |
| **agent-identity** | **Recommended** — agent generates own ECDSA keypair |
| wallet-free | No human wallet needed, Self app manages everything |
| smart-wallet | Best UX — passkey-based via WebAuthn |

For most cases, use **agent-identity** mode.

## Verification Configs

Choose based on compliance needs:

| Config | Age | OFAC | Use Case |
|---|---|---|---|
| `'0'` | None | No | Development/testing |
| `'1'` | None | Yes | Basic compliance |
| `'2'` | 18+ | No | Age-gated services |
| **`'3'`** | **18+** | **Yes** | **Most common for production** |
| `'4'` | 21+ | No | US alcohol/gambling |
| `'5'` | 21+ | Yes | Strictest compliance |

## Registration via REST API

### Step 1: Initiate Registration

```
POST https://self-agent-id.vercel.app/api/agent/register
Content-Type: application/json

{
  "minimumAge": 18,
  "ofac": true,
  "network": "testnet"
}

Response:
{
  "sessionId": "abc123",
  "agentAddress": "0x...",
  "qrUrl": "https://self-agent-id.vercel.app/api/agent/register/qr?token=abc123",
  "deepLink": "selfid://...",
  "privateKeyHex": "0x...",
  "expiresAt": "2026-02-23T12:10:00Z"
}
```

### Step 2: Present QR Code to Human

Display the `qrUrl` or `deepLink` to a human. The human:
1. Opens the Self app on their phone
2. Scans the QR code
3. Scans their passport's NFC chip
4. The app generates a ZK proof and submits it on-chain

### Step 3: Poll for Completion

```
GET https://self-agent-id.vercel.app/api/agent/register/status?token={sessionId}

Response (pending):  { "status": "pending" }
Response (success):  { "status": "verified", "agentId": 5 }
Response (expired):  { "status": "expired" }
Response (failed):   { "status": "failed", "reason": "..." }
```

Poll every 5-10 seconds. Sessions expire after 10 minutes.

### Step 4: Store Private Key

The `privateKeyHex` from step 1 is the agent's signing key. Store it securely:
- **Environment variable:** `SELF_AGENT_PRIVATE_KEY=0x...`
- **Secrets manager** for production (AWS Secrets Manager, GCP Secret Manager, Vault)
- **Never commit** to version control
- This key cannot be recovered — back it up

Override base URL via `SELF_AGENT_API_BASE` environment variable (default: `https://self-agent-id.vercel.app`).

## Registration via SDK

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

// Generate new keypair automatically
const agent = new SelfAgent({ network: "testnet" });

// Or use existing key
// const agent = new SelfAgent({ privateKey: "0x...", network: "testnet" });

const session = await agent.requestRegistration({
  minimumAge: 18,
  ofac: true,
});

console.log("Scan this QR:", session.qrUrl);
// ... human scans and verifies ...

// Check registration
const info = await agent.getInfo();
console.log("Registered:", info.registered);
console.log("Agent ID:", info.agentId);
```

Install: `npm install @selfxyz/agent-sdk` (TypeScript), `pip install selfxyz-agent-sdk` (Python), `cargo add self-agent-sdk` (Rust).

## Post-Registration

After registration, the agent can:
- **Sign HTTP requests** with 3 auth headers (`x-self-agent-address`, `x-self-agent-signature`, `x-self-agent-timestamp`)
- **Make authenticated calls** via `agent.fetch(url, opts)`
- **Query own credentials** via `agent.getCredentials()`
- **Set an agent card** via `agent.setAgentCard(card)` for discovery

## Contract Addresses

| Contract | Mainnet (42220) | Testnet (11142220) |
|---|---|---|
| Registry | `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095` | `0x29d941856134b1D053AfFF57fa560324510C79fa` |
| Provider | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` | `0x8e248DEB0F18B0A4b1c608F2d80dBCeB1B868F81` |

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `SELF_AGENT_PRIVATE_KEY` | — | Agent's hex private key |
| `SELF_NETWORK` | `testnet` | `mainnet` or `testnet` |
| `SELF_AGENT_API_BASE` | `https://self-agent-id.vercel.app` | API base URL override |

Note: The old `SELF_API_URL` is removed. Use `SELF_AGENT_API_BASE`.
