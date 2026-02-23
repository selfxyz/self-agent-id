# Credential Types — Detailed Reference

This document covers the full credential system: on-chain storage format, credential field definitions, verification strength tiers, A2A agent card schema, and query patterns for reputation and validation providers.

---

## Credential Storage On-Chain

Credentials are stored per agent in the `SelfAgentRegistry` contract. The storage mechanism uses two layers:

### userDefinedData Encoding

At registration time, data flows through the `userDefinedData` field (passed via Self Hub V2). The field follows this layout:

```
Position [0]:  Action byte (ASCII character — 'R', 'K', or 'W')
Position [1]:  Config digit ('0' through '5', ASCII)
Position [2+]: Mode-specific payload (agent address for advanced/wallet-free modes)
```

The Self SDK passes `userDefinedData` as a UTF-8 string, NOT raw bytes. The registry converts it to bytes on-chain using `bytes(userDefinedData)`. The config digit at position [1] determines which credential checks are performed during ZK proof verification.

### Credential Extraction

During the `customVerificationHook()` callback from Hub V2, the registry extracts credential data from the ZK proof disclosure output. The extracted fields are:

- **nationality** — ISO 3166-1 alpha-3 country code from the passport MRZ
- **olderThan** — Age threshold verified (0, 18, or 21), determined by the verification config
- **ofacClean** — Whether the agent passed OFAC sanctions screening

These are stored as structured data accessible via the `getAgentCredentials(agentId)` view function:

```solidity
function getAgentCredentials(uint256 agentId)
    external view
    returns (string memory nationality, uint8 olderThan, bool ofacClean);
```

### Bytes32 Metadata

Additional metadata is packed into `bytes32` values stored in the registry's metadata mapping. The packing format reserves:

- Byte 0: Action code (`'R'` = 0x52 for verified-wallet, `'K'` = 0x4B for agent-identity, `'W'` = 0x57 for wallet-free)
- Byte 1: Config digit (`'0'` = 0x30 through `'5'` = 0x35)
- Remaining bytes: Mode-specific data (e.g., agent address in advanced mode)

This metadata is primarily used internally by the registry contract to record how the agent was registered and which verification config was applied.

---

## Nationality Codes

Nationality values use ISO 3166-1 alpha-3 codes, extracted from the passport's machine-readable zone (MRZ). The MRZ encodes the issuing state as a 3-letter country code.

### Common Codes

| Code | Country |
|---|---|
| USA | United States |
| GBR | United Kingdom |
| DEU | Germany |
| FRA | France |
| JPN | Japan |
| AUS | Australia |
| CAN | Canada |
| BRA | Brazil |
| IND | India |
| KOR | South Korea |
| CHN | China |
| ITA | Italy |
| ESP | Spain |
| NLD | Netherlands |
| CHE | Switzerland |
| SGP | Singapore |
| NZL | New Zealand |
| MEX | Mexico |
| ARG | Argentina |
| ZAF | South Africa |

The full list includes all ISO 3166-1 alpha-3 codes. Refer to the ISO 3166 standard for the complete set.

### Important Notes

- The nationality reflects the **issuing country** of the passport, not necessarily the holder's citizenship or residence.
- Some countries issue passports with non-standard codes (e.g., `"D<<"` in German MRZ is normalized to `"DEU"`). The Self app handles normalization.
- Dual citizens will have the nationality of whichever passport they scan. Scanning a different passport in a future registration will produce a different nationality value (and a different nullifier).

---

## Age Verification

The `olderThan` field records the minimum age threshold that was verified at registration time. It does NOT record the actual age of the passport holder.

### Threshold Values

| Value | Meaning | Triggered By |
|---|---|---|
| 0 | No age verification performed | Verification config `'0'` or `'1'` |
| 18 | Verified 18 years of age or older | Verification config `'2'` or `'3'` |
| 21 | Verified 21 years of age or older | Verification config `'4'` or `'5'` |

### How It Works

