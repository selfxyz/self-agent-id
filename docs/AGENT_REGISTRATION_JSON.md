# Agent Registration JSON Schema

Every agent registered with `SelfAgentRegistry` must publish a JSON file at their `agentURI`.
This file is the agent's identity document — it is how services, indexers, and 8004scan
discover and verify the agent's capabilities.

## Overview

The document at `agentURI` is an ERC-8004 registration file. When A2A fields (`version`,
`url`, `provider`, `capabilities`, `securitySchemes`) are included, the document is
simultaneously a valid A2A Agent Card — no second document or separate A2A registration
needed. The two specs read non-overlapping fields and ignore what they do not know.

```
ERC-8004 reads: type, name, description, image, services[], active, registrations[], supportedTrust[]
A2A reads:      name, description, url, version, provider, capabilities, securitySchemes, skills[], defaultInputModes, defaultOutputModes
```

## Minimal ERC-8004 Format

A document with only ERC-8004 fields — sufficient for on-chain registry and 8004scan:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "My Agent",
  "description": "What this agent does",
  "image": "https://example.com/avatar.png",
  "services": [
    { "name": "A2A", "endpoint": "https://my-agent.example.com/a2a", "version": "1.0" }
  ]
}
```

## Combined ERC-8004 + A2A Format

Adding A2A fields makes this single document simultaneously a valid A2A Agent Card:

```json
{
  "type": "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  "name": "My Agent",
  "description": "A human-backed AI agent verified via Self Protocol",
  "image": "https://my-agent.example.com/avatar.png",
  "version": "0.1.0",
  "url": "https://my-agent.example.com/a2a",
  "provider": { "name": "Acme Corp", "url": "https://acme.example.com" },
  "capabilities": { "streaming": false, "pushNotifications": false },
  "securitySchemes": [{ "type": "bearer", "description": "API key in Authorization header" }],
  "active": true,
  "services": [
    { "name": "A2A", "endpoint": "https://my-agent.example.com/a2a", "version": "1.0" },
    { "name": "MCP", "endpoint": "https://my-agent.example.com/mcp", "version": "1.0" }
  ],
  "registrations": [
    { "agentId": 42, "agentRegistry": "eip155:42220:0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095" }
  ],
  "supportedTrust": ["reputation"]
}
```

## Field Reference

| Field | Required | Protocol | Notes |
|---|---|---|---|
| `type` | YES | ERC-8004 | Must be `"https://eips.ethereum.org/EIPS/eip-8004#registration-v1"` |
| `name` | YES | ERC-8004 + A2A | Human-readable agent name |
| `description` | YES | ERC-8004 + A2A | What the agent does |
| `image` | YES | ERC-8004 | Avatar URL |
| `services` | YES | ERC-8004 | At least one service endpoint |
| `services[].name` | YES | ERC-8004 | One of: `web`, `A2A`, `MCP`, `OASF`, `ENS`, `DID`, `email` |
| `services[].endpoint` | YES | ERC-8004 | Service URI |
| `services[].version` | YES (for A2A/MCP) | ERC-8004 | Required by A2A protocol; e.g. `"1.0"` |
| `active` | NO | ERC-8004 | Set `false` when agent is inactive (e.g. proof expired) |
| `registrations` | NO | ERC-8004 | Cross-chain registry refs using CAIP-10: `eip155:<chainId>:<address>` |
| `supportedTrust` | NO | ERC-8004 | `reputation`, `crypto-economic`, `tee-attestation` |
| `version` | NO* | A2A | Agent software version (e.g. `"0.1.0"`). *Required for A2A Agent Card |
| `url` | NO* | A2A | A2A primary endpoint. MUST equal `services[name="A2A"].endpoint`. *Required for A2A Agent Card |
| `provider` | NO* | A2A | Publisher identity `{ name, url?, email? }`. *Required for A2A Agent Card |
| `capabilities` | NO* | A2A | `{ streaming: bool, pushNotifications: bool }`. *Required for A2A Agent Card |
| `securitySchemes` | NO* | A2A | Auth methods. `{ type: "bearer"\|"apiKey"\|"oauth2"\|"none" }[]`. *Required for A2A Agent Card |
| `defaultInputModes` | NO | A2A | MIME types the agent accepts, e.g. `["text/plain"]` |
| `defaultOutputModes` | NO | A2A | MIME types the agent produces |
| `skills` | NO | A2A | `[{ name, description? }]` — specific tasks the agent offers |

## A2A Compatibility Note

When `version`, `url`, `provider`, `capabilities`, and `securitySchemes` are all present,
the document IS a valid A2A Agent Card — no separate A2A registration step is needed.

Key constraints when combining:

- `url` (the A2A primary endpoint) and `services[name="A2A"].endpoint` MUST point to
  the same address. A2A clients read `url`; ERC-8004 indexers read `services`.
- `version` = agent **software** version (e.g. `"0.1.0"`); `services[].version` =
  **protocol** version (e.g. `"1.0"`). These are distinct fields.
- The path `/.well-known/agent-card.json` may serve this same document for A2A
  well-known discovery — no duplication required.

## Hub V2 Registrations: agentURI Required After Mint

Agents registered via the **Hub V2 Self Protocol flow** (`verifySelfProof` callback →
`_registerAgent` / `_registerAgentWalletFree`) are minted with a **blank `agentURI`**.
The on-chain `Registered` event will contain an empty string for the URI.

**You MUST call `setAgentURI()` after registration:**

```solidity
registry.setAgentURI(agentId, "https://my-agent.example.com/.well-known/agent.json");
```

Until `setAgentURI()` is called:
- 8004scan will index the agent with no identity document
- A2A clients cannot discover your service endpoints
- The `active` and `services` fields are effectively invisible to the ecosystem

This does not apply to agents registered via the `register(agentURI)` or
`registerWithHumanProof(agentURI, ...)` overloads, which accept a URI directly.

## On-Chain Metadata Fields

When registered via Self Protocol's `SelfAgentRegistry`, the following on-chain metadata
keys are populated automatically:

| Key | Description |
|---|---|
| `agentWallet` | (reserved) Set via `setAgentWallet()` — payment address separate from NFT owner |

Additional metadata can be set via `setMetadata(agentId, key, value)` using any custom key
except `agentWallet` (reserved).

## SDK Helper

The TypeScript SDK provides `generateRegistrationJSON` to build valid documents:

```typescript
import { generateRegistrationJSON } from '@selfxyz/agent-sdk';

// Minimal ERC-8004 only
const minimalDoc = generateRegistrationJSON({
  name: 'My Agent',
  description: 'What it does',
  image: 'https://...',
  services: [{ name: 'A2A', endpoint: 'https://...', version: '1.0' }],
});

// Combined ERC-8004 + A2A (single document, both protocols)
const fullDoc = generateRegistrationJSON({
  name: 'My Agent',
  description: 'What it does',
  image: 'https://...',
  services: [{ name: 'A2A', endpoint: 'https://my-agent.example.com/a2a', version: '1.0' }],
  a2a: {
    version: '0.1.0',
    url: 'https://my-agent.example.com/a2a',
    provider: { name: 'Acme Corp' },
    capabilities: { streaming: false, pushNotifications: false },
    securitySchemes: [{ type: 'bearer' }],
  },
});
```

## Hosting Requirements

The JSON file must be:
1. Accessible via HTTPS at the `agentURI` provided during registration
2. Served with `Content-Type: application/json`
3. Updated if the agent's services or status changes (update via `setAgentURI()`)

## Validation

Use the 8004scan validator at [8004scan.xyz](https://8004scan.xyz) to verify your
registration JSON is correctly formatted before registering.
