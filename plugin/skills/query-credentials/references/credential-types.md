# Credential Types — Detailed Reference

This document covers the full credential system: on-chain storage format, credential field definitions, verification strength, the agent card schema, and reputation / validation contract queries.

---

## Credential Storage On-Chain

Credentials are stored per agent in the `SelfAgentRegistry` contract. The storage mechanism uses two layers:

### userDefinedData Encoding

At registration time, data flows through the `userDefinedData` field (passed via Self Hub V2). The field follows this layout:

```
Position [0]:  Action byte (ASCII character — 'R', 'K', 'W' or 'E' for registration)
Position [1]:  Config digit ('0' through '5', ASCII)
Position [2+]: Mode-specific payload (agent address + signature for K/W, Ed25519 key data for E)
```

The Self SDK passes `userDefinedData` as a UTF-8 string, NOT raw bytes. The registry converts it to bytes on-chain using `bytes(userDefinedData)`. The config digit at position [1] determines which credential checks are performed during ZK proof verification.

### Credential Extraction

During the `customVerificationHook()` callback from Hub V2, the registry extracts credential data from the ZK proof disclosure output. The extracted fields are:

- **nationality** — ISO 3166-1 alpha-3 country code from the passport MRZ (empty unless disclosed)
- **olderThan** — Age threshold verified (0, 18, or 21), determined by the verification config
- **ofac** — Three OFAC screening results (`bool[3]`)
- **issuingState, name, idNumber, dateOfBirth, gender, expiryDate** — only when the corresponding disclosure was requested

These are stored as a struct accessible via the `getAgentCredentials(agentId)` view function:

```solidity
struct AgentCredentials {
    string issuingState;
    string[] name;
    string idNumber;
    string nationality;
    string dateOfBirth;
    string gender;
    string expiryDate;
    uint256 olderThan;
    bool[3] ofac;
}

function getAgentCredentials(uint256 agentId)
    external view returns (AgentCredentials memory);
```

The REST API (`GET /api/agent/info/{chainId}/{agentId}`) returns `credentials: { nationality (or null), olderThan, ofac: [bool, bool, bool] }`; agent cards summarize OFAC as `ofacClean`.

---

## Nationality Codes

Nationality values use ISO 3166-1 alpha-3 codes, extracted from the passport's machine-readable zone (MRZ). The MRZ encodes the issuing state as a 3-letter country code.

### Common Codes

| Code | Country        |
| ---- | -------------- |
| USA  | United States  |
| GBR  | United Kingdom |
| DEU  | Germany        |
| FRA  | France         |
| JPN  | Japan          |
| AUS  | Australia      |
| CAN  | Canada         |
| BRA  | Brazil         |
| IND  | India          |
| KOR  | South Korea    |
| CHN  | China          |
| ITA  | Italy          |
| ESP  | Spain          |
| NLD  | Netherlands    |
| CHE  | Switzerland    |
| SGP  | Singapore      |
| NZL  | New Zealand    |
| MEX  | Mexico         |
| ARG  | Argentina      |
| ZAF  | South Africa   |

The full list includes all ISO 3166-1 alpha-3 codes. Refer to the ISO 3166 standard for the complete set.

### Important Notes

- The nationality reflects the **issuing country** of the passport, not necessarily the holder's citizenship or residence.
- Some countries issue passports with non-standard codes (e.g., `"D<<"` in German MRZ is normalized to `"DEU"`). The Self app handles normalization.
- Dual citizens will have the nationality of whichever passport they scan. Scanning a different passport in a future registration will produce a different nationality value (and a different nullifier).

---

## Age Verification

The `olderThan` field records the minimum age threshold that was verified at registration time. It does NOT record the actual age of the passport holder.

### Threshold Values

| Value | Meaning                           | Triggered By                       |
| ----- | --------------------------------- | ---------------------------------- |
| 0     | No age verification performed     | Verification config `'0'` or `'3'` |
| 18    | Verified 18 years of age or older | Verification config `'1'` or `'4'` |
| 21    | Verified 21 years of age or older | Verification config `'2'` or `'5'` |

### How It Works

The ZK proof circuit compares the passport's date of birth against the current date and the requested age threshold. If the holder meets the threshold, the proof succeeds and the circuit outputs the verified threshold. If the holder does not meet the threshold, the proof generation fails entirely — there is no "failed age check" state, only "not registered."

### Important Notes

- An agent with `olderThan: 21` is implicitly also 18+. The value records only the threshold that was checked.
- The actual date of birth is never disclosed or stored on-chain. Only the boolean "meets threshold" is proven.
- Age verification is a point-in-time check. An agent registered at 17 with config `'0'` (no age check) will still show `olderThan: 0` even after turning 18. Re-registration with a higher config would be required to update the credential.

---

## OFAC Screening

The `ofac` field (`ofacClean` in agent cards) indicates whether the passport holder passed OFAC (Office of Foreign Assets Control) sanctions screening at the time of registration.

### How It Works

When a verification config with OFAC enabled is selected (configs `'3'`, `'4'`, or `'5'`), the ZK proof circuit checks the passport holder's identity against the following OFAC lists:

