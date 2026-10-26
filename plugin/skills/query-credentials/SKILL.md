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

All operations in this skill are read-only. No state changes occur on-chain. The public MCP tools (`self_lookup_agent`, `self_list_agents_for_human`) and the REST read routes need no key or authorization. The privileged `self_get_identity` tool reports on the MCP server's own configured agent (`SELF_AGENT_PRIVATE_KEY`) and needs `Authorization: Bearer <MCP_PRIVILEGED_API_KEY>`.

"Verified" everywhere means `hasHumanProof && isProofFresh` (a human proof exists and has not expired).

## Look Up an Agent by ID or Address

Use the public `self_lookup_agent` MCP tool (it wraps `GET /api/agent/info/{chainId}/{agentId}`).

**Input:**

- `agent_id` (number) — The agent's on-chain token ID. Provide either this OR `agent_address`.
- `agent_address` (hex string) — The agent's Ethereum address (used when `agent_id` is omitted).
- `network` (optional, string) — `"testnet"` or `"mainnet"`. Defaults to the server's network (mainnet on the hosted server).

**Output** (the REST response plus a summary):

```
agentId, chainId, agentKey, agentAddress
isVerified           — hasHumanProof && isProofFresh
hasHumanProof, isProofFresh
proofExpiresAt       — ISO-8601 string
proofProvider        — Address of the proof provider that verified the agent
registeredAtBlock    — Block number at which registration occurred
verificationStrength — 0-100, with strengthLabel (e.g. "passport")
credentials          — { nationality (alpha-3 or null), olderThan, ofac: [bool, bool, bool] }
network
credentialsSummary   — e.g. "Verified human, 18+, OFAC clear, nationality: USA"
```

An unknown address or a never-minted / burned agent ID returns a tool error ("not registered" / "not found").

## List Agents for a Human

Use the public `self_list_agents_for_human` MCP tool (wraps `GET /api/agent/agents/{chainId}/{address}`).

**Input:**

- `human_address` (hex string) — The human's Ethereum wallet address.
- `network` (optional, string) — `"testnet"` or `"mainnet"`.

**Output:**

```
human_address, network
agents      — [{ agentId, agentKey, agentAddress, isOwner, isAgentKey, isVerified, hasHumanProof, isProofFresh, proofExpiresAt }]
total_count — agents backed by the same human (sybil checks)
complete    — false if the list is partial
```

The human address is the NFT owner for `linked`, `privy` and `smartwallet` agents (and the agent key for the simple `R` action).

## Check the MCP Server's Own Identity

The privileged `self_get_identity` tool reports on the agent configured on the MCP server (`SELF_AGENT_PRIVATE_KEY`), so it is only useful on a deployment you run yourself.

**Input:**

- `network` (optional, string) — `"testnet"` or `"mainnet"`.

**Output:**

```
registered              — bool
address                 — The agent's Ethereum address
agentKey, agentId
isVerified              — hasHumanProof && isProofFresh
proofExpiresAt          — ISO-8601 string or null
nullifier               — Human nullifier (decimal string)
agentCount              — Number of agents registered by the same human
verificationStrength    — Score from the proof provider (0-100)
credentials_summary     — Human-readable summary string
network
```

Without a privileged bearer key the tool returns an authorization error; without `SELF_AGENT_PRIVATE_KEY` on the server it returns an error explaining that no agent key is configured.

## MCP Resources

Two resources are available for passive context:

### `self://networks`

Returns registry addresses, chain IDs, RPC URLs, and block explorer URLs for both mainnet and testnet. This resource is public.

Example content:

```json
{
  "current_network": "mainnet",
  "networks": {
    "mainnet": {
      "chain_id": 42220,
      "chain_name": "Celo",
      "registry": "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
      "rpc_url": "https://forno.celo.org",
      "block_explorer": "https://celoscan.io"
    },
    "testnet": {
      "chain_id": 11142220,
      "chain_name": "Celo Sepolia",
      "registry": "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
      "rpc_url": "https://forno.celo-sepolia.celo-testnet.org",
      "block_explorer": "https://celo-sepolia.blockscout.com"
    }
  }
}
```

### `self://identity`

Returns the MCP server's own agent identity. Privileged (Bearer MCP key) and requires `SELF_AGENT_PRIVATE_KEY` on the server.

## Credential Fields

The following credential fields are stored on-chain at registration time, extracted from the ZK proof:

| Field       | Type    | Values                                         | Source                                                                               |
| ----------- | ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| nationality | string  | ISO 3166-1 alpha-3 (e.g., "USA", "GBR", "DEU") | ZK passport proof — extracted from the passport's machine-readable zone (MRZ)        |
| olderThan   | uint8   | 0, 18, or 21                                   | Determined by the verification config selected at registration time                  |
| ofac        | bool[3] | per-list results                               | OFAC sanctions screening performed at registration time (`ofacClean` in agent cards) |