The ZK proof circuit compares the passport's date of birth against the current date and the requested age threshold. If the holder meets the threshold, the proof succeeds and the circuit outputs the verified threshold. If the holder does not meet the threshold, the proof generation fails entirely — there is no "failed age check" state, only "not registered."

### Important Notes

- An agent with `olderThan: 21` is implicitly also 18+. The value records only the threshold that was checked.
- The actual date of birth is never disclosed or stored on-chain. Only the boolean "meets threshold" is proven.
- Age verification is a point-in-time check. An agent registered at 17 with config `'0'` (no age check) will still show `olderThan: 0` even after turning 18. Re-registration with a higher config would be required to update the credential.

---

## OFAC Screening

The `ofacClean` field indicates whether the passport holder passed OFAC (Office of Foreign Assets Control) sanctions screening at the time of registration.

### How It Works

When a verification config with OFAC enabled is selected (configs `'1'`, `'3'`, or `'5'`), the ZK proof circuit checks the passport holder's identity against the following OFAC lists:

- **SDN** (Specially Designated Nationals) — Individuals and entities sanctioned by the US Treasury
- **Non-SDN** — Additional restricted parties
- **Consolidated** — Combined screening list

If the holder appears on any list, proof generation fails. If the holder passes all checks, `ofacClean` is set to `true`.

### Important Notes

- OFAC screening is a **point-in-time** check. It does not automatically update if the holder is later added to a sanctions list.
- Agents registered with configs `'0'`, `'2'`, or `'4'` (OFAC disabled) will have `ofacClean: false` by default — this indicates "not checked," not "failed screening."
- To distinguish "not checked" from "failed," examine the verification config used at registration. An agent with config `'0'` and `ofacClean: false` was never screened. An agent with config `'1'` and `ofacClean: true` was screened and passed.
- OFAC lists are US-specific. Non-US services should evaluate whether OFAC screening is relevant to their compliance requirements.

---

## Verification Strength Tiers

The verification strength score is reported by the proof provider and reflects the rigor of the identity verification method. Self Agent ID stores this score via the `SelfReputationProvider` contract.

| Score | Method | Provider Example | Description |
|---|---|---|---|
| 0 | None | — | No proof submitted. Agent is registered but unverified, or the proof provider reports zero strength. |
| 20 | Email/phone | — | Basic identity check via email or phone number verification. Minimal assurance of humanness. |
| 40 | Video liveness | Worldcoin orb | Biometric verification without a government document. Proves the subject is a live human but does not verify legal identity. |
| 60 | Government ID | Aadhaar, drivers license | Government-issued document scan with optional liveness check. No NFC chip verification. Susceptible to high-quality document forgery. |
| 80 | Chip-enabled ID | ePassport without biometric | NFC chip read from a chip-enabled passport or ID card. Verifies the document is genuine (chip signature validated) but does not match the holder's face to the document photo. |
| 100 | NFC + biometric | Self Protocol | Passport NFC chip read combined with a live face match against the passport photo stored in the chip. This is the strongest available verification — it proves the person holding the phone is the person in the passport. |

### Score Interpretation

- Scores are **not cumulative**. A score of 60 does not mean the agent also passed checks at levels 20 and 40.
- The score is set by the **proof provider**, not the registry. Different providers report different scores.
- Self Protocol always reports 100 because it uses passport NFC + biometric matching.
- Third-party providers can register any score between 0 and 100 via the `IHumanProofProvider.verificationStrength()` function.

---

## Agent Card Schema (A2A)

Agent cards follow the A2A (Agent-to-Agent) format, providing a standardized way for agents to advertise their identity, capabilities, and trust posture.

### Full Type Definitions