- **SDN** (Specially Designated Nationals) — Individuals and entities sanctioned by the US Treasury
- **Non-SDN** — Additional restricted parties
- **Consolidated** — Combined screening list

If the holder appears on any list, proof generation fails. If the holder passes all checks, the `ofac` flags are set to `true` (`ofacClean: true`).

### Important Notes

- OFAC screening is a **point-in-time** check. It does not automatically update if the holder is later added to a sanctions list.
- Agents registered with configs `'0'`, `'1'`, or `'2'` (OFAC disabled) will have `ofac` all `false` (`ofacClean: false`) — this indicates "not checked," not "failed screening."
- To distinguish "not checked" from "failed," examine the verification config used at registration. An agent with config `'0'` and `ofacClean: false` was never screened. An agent with config `'4'` and `ofacClean: true` was screened and passed.
- OFAC lists are US-specific. Non-US services should evaluate whether OFAC screening is relevant to their compliance requirements.

---

## Verification Strength

The 0-100 score is reported by the proof provider (`IHumanProofProvider.verificationStrength()`), not stored by the registry. Only `SelfHumanProofProvider` is approved today and always reports **100** (passport / ID NFC chip + biometric). The SDK's `getProviderLabel` turns a score into the `proofType` / `strengthLabel` string:

| Score | Label      |
| ----- | ---------- |
| ≥100  | `passport` |
| ≥80   | `kyc`      |
| ≥60   | `govt_id`  |
| ≥40   | `liveness` |
| other | `unknown`  |

---

## Agent Card Schema (A2A)

Agent cards follow the A2A (Agent-to-Agent) format, providing a standardized way for agents to advertise their identity, capabilities, and trust posture.

### Type Definitions (SDK, abridged)

`A2AAgentCard` is an alias of `ERC8004AgentDocument`: an ERC-8004 registration document that is also a valid A2A (v0.3.0) card when the A2A fields are present.

```typescript
interface ERC8004AgentDocument {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
  name: string;
  description: string;
  image: string;
  services: { name: string; endpoint: string; version?: string }[];
  // optional ERC-8004: active, registrations, supportedTrust
  // optional A2A: version, url, provider, capabilities, securitySchemes, security,
  //   defaultInputModes, defaultOutputModes, supportedInterfaces, iconUrl, ...
  selfProtocol?: SelfProtocolExtension;
  skills?: AgentSkill[];
}

interface SelfProtocolExtension {
  agentId: number; // On-chain token ID
  registry: string; // Registry contract address
  chainId: number; // Chain ID (42220 for mainnet, 11142220 for testnet)
  proofProvider: string; // Proof provider contract address
  providerName: string; // Provider identifier (e.g., "self")
  verificationStrength: number; // Score 0-100
  trustModel: TrustModel;
  credentials?: CardCredentials;
}

interface TrustModel {
  proofType: string; // "passport", "kyc", "govt_id", "liveness"
  sybilResistant: boolean;
  ofacScreened: boolean;
  minimumAgeVerified: number; // 0, 18, or 21
}

interface CardCredentials {
  nationality?: string; // ISO 3166-1 alpha-3, e.g. "USA"
  issuingState?: string;
  olderThan?: number; // 0, 18, or 21
  ofacClean?: boolean; // OFAC screening result
  hasName?: boolean;
  hasDateOfBirth?: boolean;
  hasGender?: boolean;
  documentExpiry?: string;
}

interface AgentSkill {
  id: string; // Unique identifier for the skill
  name: string; // Human-readable skill name
  description?: string;
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}
```

### Building and Managing Cards

Using the SDK:

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

// setAgentCard throws unless the agent key owns its NFT (true only for
// wallet-free agents). For linked / privy / smartwallet agents the human's
// wallet is the owner: build the card with buildAgentCard() and call
// updateAgentMetadata(agentId, json) from that wallet.
const agent = new SelfAgent({ privateKey: "0x...", network: "mainnet" });

// Builds the card (selfProtocol block read from chain) and writes it on-chain
const txHash = await agent.setAgentCard({
  name: "My Trading Agent",
  description: "Executes DeFi trades with proof-of-human",
  url: "https://myagent.example.com",
  skills: [
    { id: "trade", name: "Trade", description: "Execute token swaps" },
    { id: "portfolio", name: "Portfolio", description: "View portfolio state" },
  ],
});

// Read the card back
const stored = await agent.getAgentCard();
```

### Storage

Agent cards are stored as JSON strings in the registry's metadata mapping. `updateAgentMetadata(agentId, string)` takes the JSON-encoded card. Only the NFT owner (`ownerOf(agentId)`) can update the card; anyone else reverts with `NotNftOwner`.

---

## Reputation and Validation Contracts

| Contract                 | Deployed | Read functions                                                                                                                                               |
| ------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SelfReputationRegistry` | Yes      | `getSummary(agentId, address[] clients, tag1, tag2) → (count, int256 summaryValue, decimals)`, `readFeedback(agentId, client, index)`, `getClients(agentId)` |
| `SelfValidationRegistry` | Yes      | `getLatestFreshness(agentId) → (bool fresh, uint256 lastUpdated)`, `getSummary(agentId, address[] validators, tag) → (count, avgResponse)`                   |
| `SelfReputationSignal`   | No       | `getReputationScore(agentId) → uint8`, `getReputation(agentId) → (score, providerName, hasProof, registeredAtBlock)`, `getReputationBatch(ids)`              |
| `SelfFreshnessChecker`   | No       | `isValidAgent(agentId) → bool`, `validateAgent(agentId) → (valid, fresh, registeredAt, blockAge, proofProvider)`, `validateBatch(ids)`                       |