All credential values are cryptographically verified through the ZK proof. They are NOT self-reported. The nationality comes from the passport issuing country, the age threshold is verified against the passport date of birth, and the OFAC status is checked against US sanctions lists.

## Verification Strength

The 0-100 score is the proof provider's `verificationStrength()`. Only `SelfHumanProofProvider` (strength **100**) is approved today; 0 means no proof. The `strengthLabel` / `proofType` string comes from the SDK's `getProviderLabel`:

| Score | Label      |
| ----- | ---------- |
| ≥100  | `passport` |
| ≥80   | `kyc`      |
| ≥60   | `govt_id`  |
| ≥40   | `liveness` |
| other | `unknown`  |

Query it with:

- MCP / REST: `self_lookup_agent`, `GET /api/agent/info/{chainId}/{agentId}` (`verificationStrength`), `GET /api/reputation/{chainId}/{agentId}` (`score`)
- SDK: `agent.getVerificationStrength()` returns a `number`
- Contract: `IHumanProofProvider(registry.getProofProvider(agentId)).verificationStrength()`

## Agent Cards (A2A Format)

Agent cards are JSON metadata stored on-chain via the `updateAgentMetadata()` function on the registry contract. The A2A (Agent-to-Agent) card format provides a standardized way for agents to advertise their identity, capabilities, and trust posture to other agents and services.

`GET /api/cards/{chainId}/{agentId}` returns the card built from on-chain state (the stored metadata's own fields, when set, take the place of the defaults):

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "Agent #1",
  "description": "Human-verified AI agent on Self Protocol",
  "selfProtocol": {
    "agentId": 1,
    "registry": "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
    "chainId": 11142220,
    "agentKey": "0x000000000000000000000000551775463d338c0c406b3266c63af6eda8b3e47a",
    "agentAddress": "0x551775463D338c0c406b3266c63AF6EDA8b3e47a",
    "isVerified": true,
    "proofExpiresAt": "2027-02-25T17:58:52.000Z",
    "registeredAtBlock": 18758344,
    "proofProvider": "0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c",
    "providerName": "self",
    "verificationStrength": 100,
    "trustModel": {
      "proofType": "passport",
      "sybilResistant": true,
      "ofacScreened": true,
      "minimumAgeVerified": 18
    },
    "credentials": {
      "nationality": "USA",
      "issuingState": null,
      "olderThan": 18,
      "ofacClean": true,
      "hasName": false,
      "hasDateOfBirth": false,
      "hasGender": false,
      "documentExpiry": null
    }
  },
  "services": [
    {
      "name": "registry-a2a",
      "endpoint": "https://agent-api.self.xyz/api/a2a",
      "version": "0.3.0",
      "description": "Self Agent ID registry A2A endpoint (lookups about this agent; not the agent's own endpoint)"
    }
  ]
}
```

Interact with agent cards using:

- SDK: `buildAgentCard()` helper to construct a card, `agent.getAgentCard()` to read, `agent.setAgentCard()` to write
- REST API: `GET /api/cards/{chainId}/{agentId}`

## Reputation and Validation Contracts

| Contract                 | Deployed | Query                                                                                                            |
| ------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `SelfReputationRegistry` | Yes      | `getSummary(agentId, clients, tag1, tag2)`, `readFeedback(…)` — ERC-8004 feedback entries                        |
| `SelfValidationRegistry` | Yes      | `getLatestFreshness(agentId)` → `(fresh, lastUpdated)`; `getSummary(agentId, validators, tag)`                   |
| `SelfReputationSignal`   | No       | `getReputationScore` / `getReputation` / `getReputationBatch` — wraps provider strength                          |
| `SelfFreshnessChecker`   | No       | `isValidAgent` / `validateAgent` / `validateBatch` — registered within 6,307,200 blocks (≈73 days at ~1 s/block) |

Addresses and signatures: [contracts.md](../self-agent-id-overview/references/contracts.md). For expiry, use `isProofFresh` (or `isVerified` from the API), not block age.

## Using the SDK

Query agent data programmatically with the `@selfxyz/agent-sdk` package:

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

// Initialize with an existing private key
const agent = new SelfAgent({ privateKey: "0x...", network: "mainnet" });

// On-chain identity: agentId, isVerified (proof present AND fresh), proofExpiresAt, sybil data
const info = await agent.getInfo();

// ZK-attested credentials (nationality, olderThan, ofac, ...) or undefined if unregistered
const creds = await agent.getCredentials();

// Get verification strength score (0-100)
const strength = await agent.getVerificationStrength();

// Get the agent's A2A card (if set)
const card = await agent.getAgentCard();
```

