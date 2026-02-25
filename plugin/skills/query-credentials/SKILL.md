---
name: query-credentials
description: >
  Read-only queries for Self Agent ID data — look up agents by address or ID,
  list agents for a human, check own identity, retrieve ZK-attested credentials,
  reputation scores, freshness status, and A2A agent cards. Use when the user
  asks to "lookup agent", "agent credentials", "check agent status", "find agents",
  "agent discovery", "agent card", "agent info", or "list agents for human".
  Do NOT use for verification middleware or adding verification to APIs — use
  verify-agents for that.
license: MIT
metadata:
  author: Self Protocol
  version: 1.0.0
  mcp-server: self-agent-id
---

# Query Agent Credentials

## Overview

All operations in this skill are read-only. No state changes occur on-chain. The MCP discovery tools (`self_lookup_agent`, `self_list_agents_for_human`) do not require a private key, making them accessible to any agent or service. The `self_get_identity` tool requires `SELF_AGENT_PRIVATE_KEY` to be configured because it queries the caller's own identity.

## Look Up an Agent by ID or Address

Use the `self_lookup_agent` MCP tool to retrieve full agent information from the on-chain registry.

**Input:**

- `agent_id` (number) — The agent's on-chain token ID. Provide either this OR `agent_address`.
- `agent_address` (hex string) — The agent's Ethereum address. Provide either this OR `agent_id`.
- `network` (optional, string) — `"testnet"` or `"mainnet"`. Defaults to `"mainnet"`.

**Output:**

```
agent_id         — On-chain token ID (uint256)
agent_address    — Ethereum address derived from the agent key
owner            — Address that owns the soulbound NFT
registered       — true
registered_block — Block number at which registration occurred
proof_provider   — Address of the proof provider that verified the agent
is_verified      — Whether the agent has a valid human proof
credentials      — { nationality, olderThan, ofacClean }
nullifier        — Cryptographic nullifier (for sybil checks)
```

This tool does NOT require a private key. Any caller can look up any agent.

## List Agents for a Human

Use the `self_list_agents_for_human` MCP tool to find all agent IDs registered by a specific human address.

**Input:**

- `human_address` (hex string) — The human's Ethereum wallet address.
- `network` (optional, string) — `"testnet"` or `"mainnet"`. Defaults to `"mainnet"`.

**Output:**

```
agent_ids — Array of uint256 agent IDs belonging to that human
```

This tool does NOT require a private key. It queries the registry's NFT ownership data (the human address is the NFT owner for verified-wallet and agent-identity modes).

## Check Own Identity

Use the `self_get_identity` MCP tool to retrieve the calling agent's own on-chain identity.

**Input:**

- `network` (optional, string) — `"testnet"` or `"mainnet"`. Defaults to `"mainnet"`.

**Output:**

```
registered              — bool, whether the agent is registered
address                 — The agent's Ethereum address
agentId                 — On-chain token ID
agentKey                — bytes32 key used in registry mappings
isVerified              — Whether the agent has a valid human proof
nullifier               — Cryptographic nullifier
agentCount              — Number of agents registered by the same human
verificationStrength    — Score from the proof provider (0-100)
credentials_summary     — { nationality, olderThan, ofacClean }
network                 — Which network was queried
```

**REQUIRES** `SELF_AGENT_PRIVATE_KEY` to be configured as an environment variable. The tool derives the agent address from the private key and queries the registry for that address. If the private key is not set, the tool returns a graceful error message explaining the requirement.

## MCP Resources

Two resources are available for passive context:

### `self://networks`

Returns contract addresses, chain IDs, RPC URLs, and block explorer URLs for both mainnet and testnet. This resource is always available and does not require authentication.

Example content:

```json
{
  "mainnet": {
    "chainId": 42220,
    "rpc": "https://forno.celo.org",
    "registry": "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
    "provider": "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
    "explorer": "https://celoscan.io"
  },
  "testnet": {
    "chainId": 11142220,
    "rpc": "https://forno.celo-sepolia.celo-testnet.org",
    "registry": "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
    "provider": "0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c",
    "explorer": "https://celo-sepolia.blockscout.com"
  }
}
```

### `self://identity`

Returns the calling agent's on-chain identity. Requires `SELF_AGENT_PRIVATE_KEY` to be configured. If not configured, returns a message explaining that the private key is needed and how to set it up.

## Credential Fields

The following credential fields are stored on-chain at registration time, extracted from the ZK proof:

| Field       | Type   | Values                                         | Source                                                                        |
| ----------- | ------ | ---------------------------------------------- | ----------------------------------------------------------------------------- |
| nationality | string | ISO 3166-1 alpha-3 (e.g., "USA", "GBR", "DEU") | ZK passport proof — extracted from the passport's machine-readable zone (MRZ) |
| olderThan   | uint8  | 0, 18, or 21                                   | Determined by the verification config selected at registration time           |
| ofacClean   | bool   | true/false                                     | OFAC sanctions screening performed at registration time                       |

All credential values are cryptographically verified through the ZK proof. They are NOT self-reported. The nationality comes from the passport issuing country, the age threshold is verified against the passport date of birth, and the OFAC status is checked against US sanctions lists.

## Verification Strength

The verification strength score reflects the rigor of the identity verification method used by the proof provider. The score ranges from 0 to 100:

| Score | Method          | Description                                                         |
| ----- | --------------- | ------------------------------------------------------------------- |
| 0     | None            | No proof submitted or unverified agent                              |
| 20    | Email/phone     | Basic identity check, minimal assurance                             |
| 40    | Video liveness  | Biometric verification without document (e.g., Worldcoin orb)       |
| 60    | Government ID   | Document scan without NFC chip verification (e.g., drivers license) |
| 80    | Chip-enabled ID | NFC chip read without biometric match                               |
| 100   | NFC + biometric | Passport NFC chip read + face match (Self Protocol)                 |

Query the verification strength with:

- MCP: `self_lookup_agent` returns `verificationStrength` in the response
- SDK: `agent.getVerificationStrength()` returns a `uint8`
- Contract: `reputationProvider.getReputationScore(agentId)` returns `uint8`

## Agent Cards (A2A Format)

Agent cards are JSON metadata stored on-chain via the `updateAgentMetadata()` function on the registry contract. The A2A (Agent-to-Agent) card format provides a standardized way for agents to advertise their identity, capabilities, and trust posture to other agents and services.

Example agent card:

```json
{
  "a2aVersion": "0.1",
  "name": "My Agent",
  "description": "An AI assistant",
  "url": "https://myagent.example.com",
  "selfProtocol": {
    "agentId": 5,
    "registry": "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
    "chainId": 42220,
    "proofProvider": "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
    "providerName": "self",
    "verificationStrength": 100,
    "trustModel": {
      "proofType": "zk-passport",
      "proofStandard": "groth16",
      "proofProvider": "self-protocol",
      "onChainVerifiable": true
    },
    "credentials": {
      "nationality": "USA",
      "olderThan": 18,
      "ofacClean": true
    }
  },
  "skills": [
    { "id": "chat", "name": "Chat", "description": "General conversation" }
  ]
}
```

Interact with agent cards using:

- SDK: `buildAgentCard()` helper to construct a card, `agent.getAgentCard()` to read, `agent.setAgentCard()` to write
- MCP: `self_lookup_agent` includes the card in its response if one is set
- REST API: `GET /api/cards/{chainId}/{agentId}`

## Reputation and Validation Queries

Beyond basic credential lookups, two additional provider contracts support reputation scoring and freshness validation.

### Reputation Score

The `SelfReputationProvider` contract returns a score derived from the proof provider's verification strength. Query it via:

- SDK: `agent.getVerificationStrength()` returns `uint8` (0-100)
- Solidity: `reputationProvider.getReputationScore(agentId)` returns `uint8`
- Solidity (detailed): `reputationProvider.getReputation(agentId)` returns `(score, providerName, hasProof, registeredAtBlock)`
- Solidity (batch): `reputationProvider.getReputationBatch([id1, id2, id3])` returns `uint8[]`

Self Protocol agents always score 100. A score of 0 indicates an unregistered or unverified agent.

### Freshness Validation

The `SelfValidationProvider` contract checks whether an agent's registration is still within the freshness window (default: ~6,307,200 blocks, approximately 1 year on Celo).

- Quick check: `validationProvider.isValidAgent(agentId)` returns `bool`
- Detailed: `validationProvider.validateAgent(agentId)` returns `(valid, fresh, registeredAt, blockAge, proofProvider)`
- Batch: `validationProvider.validateBatch([id1, id2])` returns `bool[]`

An agent that exceeds the freshness threshold is still registered but may be considered stale. Services decide their own freshness policy — some may accept stale registrations, others may require re-verification.

## Using the SDK

Query agent data programmatically with the `@selfxyz/agent-sdk` package:

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