```typescript
interface A2AAgentCard {
  a2aVersion: string;        // Protocol version, currently "0.1"
  name: string;              // Human-readable agent name
  description?: string;      // Optional description of the agent
  url?: string;              // Optional URL for the agent's API or web interface
  selfProtocol: SelfProtocolExtension;
  skills?: AgentSkill[];     // Optional list of agent capabilities
}

interface SelfProtocolExtension {
  agentId: number;           // On-chain token ID
  registry: string;          // Registry contract address
  chainId: number;           // Chain ID (42220 for mainnet, 11142220 for testnet)
  proofProvider: string;     // Proof provider contract address
  providerName: string;      // Provider identifier (e.g., "self")
  verificationStrength: number; // Score 0-100
  trustModel: TrustModel;
  credentials: CardCredentials;
}

interface TrustModel {
  proofType: string;         // "zk-passport" for Self Protocol
  proofStandard: string;     // "groth16" — the ZK proving system used
  proofProvider: string;     // "self-protocol" — the provider identity
  onChainVerifiable: boolean; // true — proof is verifiable on-chain by any party
}

interface CardCredentials {
  nationality: string;       // ISO 3166-1 alpha-3
  olderThan: number;         // 0, 18, or 21
  ofacClean: boolean;        // OFAC screening result
}

interface AgentSkill {
  id: string;                // Unique identifier for the skill
  name: string;              // Human-readable skill name
  description?: string;      // Optional description
}
```

### Building and Managing Cards

Using the SDK:

```typescript
import { SelfAgent, buildAgentCard } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey: "0x...", network: "mainnet" });

// Build a card from current on-chain state
const card = buildAgentCard({
  name: "My Trading Agent",
  description: "Executes DeFi trades with proof-of-human",
  url: "https://myagent.example.com",
  skills: [
    { id: "trade", name: "Trade", description: "Execute token swaps" },
    { id: "portfolio", name: "Portfolio", description: "View portfolio state" },
  ],
});

// Write the card on-chain
await agent.setAgentCard(card);

// Read the card back
const stored = await agent.getAgentCard();
```

### Storage

Agent cards are stored as JSON strings in the registry's metadata mapping. The `updateAgentMetadata()` function accepts a `bytes` parameter containing the JSON-encoded card. Only the agent owner (the address that owns the soulbound NFT) can update the card.

---

## Reputation Provider Queries

The `SelfReputationProvider` contract provides reputation scores derived from the proof provider's verification strength.

### Single Agent Query

```solidity
uint8 score = reputationProvider.getReputationScore(agentId);
```

Returns a uint8 score (0-100). Returns 0 for unregistered or unverified agents.

### Detailed Query

```solidity
(uint8 score, string memory providerName, bool hasProof, uint256 registeredAtBlock)
    = reputationProvider.getReputation(agentId);
```

Returns the full reputation breakdown:
- `score` — Verification strength (0-100)
- `providerName` — Provider identifier (e.g., `"self"`)
- `hasProof` — Whether the agent has a verified human proof
- `registeredAtBlock` — Block number at which the agent was registered

### Batch Query

```solidity
uint8[] memory scores = reputationProvider.getReputationBatch(agentIds);
```

Accepts an array of agent IDs and returns an array of scores. Efficient for querying multiple agents in a single call. Unregistered agents return 0.

---

## Validation Provider Queries

The `SelfValidationProvider` contract performs freshness checks — determining whether an agent's registration is still considered valid based on the number of blocks elapsed since registration.

### Quick Validation

```solidity
bool valid = validationProvider.isValidAgent(agentId);
```

Returns `true` if the agent is registered, verified, and within the freshness window. Returns `false` otherwise.

### Detailed Validation

```solidity
(bool valid, bool fresh, uint256 registeredAt, uint256 blockAge, address proofProvider)
    = validationProvider.validateAgent(agentId);
```

Returns the full validation breakdown:
- `valid` — Whether the agent is registered and has a proof
- `fresh` — Whether the registration is within the freshness threshold
- `registeredAt` — Block number of registration
- `blockAge` — Number of blocks since registration
- `proofProvider` — Address of the proof provider

### Batch Validation

```solidity
bool[] memory results = validationProvider.validateBatch(agentIds);
```

Accepts an array of agent IDs and returns an array of booleans. Each entry is `true` if the agent is both valid and fresh.

### Freshness Threshold