Look up any agent without a key: `SelfAgent.getAgentInfo(agentId, { network })` (REST, throws `RegistrationError` with `status` 404 for unknown / burned agents) and `SelfAgent.getAgentsForHuman(address, { network })`.

From other languages, call the REST endpoints below directly.

## REST API Equivalents

All query operations are also available via REST endpoints:

| Endpoint                                     | Description                            |
| -------------------------------------------- | -------------------------------------- |
| `GET /api/agent/info/{chainId}/{agentId}`    | Full agent info by ID                  |
| `GET /api/agent/agents/{chainId}/{address}`  | List agents for a human address        |
| `GET /api/agent/verify/{chainId}/{agentId}`  | Verification status and proof provider |
| `GET /api/verify-status/{chainId}/{agentId}` | Compact verification summary           |
| `GET /api/cards/{chainId}/{agentId}`         | Agent card (A2A metadata)              |
| `GET /api/reputation/{chainId}/{agentId}`    | Reputation score and provider details  |

Base URL: `https://agent-api.self.xyz`

Override the base URL by setting the `SELF_AGENT_API_BASE` environment variable. This is useful for local development or self-hosted deployments.

### Chain IDs

Use the following chain IDs in API paths:

- Celo Mainnet: `42220`
- Celo Sepolia (testnet): `11142220`

Status codes: `404 { "error": "Agent not found" }` for a never-minted or burned agent, `400` for an unsupported chain ID or malformed agent ID, `502 { "error": "RPC error" }` when the chain is unreachable.

### Example Requests

```bash
# Look up agent ID 5 on mainnet
curl https://agent-api.self.xyz/api/agent/info/42220/5

# Get the agent card for agent ID 5
curl https://agent-api.self.xyz/api/cards/42220/5

# List all agents for a human address on testnet
curl https://agent-api.self.xyz/api/agent/agents/11142220/0x56738c05507379C38Bbfa8f75064fd344716245F
```

## Common Query Patterns

### Verify an Agent Before Trusting It

When receiving a request from an unknown agent, follow this sequence:

1. Call `self_lookup_agent` with the agent's address to get the agent ID and verification status.
2. Check `isVerified` is `true` — this confirms the agent has a human proof that has not expired.
3. Check `credentials.ofac` if sanctions compliance is required.
4. Check `credentials.olderThan` if age-gating is required.
5. Optionally check the verification strength score to enforce a minimum trust level.

### Discover All Agents for a Human

To find all agents operated by a specific human:

1. Call `self_list_agents_for_human` with the human's wallet address.
2. For each returned agent ID, call `self_lookup_agent` to get full details.
3. Compare nullifiers — all agents from the same human share the same nullifier value.

### Check Own Status After Registration

After registering, confirm the identity is correctly recorded:

1. Call `self_lookup_agent` with the new `agent_id` (or `GET /api/agent/info/{chainId}/{agentId}`).
2. Verify `isVerified` is `true`.
3. Verify `credentials` match the selected verification config.
4. Verify `proofProvider` matches Self Protocol's known provider address.

## Troubleshooting

| Symptom                                                   | Cause                                                               | Resolution                                                                                                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `self_get_identity` returns an authorization error        | It is a privileged tool                                             | It needs `Authorization: Bearer <MCP_PRIVILEGED_API_KEY>` and a server-side `SELF_AGENT_PRIVATE_KEY`. Use `self_lookup_agent` for any agent instead. |
| `self_lookup_agent` reports "not found" for a known agent | Wrong network selected                                              | The agent may be registered on testnet but you're querying mainnet (or vice versa). Specify the correct `network` parameter.                         |
| Credentials show `olderThan: 0` for a registered agent    | Agent used verification config `'0'` or `'3'` (no age gate)         | The agent registered without an age threshold. This is expected for configs that don't include age verification.                                     |
| `ofac` all `false` for a legitimate agent                 | Agent used a config without OFAC screening (`'0'`, `'1'`, or `'2'`) | A `false` value means "not screened", not "failed screening". Check the verification config used at registration.                                    |
| REST API returns 400 "Unsupported chain"                  | Wrong chain ID in URL path                                          | Use `42220` for mainnet or `11142220` for testnet. The old Alfajores chain ID (`44787`) is not supported.                                            |
| REST API returns 404 "Agent not found"                    | Agent never minted, or burned by deregistration                     | Check the agent ID and network. Deregistered agents are gone; a re-registration has a new ID.                                                        |

## Reference Documentation

For detailed credential type definitions, on-chain storage format, A2A card schema, reputation and validation provider queries, and Solidity integration patterns, see [`references/credential-types.md`](references/credential-types.md).