// Initialize with an existing private key
const agent = new SelfAgent({ privateKey: "0x...", network: "mainnet" });

// Get full agent info (registration status, owner, proof provider, etc.)
const info = await agent.getInfo();

// Get ZK-attested credentials (nationality, olderThan, ofacClean)
const creds = await agent.getCredentials();

// Get verification strength score (0-100)
const strength = await agent.getVerificationStrength();

// Get the agent's A2A card (if set)
const card = await agent.getAgentCard();
```

Python and Rust SDKs expose the same API surface:

- Python: `from selfxyz_agent_sdk import SelfAgent`
- Rust: `use self_agent_sdk::SelfAgent;`

## REST API Equivalents

All query operations are also available via REST endpoints:

| Endpoint                                    | Description                            |
| ------------------------------------------- | -------------------------------------- |
| `GET /api/agent/info/{chainId}/{agentId}`   | Full agent info by ID                  |
| `GET /api/agent/agents/{chainId}/{address}` | List agent IDs for a human address     |
| `GET /api/agent/verify/{chainId}/{agentId}` | Verification status and proof provider |
| `GET /api/cards/{chainId}/{agentId}`        | Agent card (A2A metadata)              |
| `GET /api/reputation/{chainId}/{agentId}`   | Reputation score and provider details  |

Base URL: `https://self-agent-id.vercel.app`

Override the base URL by setting the `SELF_AGENT_API_BASE` environment variable. This is useful for local development or self-hosted deployments.

### Chain IDs

Use the following chain IDs in API paths:

- Celo Mainnet: `42220`
- Celo Sepolia (testnet): `11142220`

### Example Requests

```bash
# Look up agent ID 5 on mainnet
curl https://self-agent-id.vercel.app/api/agent/info/42220/5

# Get the agent card for agent ID 5
curl https://self-agent-id.vercel.app/api/cards/42220/5

# List all agents for a human address on testnet
curl https://self-agent-id.vercel.app/api/agent/agents/11142220/0x83fa...
```

## Common Query Patterns

### Verify an Agent Before Trusting It

When receiving a request from an unknown agent, follow this sequence:

1. Call `self_lookup_agent` with the agent's address to get the agent ID and verification status.
2. Check `is_verified` is `true` — this confirms the agent has a valid human proof.
3. Check `credentials.ofacClean` if sanctions compliance is required.
4. Check `credentials.olderThan` if age-gating is required.
5. Optionally check the verification strength score to enforce a minimum trust level.

### Discover All Agents for a Human

To find all agents operated by a specific human:

1. Call `self_list_agents_for_human` with the human's wallet address.
2. For each returned agent ID, call `self_lookup_agent` to get full details.
3. Compare nullifiers — all agents from the same human share the same nullifier value.

### Check Own Status After Registration

After registering, confirm the identity is correctly recorded:

1. Call `self_get_identity` (requires `SELF_AGENT_PRIVATE_KEY`).
2. Verify `registered` is `true` and `agentId` is non-zero.
3. Verify `credentials_summary` matches the selected verification config.
4. Verify the proof provider address matches Self Protocol's known provider address.

## Troubleshooting

| Symptom                                                  | Cause                                                               | Resolution                                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self_get_identity` returns "Private key not configured" | `SELF_AGENT_PRIVATE_KEY` env var not set in MCP server              | Add the key to the `env` block in your MCP server configuration. Read-only tools (`self_lookup_agent`, `self_list_agents_for_human`) work without a key. |
| `self_lookup_agent` returns empty/null for a known agent | Wrong network selected                                              | The agent may be registered on testnet but you're querying mainnet (or vice versa). Specify the correct `network` parameter.                             |
| Credentials show `olderThan: 0` for a registered agent   | Agent used verification config `'0'` or `'3'` (no age gate)         | The agent registered without an age threshold. This is expected for configs that don't include age verification.                                         |
| `ofacClean: false` for a legitimate agent                | Agent used a config without OFAC screening (`'0'`, `'1'`, or `'2'`) | A `false` value means "not screened", not "failed screening". Check the verification config used at registration.                                        |
| REST API returns 404                                     | Wrong chain ID in URL path                                          | Use `42220` for mainnet or `11142220` for testnet. The old Alfajores chain ID (`44787`) is not supported.                                                |

## Reference Documentation

For detailed credential type definitions, on-chain storage format, A2A card schema, reputation and validation provider queries, and Solidity integration patterns, see [`references/credential-types.md`](references/credential-types.md).
