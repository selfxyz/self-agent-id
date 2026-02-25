# Self Agent ID — Verification System Prompt

> Paste this into your agent's system prompt to enable it to verify other agents' identities.
> This is a lightweight prompt focused on verification only. For full protocol knowledge, use self-agent-id-full.md.

## What is Agent Verification?

Self Agent ID is an on-chain identity registry on Celo that proves AI agents are backed by real humans via ZK passport proofs. Verification means checking that an agent holds a valid soulbound NFT with proof-of-human credentials.

## Verifying Incoming Requests

Agents authenticate HTTP requests with 3 headers:

| Header | Content |
|---|---|
| `x-self-agent-address` | Agent's checksummed Ethereum address |
| `x-self-agent-signature` | ECDSA signature of request (0x-prefixed hex) |
| `x-self-agent-timestamp` | Unix timestamp in milliseconds |

### Using the SDK (Recommended)

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("mainnet")       // or "testnet"
  .requireAge(18)            // 0, 18, or 21
  .requireOFAC()             // require OFAC screening
  .sybilLimit(3)             // max agents per human
  .build();

// Express middleware
app.use("/api", verifier.auth());

// Or manual verification
const result = await verifier.verify({
  address: headers["x-self-agent-address"],
  signature: headers["x-self-agent-signature"],
  timestamp: headers["x-self-agent-timestamp"],
  method: "POST",
  path: "/api/data",
  body: requestBody,
});

if (result.valid) {
  console.log("Agent ID:", result.agentId);
  console.log("Credentials:", result.credentials);
  // { nationality: "USA", olderThan: 18, ofacClean: true }
}
```

Python: `pip install selfxyz-agent-sdk` — same API with snake_case (`require_age`, `sybil_limit`).
Rust: `cargo add self-agent-sdk` — same API with builder pattern.

### Using the REST API

```
GET https://self-agent-id.vercel.app/api/agent/verify/{chainId}/{agentId}

Response:
{
  "verified": true,
  "agentId": 5,
  "credentials": { "nationality": "USA", "olderThan": 18, "ofacClean": true },
  "verificationStrength": 100,
  "proofProvider": "0x0B43f87a..."
}
```

Override base URL via `SELF_AGENT_API_BASE` environment variable.

## CRITICAL: Provider Verification

Always check that the agent's proof provider matches Self Protocol's known address. Without this check, a fake provider could register agents that falsely appear verified.

| Network | Provider Address |
|---|---|
| Mainnet (42220) | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` |
| Testnet (11142220) | `0x8e248DEB0F18B0A4b1c608F2d80dBCeB1B868F81` |

The SDK's `SelfAgentVerifier` checks this by default (`requireSelfProvider` defaults to `true`). Do not disable this unless intentionally accepting agents from third-party providers.

## On-Chain Verification (Solidity)

```solidity
// Basic check
require(registry.isVerifiedAgent(agentKey), "Not verified");

// Provider check (CRITICAL)
require(registry.getProofProvider(agentId) == SELF_PROVIDER, "Wrong provider");

// Credentials
(string memory nationality, uint8 olderThan, bool ofacClean) = registry.getAgentCredentials(agentId);
```

## Reputation and Freshness

**Reputation (SelfReputationProvider):**
- `getReputationScore(agentId)` → 0-100 (Self Protocol agents = 100)
- 0 = unverified, 40 = video liveness, 60 = gov ID, 100 = passport NFC + biometric

**Freshness (SelfValidationProvider):**
- `isValidAgent(agentId)` → bool (valid AND within ~1 year threshold)
- `validateAgent(agentId)` → (valid, fresh, registeredAt, blockAge, proofProvider)

**Sybil Detection:**
- `sameHuman(agentIdA, agentIdB)` → bool
- `getAgentCountForHuman(nullifier)` → count

## Contract Addresses

| Contract | Mainnet (42220) | Testnet (11142220) |
|---|---|---|
| Registry | `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095` | `0x29d941856134b1D053AfFF57fa560324510C79fa` |
| Provider | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` | `0x8e248DEB0F18B0A4b1c608F2d80dBCeB1B868F81` |

## Credential Fields

| Field | Type | Values |
|---|---|---|
| nationality | string | ISO 3166-1 alpha-3 (e.g., "USA", "GBR") |
| olderThan | uint8 | 0, 18, or 21 |
| ofacClean | bool | true/false |
