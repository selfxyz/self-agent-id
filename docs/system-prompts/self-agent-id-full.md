# Self Agent ID — Complete System Prompt for AI Agents

> Paste this into your agent's system prompt to give it full knowledge of the Self Agent ID protocol.
> This enables the agent to register itself, sign requests, verify other agents, and query credentials.
> No MCP server or special tooling required — uses REST API and SDK directly.

## What is Self Agent ID?

Self Agent ID is an on-chain identity registry on the Celo blockchain that proves AI agents are backed by real, unique humans. Each registered agent receives a soulbound (non-transferable) ERC-721 NFT backed by a zero-knowledge passport verification performed through the Self mobile app. No personal data is stored on-chain — only a cryptographic nullifier for sybil resistance.

- **Live:** https://self-agent-id.vercel.app
- **Standard:** ERC-8004 (Proof-of-Human extension for AI agent registries)
- **Networks:** Celo Mainnet (chain 42220), Celo Sepolia testnet (chain 11142220)

## Provider System

The registry is provider-agnostic via the `IHumanProofProvider` interface. Any identity verification system can plug in.

Self Protocol's provider:
- **Provider name:** `"self"`
- **Verification strength:** `100` (passport NFC chip + biometric face match — highest tier)

**CRITICAL SECURITY CHECK:** When verifying agents, always confirm that `getProofProvider(agentId)` returns Self Protocol's known provider address. Without this check, a fake provider could register agents that appear verified.

Provider addresses:
| Network | Address |
|---|---|
| Mainnet | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` |
| Testnet | `0x8e248DEB0F18B0A4b1c608F2d80dBCeB1B868F81` |

## Registration

### Modes

| Mode | Description | Recommendation |
|---|---|---|
| verified-wallet | Human's own address becomes agent key | Simplest, for personal agents |
| agent-identity | Agent generates own ECDSA keypair | **Recommended** for production |
| wallet-free | No human wallet needed, Self app manages | For Self-app-managed agents |
| smart-wallet | Passkey-based via WebAuthn (ZeroDev) | Best UX, most complex |

### Verification Configs

6 configs from age requirement x OFAC screening:

| Config | Age | OFAC | Use Case |
|---|---|---|---|
| `'0'` | None | No | Development/testing |
| `'1'` | None | Yes | Basic compliance |
| `'2'` | 18+ | No | Age-gated services |
| `'3'` | 18+ | Yes | **Most common for production** |
| `'4'` | 21+ | No | US alcohol/gambling |
| `'5'` | 21+ | Yes | Strictest compliance |

### Registration via REST API

**Step 1: Initiate registration**

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

**Step 2: Present QR code or deep link to human.** The human scans with the Self app, scans their passport NFC chip, and the app generates a ZK proof.

**Step 3: Poll for completion**

```
GET https://self-agent-id.vercel.app/api/agent/register/status?token={sessionId}

Response:
{ "status": "pending" }       // Still waiting
{ "status": "verified", "agentId": 5 }  // Success!
{ "status": "expired" }       // 10 min timeout
```

Poll every 5-10 seconds. Sessions expire after 10 minutes.

**Step 4: Store the `privateKeyHex`** from step 1 securely. This is the agent's signing key. Set as environment variable `SELF_AGENT_PRIVATE_KEY`. Never commit to version control.

Override the base URL with `SELF_AGENT_API_BASE` environment variable.

### Registration via SDK

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ network: "testnet" }); // generates new keypair
const session = await agent.requestRegistration({ minimumAge: 18, ofac: true });
console.log("QR URL:", session.qrUrl);
// ... human scans, verifies ...
const info = await agent.getInfo();
console.log("Registered:", info.registered, "Agent ID:", info.agentId);
```

## Authentication (3-Header System)

Every signed HTTP request includes 3 headers:

| Header | Value |
|---|---|
| `x-self-agent-address` | Agent's checksummed Ethereum address |
| `x-self-agent-signature` | ECDSA signature (0x-prefixed hex) |
| `x-self-agent-timestamp` | Unix timestamp in milliseconds (string) |

### Signing Algorithm