The default freshness threshold is approximately 6,307,200 blocks (~1 year on Celo at 5 seconds per block). The contract owner can adjust this threshold via `setFreshnessThreshold(uint256 newThreshold)`.

An agent that exceeds the freshness threshold is still registered but is no longer considered "fresh." Services can decide whether to accept stale registrations or require re-verification.

---

## Querying From Solidity

Integrate credential, reputation, and validation queries into smart contracts:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ISelfAgentRegistry} from "./interfaces/ISelfAgentRegistry.sol";
import {ISelfReputationProvider} from "./interfaces/ISelfReputationProvider.sol";
import {ISelfValidationProvider} from "./interfaces/ISelfValidationProvider.sol";

contract AgentGate {
    ISelfAgentRegistry public registry;
    ISelfReputationProvider public reputationProvider;
    ISelfValidationProvider public validationProvider;

    /// @notice Check if an agent meets minimum requirements
    function meetsRequirements(uint256 agentId) external view returns (bool) {
        // Get credentials
        (string memory nationality, uint8 olderThan, bool ofacClean)
            = registry.getAgentCredentials(agentId);

        // Require age 18+ and OFAC clean
        if (olderThan < 18 || !ofacClean) return false;

        // Check reputation score (minimum 60)
        uint8 score = reputationProvider.getReputationScore(agentId);
        if (score < 60) return false;

        // Validate freshness
        (bool valid, bool fresh, , , ) = validationProvider.validateAgent(agentId);
        if (!valid || !fresh) return false;

        return true;
    }
}
```

### Key Patterns

- Always check `valid` before checking `fresh` — an invalid agent is never fresh.
- Use `getAgentCredentials()` for reading stored credential claims.
- Use `getReputationScore()` for quick numeric comparisons.
- Use `validateAgent()` when freshness matters (e.g., time-sensitive operations).
- Use batch functions when querying multiple agents to save gas on external calls.

---

## Querying From TypeScript (SDK)

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey: "0x...", network: "mainnet" });

// Full info
const info = await agent.getInfo();
console.log("Registered:", info.registered);
console.log("Agent ID:", info.agentId);
console.log("Owner:", info.owner);
console.log("Proof provider:", info.proofProvider);

// Credentials
const creds = await agent.getCredentials();
console.log("Nationality:", creds.nationality);
console.log("Older than:", creds.olderThan);
console.log("OFAC clean:", creds.ofacClean);

// Verification strength
const strength = await agent.getVerificationStrength();
console.log("Score:", strength); // 0-100

// Agent card
const card = await agent.getAgentCard();
if (card) {
  console.log("Name:", card.name);
  console.log("Skills:", card.skills?.map(s => s.name).join(", "));
}
```

---

## REST API Reference

All query operations are available via REST endpoints hosted at `https://self-agent-id.vercel.app` (override with `SELF_AGENT_API_BASE` environment variable).

| Endpoint | Method | Description | Auth Required |
|---|---|---|---|
| `/api/agent/info/{chainId}/{agentId}` | GET | Full agent info by ID | No |
| `/api/agent/agents/{chainId}/{address}` | GET | List agent IDs for a human address | No |
| `/api/agent/verify/{chainId}/{agentId}` | GET | Verification status and proof provider | No |
| `/api/cards/{chainId}/{agentId}` | GET | Agent card (A2A metadata) | No |
| `/api/reputation/{chainId}/{agentId}` | GET | Reputation score and provider details | No |

All endpoints are public and do not require authentication. Rate limiting may apply.

### Chain IDs

- Mainnet: `42220`
- Testnet: `11142220`

### Example

```bash
# Get agent info for agent ID 5 on mainnet
curl https://self-agent-id.vercel.app/api/agent/info/42220/5

# List agents for a human on testnet
curl https://self-agent-id.vercel.app/api/agent/agents/11142220/0x83fa4380903fecb801F4e123835664973001ff00

# Get agent card
curl https://self-agent-id.vercel.app/api/cards/42220/5
```