- `SelfReputationSignal` / `SelfFreshnessChecker` are stateless wrappers in `contracts/src` with no canonical deployment; deploy your own or read the registry directly.
- `SelfFreshnessChecker` "fresh" = registered within `freshnessThreshold` blocks (default 6,307,200 ≈ **73 days** at Celo's ~1 s blocks; owner-settable). This is separate from proof expiry — use `isProofFresh(agentId)` for that.
- Addresses: [contracts.md](../../self-agent-id-overview/references/contracts.md).

---

## Querying From Solidity

Credential checks in your own contract (`MyAgentGatedService` is illustrative, not a repo contract):

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISelfAgentRegistry {
    struct AgentCredentials {
        string issuingState;
        string[] name;
        string idNumber;
        string nationality;
        string dateOfBirth;
        string gender;
        string expiryDate;
        uint256 olderThan;
        bool[3] ofac;
    }
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function isProofFresh(uint256 agentId) external view returns (bool);
    function getProofProvider(uint256 agentId) external view returns (address);
    function getAgentCredentials(uint256 agentId) external view returns (AgentCredentials memory);
}

contract MyAgentGatedService {
    ISelfAgentRegistry public immutable registry;
    address public immutable selfProvider;

    constructor(address _registry, address _selfProvider) {
        registry = ISelfAgentRegistry(_registry);
        selfProvider = _selfProvider;
    }

    /// @notice Fresh Self proof, 18+, OFAC clean
    function meetsRequirements(uint256 agentId) external view returns (bool) {
        if (!registry.hasHumanProof(agentId) || !registry.isProofFresh(agentId)) return false;
        if (registry.getProofProvider(agentId) != selfProvider) return false;

        ISelfAgentRegistry.AgentCredentials memory creds = registry.getAgentCredentials(agentId);
        bool ofacClean = creds.ofac[0] && creds.ofac[1] && creds.ofac[2];
        return creds.olderThan >= 18 && ofacClean;
    }
}
```

---

## Querying From TypeScript (SDK)

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey: "0x...", network: "mainnet" });

// On-chain identity
const info = await agent.getInfo();
console.log("Verified:", info.isVerified); // hasHumanProof && isProofFresh
console.log("Agent ID:", info.agentId);
console.log("Proof expires:", info.proofExpiresAt); // unix seconds

// Credentials (undefined if the agent is not registered)
const creds = await agent.getCredentials();
console.log("Nationality:", creds?.nationality);
console.log("Older than:", creds?.olderThan);
console.log("OFAC:", creds?.ofac);

// Any agent by ID via the REST API (404 → RegistrationError with status 404)
const other = await SelfAgent.getAgentInfo(5, { network: "mainnet" });
console.log(other.isVerified, other.proofProvider, other.registeredAtBlock);

// Verification strength
const strength = await agent.getVerificationStrength();
console.log("Score:", strength); // 0-100

// Agent card
const card = await agent.getAgentCard();
if (card) {
  console.log("Name:", card.name);
  console.log("Skills:", card.skills?.map((s) => s.name).join(", "));
}
```

---

## REST API Reference

All query operations are available via REST endpoints hosted at `https://agent-api.self.xyz` (override with `SELF_AGENT_API_BASE` environment variable).

| Endpoint                                | Method | Description                            | Auth Required |
| --------------------------------------- | ------ | -------------------------------------- | ------------- |
| `/api/agent/info/{chainId}/{agentId}`   | GET    | Full agent info by ID                  | No            |
| `/api/agent/agents/{chainId}/{address}` | GET    | List agents for a human address        | No            |
| `/api/agent/verify/{chainId}/{agentId}` | GET    | Verification status and proof provider | No            |
| `/api/cards/{chainId}/{agentId}`        | GET    | Agent card (A2A metadata)              | No            |
| `/api/reputation/{chainId}/{agentId}`   | GET    | Reputation score and provider details  | No            |

All endpoints are public and do not require authentication. Rate limiting may apply. Per-agent routes return `404 { "error": "Agent not found" }` for never-minted or burned agents, `400` for an unsupported chain ID, and `502 { "error": "RPC error" }` when the chain is unreachable.

### Chain IDs

- Mainnet: `42220`
- Testnet: `11142220`

### Example

```bash
# Get agent info for agent ID 5 on mainnet
curl https://agent-api.self.xyz/api/agent/info/42220/5

# List agents for a human on testnet
curl https://agent-api.self.xyz/api/agent/agents/11142220/0x56738c05507379C38Bbfa8f75064fd344716245F

# Get agent card
curl https://agent-api.self.xyz/api/cards/42220/5
```