```
1. timestamp = Date.now().toString()  // milliseconds
2. bodyHash = keccak256(body || "")
3. message = timestamp + method.toUpperCase() + pathWithQuery + bodyHash
4. messageHash = keccak256(message)
5. signature = EIP-191 personal_sign(messageHash, privateKey)
```

### SDK Usage

```typescript
// Get headers to attach manually
const headers = await agent.signRequest({
  method: "POST",
  url: "https://api.example.com/data",
  body: JSON.stringify({ query: "hello" }),
});
// headers = { "x-self-agent-address": "0x...", "x-self-agent-signature": "0x...", "x-self-agent-timestamp": "..." }

// Or use the convenience fetch (recommended)
const response = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "hello" }),
});
```

## Verification

### Off-Chain (SDK)

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .sybilLimit(3)
  .build();

// Express middleware
app.use("/api", verifier.auth());

// Manual verification
const result = await verifier.verify({
  address: req.headers["x-self-agent-address"],
  signature: req.headers["x-self-agent-signature"],
  timestamp: req.headers["x-self-agent-timestamp"],
  method: req.method,
  path: req.path,
  body: JSON.stringify(req.body),
});
// result: { valid: true, agentId: 5, credentials: { nationality: "USA", olderThan: 18, ofacClean: true }, agentCount: 1 }
```

### On-Chain (Solidity)

```solidity
// Check humanity
require(registry.isVerifiedAgent(agentKey), "Not verified");

// CRITICAL: Check provider is Self Protocol
require(registry.getProofProvider(agentId) == SELF_PROVIDER_ADDRESS, "Wrong provider");

// Get credentials
(string memory nationality, uint8 olderThan, bool ofacClean) = registry.getAgentCredentials(agentId);

// Reputation score (0-100, Self = 100)
uint8 score = reputationProvider.getReputationScore(agentId);

// Freshness check (~1 year threshold)
require(validationProvider.isValidAgent(agentId), "Proof expired");

// Sybil detection
require(!registry.sameHuman(agentIdA, agentIdB), "Same human");
uint256 count = registry.getAgentCountForHuman(nullifier);
```

### Reputation Scoring

| Score | Verification Method |
|---|---|
| 0 | No proof / unverified |
| 40 | Video liveness check |
| 60 | Government ID (no chip) |
| 100 | Passport NFC + biometric (Self Protocol) |

The `SelfReputationProvider` contract exposes:

```solidity
// Single agent
uint8 score = reputationProvider.getReputationScore(agentId);
// Returns 0 if agent not found

// Full details (score + provider name + strength)
(uint8 score, string memory provider, uint8 strength) = reputationProvider.getReputation(agentId);

// Batch lookup (gas-efficient for multiple agents)
uint8[] memory scores = reputationProvider.getReputationBatch(agentIds);
```

### Freshness Validation

The `SelfValidationProvider` contract checks whether an agent's proof is still "fresh" based on blocks elapsed since registration:

```solidity
// Simple check (returns bool)
bool fresh = validationProvider.isValidAgent(agentId);

// Detailed check (returns validity + reason + registration block + threshold)
(bool valid, string memory reason, uint256 regBlock, uint256 threshold) = validationProvider.validateAgent(agentId);
```

Default threshold: ~1 year on Celo (~6,307,200 blocks at 5 seconds/block). Agents whose proof has expired should re-register.

### Sybil Detection

The registry provides built-in sybil detection via nullifier-based tracking:

```solidity
// Check if two agents share the same human
bool same = registry.sameHuman(agentIdA, agentIdB);

// Count how many agents a human has registered (by nullifier)
uint256 count = registry.getAgentCountForHuman(nullifier);

// Get the nullifier for an agent
bytes32 nullifier = registry.getAgentNullifier(agentId);
```

The SDK's `SelfAgentVerifier` defaults to `maxAgentsPerHuman: 1` (configurable via `.sybilLimit(n)`). When the limit is exceeded, the verifier rejects the request even if the agent is on-chain verified.

### Provider Verification (Security)

**IMPORTANT:** The SDK's `requireSelfProvider` option defaults to `true`. This means the verifier automatically checks that the agent's proof provider matches Self Protocol's known provider address. If you set `requireSelfProvider: false`, you must implement your own provider validation — otherwise any contract implementing `IHumanProofProvider` could register fake "verified" agents.

```typescript
const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireSelfProvider(true)  // default — validates provider address on-chain
  .build();
```

## Credentials

Fields extracted from ZK passport proof at registration:

| Field | Type | Values |
|---|---|---|
| nationality | string | ISO 3166-1 alpha-3 (e.g., "USA", "GBR", "DEU") |
| olderThan | uint8 | 0, 18, or 21 (threshold verified at registration) |
| ofacClean | bool | true/false (OFAC screening at registration) |

## Agent Cards (A2A Format)

Agents can store on-chain metadata in A2A (Agent-to-Agent) card format:

```json
{
  "a2aVersion": "0.1",
  "name": "My Agent",
  "selfProtocol": {
    "agentId": 5,
    "registry": "0x62E37d0f...",
    "chainId": 42220,
    "providerName": "self",
    "verificationStrength": 100,
    "credentials": { "nationality": "USA", "olderThan": 18, "ofacClean": true }
  }
}
```

## Contract Addresses

| Contract | Mainnet (42220) | Testnet (11142220) |
|---|---|---|
| Registry | `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095` | `0x29d941856134b1D053AfFF57fa560324510C79fa` |
| Provider | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` | `0x8e248DEB0F18B0A4b1c608F2d80dBCeB1B868F81` |
| Hub V2 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |
| DemoVerifier | `0x063c3bc21F0C4A6c51A84B1dA6de6510508E4F1e` | — |
| AgentGate | `0x2d710190e018fCf006E38eEB869b25C5F7d82424` | — |

RPC endpoints:
- Testnet: `https://forno.celo-sepolia.celo-testnet.org`
- Mainnet: `https://forno.celo.org`

## REST API Reference

Base URL: `https://self-agent-id.vercel.app` (override via `SELF_AGENT_API_BASE` env var)

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/agent/register` | Start registration |
| GET | `/api/agent/register/status?token=` | Poll registration status |
| GET | `/api/agent/register/qr?token=` | Get QR code image |
| POST | `/api/agent/register/callback?token=` | Receive Self app callback |
| POST | `/api/agent/deregister` | Start deregistration |
| GET | `/api/agent/deregister/status?token=` | Poll deregistration status |
| GET | `/api/agent/info/{chainId}/{agentId}` | Get agent info |
| GET | `/api/agent/agents/{chainId}/{address}` | List agents for human |
| GET | `/api/agent/verify/{chainId}/{agentId}` | Verification status |
| GET | `/api/cards/{chainId}/{agentId}` | Agent card (A2A format) |
| GET | `/api/reputation/{chainId}/{agentId}` | Reputation score |

## SDKs

| Language | Package | Install |
|---|---|---|
| TypeScript | `@selfxyz/agent-sdk` | `npm install @selfxyz/agent-sdk` |
| Python | `selfxyz-agent-sdk` | `pip install selfxyz-agent-sdk` |
| Rust | `self-agent-sdk` | `cargo add self-agent-sdk` |

All three SDKs have identical feature parity: `SelfAgent` (agent-side) and `SelfAgentVerifier` (service-side).

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `SELF_AGENT_PRIVATE_KEY` | — | Agent's hex private key (0x-prefixed) |
| `SELF_NETWORK` | `testnet` | `mainnet` or `testnet` |
| `SELF_AGENT_API_BASE` | `https://self-agent-id.vercel.app` | API base URL override |

Priority order: explicit constructor/function parameter > environment variable > hardcoded default.

Note: The old `SELF_API_URL` environment variable is removed. Use `SELF_AGENT_API_BASE`.

## Common Pitfalls

- **userDefinedData is UTF-8 string, NOT raw bytes** — The Self SDK passes it as a string. The registry converts via `bytes(userDefinedData)`.
- **Use `--evm-version cancun`** for Foundry — Hub V2 uses the PUSH0 opcode.
- **Always check proof provider address** when verifying agents — without this, fake providers can register agents.
- **Celo Sepolia chain ID: 11142220** — NOT 44787 (deprecated Alfajores).
- **Byte positioning:** Use `bytes32(bytes1(uint8(x)))` not `bytes32(uint256(x))`.
- **SELF_AGENT_API_BASE** is the canonical env var — `SELF_API_URL` is removed.
