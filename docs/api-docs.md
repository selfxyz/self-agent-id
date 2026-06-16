# REST API

> Archived from the former /api-docs web page.

## Overview

The Self Agent ID REST API lets you programmatically register, deregister, and query AI agents with on-chain proof-of-human verification. No API keys required — sessions use encrypted tokens with a 30-minute TTL.

**Base URL:** `https://agent-api.self.xyz/api/agent`

**Discovery:** `GET /.well-known/self-agent-id.json`

Session lifecycle:

```
POST /register → session token
↳ User scans QR with Self app → proof submitted on-chain
GET /register/status (+ Authorization: Bearer) → poll until completed
POST /register/export → retrieve agent private key
```

## Using an AI coding assistant?

The [MCP server](https://www.npmjs.com/package/@selfxyz/mcp-server) wraps these REST APIs into 10 tools — no manual HTTP needed. [Set up MCP →](/integration#mcp)

## Quick Start

Register an agent in 3 steps using curl:

```bash
# 1. Initiate registration
curl -X POST https://agent-api.self.xyz/api/agent/register \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "linked",
    "network": "testnet",
    "humanAddress": "0xYourWalletAddress"
  }'
# → { sessionToken, deepLink, agentAddress, ... }

# 2. Show deepLink to user (or render QR)
#    User scans QR with Self app → passport proof submitted

# 3. Poll for completion
curl "https://agent-api.self.xyz/api/agent/register/status" \
  -H "Authorization: Bearer SESSION_TOKEN"
# → { stage: "completed", agentId: 42, ... }

# 4. (Optional) Export agent private key
curl -X POST https://agent-api.self.xyz/api/agent/register/export \
  -H "Content-Type: application/json" \
  -d '{"token":"SESSION_TOKEN"}'
# → { privateKey, agentAddress, agentId }
```

## Endpoints

### Registration

Create and manage agent registration sessions. Returns session tokens, QR data, and deep links for the Self app.

#### POST /api/agent/register

Initiate agent registration

Creates a new registration session. Returns session token, QR code data, deep link, and the generated agent address. The user must scan the QR with the Self app to submit a passport proof.

**Request Body**

Modes: "self-custody", "linked", "wallet-free", "ed25519", "ed25519-linked". Networks: "mainnet", "testnet".

```json
{
  "mode": "linked",
  "network": "testnet",
  "humanAddress": "0x...",
  "disclosures": {
    "minimumAge": 18,
    "ofac": true,
    "nationality": false,
    "name": false
  }
}
```

**Responses**

`200` — Session created successfully

```json
{
  "sessionToken": "enc_...",
  "deepLink": "selfapp://verify?scope=...",
  "qrData": "selfapp://verify?scope=...",
  "agentAddress": "0x83fa...ff00",
  "mode": "linked",
  "network": "testnet"
}
```

`400` — Invalid parameters or missing fields

```json
{ "error": "humanAddress is required for linked mode" }
```

#### GET /api/agent/register/status

Poll registration status

Returns current registration stage: "qr-ready", "proof-received", "completed", or "failed". Send the session token as Authorization: Bearer <sessionToken>.

**Responses**

`200` — Current session status

```json
{
  "stage": "completed",
  "agentId": 42,
  "agentAddress": "0x83fa...ff00",
  "txHash": "0xabc...",
  "sessionToken": "enc_..."
}
```

`410` — Session expired (30-minute TTL)

#### POST /api/agent/register/callback

Receive Self app callback

Webhook endpoint called by the Self app after the user scans the QR and submits a passport proof. Updates session stage to proof-received and triggers on-chain registration.

**Parameters**

| Name  | In    | Type   | Required | Description             |
| ----- | ----- | ------ | -------- | ----------------------- |
| token | query | string | required | Encrypted session token |

**Responses**

`200` — Callback processed

`401` — Invalid or tampered token

#### GET /api/agent/register/qr

Get QR code and deep link

Returns the QR code payload and deep link for the current session. Send the session token as Authorization: Bearer <sessionToken>.

**Responses**

`200` — QR data returned

```json
{
  "qrData": "selfapp://verify?scope=...",
  "deepLink": "selfapp://verify?scope=..."
}
```

#### POST /api/agent/register/export

Export agent private key

After registration completes, export the agent's private key. Only available for "linked", "wallet-free", "ed25519", and "ed25519-linked" modes.

**Request Body**

Provide the encrypted session token in the request body.

```json
{
  "token": "enc_..."
}
```

**Responses**

`200` — Private key exported

```json
{
  "privateKey": "0xdeadbeef...",
  "agentAddress": "0x83fa...ff00",
  "agentId": 42
}
```

`409` — Session not in completed stage

### Deregistration

Remove an agent from the on-chain registry. Requires the same passport proof flow as registration.

#### POST /api/agent/deregister

Initiate agent deregistration

Verifies the agent exists on-chain, then creates a deregistration session with QR data. The human must re-prove identity to burn the agent NFT.

**Request Body**

```json
{
  "network": "testnet",
  "agentAddress": "0x...",
  "disclosures": {
    "minimumAge": 18,
    "ofac": true
  }
}
```

**Responses**

`200` — Deregistration session created

```json
{
  "sessionToken": "enc_...",
  "deepLink": "selfapp://verify?scope=...",
  "qrData": "selfapp://verify?scope=..."
}
```

`404` — Agent not found on-chain

#### GET /api/agent/deregister/status

Poll deregistration status

Returns current deregistration stage. Once completed, the agent NFT has been burned. Send the session token as Authorization: Bearer <sessionToken>.

**Responses**

`200` — Current deregistration status

```json
{
  "stage": "completed",
  "txHash": "0xdef..."
}
```

#### POST /api/agent/deregister/callback

Receive deregistration callback

Webhook endpoint for the Self app after the user confirms deregistration.

**Parameters**

| Name  | In    | Type   | Required | Description             |
| ----- | ----- | ------ | -------- | ----------------------- |
| token | query | string | required | Encrypted session token |

**Responses**

`200` — Callback processed

`401` — Invalid or tampered token

### Query

Read-only endpoints for querying on-chain agent data. No session token required. Use chain ID 42220 for mainnet or 11142220 for Celo Sepolia testnet.

#### GET /api/agent/info/{chainId}/{agentId}

Get agent details

Returns full agent information: address, verification status, proof provider, credentials, and registration timestamp.

**Parameters**

| Name    | In   | Type   | Required | Description                           |
| ------- | ---- | ------ | -------- | ------------------------------------- |
| chainId | path | number | required | 42220 (mainnet) or 11142220 (testnet) |
| agentId | path | number | required | On-chain agent token ID               |

**Responses**

`200` — Agent details

```json
{
  "agentId": 5,
  "chainId": 11142220,
  "agentAddress": "0x83fa...ff00",
  "isVerified": true,
  "proofProvider": "0x69Da...9b80c",
  "verificationStrength": 2,
  "strengthLabel": "Standard",
  "credentials": {
    "nationality": "GBR",
    "olderThan": 18,
    "ofac": [false, false, false]
  },
  "registeredAt": 1740000000,
  "network": "testnet"
}
```

`404` — Agent not found

#### GET /api/agent/agents/{chainId}/{address}

List agents by human address

Returns all agent IDs registered by a specific human wallet address.

**Parameters**

| Name    | In   | Type   | Required | Description                           |
| ------- | ---- | ------ | -------- | ------------------------------------- |
| chainId | path | number | required | 42220 (mainnet) or 11142220 (testnet) |
| address | path | string | required | Human wallet address (0x...)          |

**Responses**

`200` — List of agent IDs

```json
{
  "agents": [5, 12, 37],
  "chainId": 11142220,
  "humanAddress": "0xabc..."
}
```

#### GET /api/agent/verify/{chainId}/{agentId}

Verify agent proof-of-human

Checks whether an agent has valid proof-of-human verification, the proof provider address, verification strength label, and Sybil metrics.

**Parameters**

| Name    | In   | Type   | Required | Description                           |
| ------- | ---- | ------ | -------- | ------------------------------------- |
| chainId | path | number | required | 42220 (mainnet) or 11142220 (testnet) |
| agentId | path | number | required | On-chain agent token ID               |

**Responses**

`200` — Verification result

```json
{
  "agentId": 5,
  "isVerified": true,
  "proofProvider": "0x69Da...9b80c",
  "strengthLabel": "Standard",
  "humanAgentCount": 1,
  "maxAgentsPerHuman": 1
}
```

`404` — Agent not found

### Discovery

Well-known endpoint for service discovery and capability advertisement.

#### GET /.well-known/self-agent-id.json

Service discovery document

Returns the service discovery document with API base URL, supported networks, registration modes, and capabilities.

**Responses**

`200` — Discovery document

```json
{
  "api": "https://agent-api.self.xyz/api/agent",
  "networks": ["mainnet", "testnet"],
  "modes": [
    "self-custody",
    "linked",
    "wallet-free",
    "ed25519",
    "ed25519-linked"
  ],
  "capabilities": ["register", "deregister", "query", "verify"]
}
```

## SDK Integration

SDKs wrap the REST API and provide typed helpers for registration, verification, and signed requests.

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  endpoint: "https://agent-api.self.xyz",
  network: "testnet",
});

// Request registration — returns session with QR link
const session = await agent.requestRegistration({
  mode: "linked",
  humanAddress: "0xYourWallet",
  disclosures: { minimumAge: 18, ofac: true },
});

console.log(session.deepLink); // show to user
console.log(session.sessionToken); // save for polling

// Poll until complete
const result = await agent.waitForRegistration(session.sessionToken);
console.log(result.agentId); // on-chain agent ID
```

```python
from self_agent_sdk import SelfAgent

agent = SelfAgent(
    endpoint="https://agent-api.self.xyz",
    network="testnet",
)

# Request registration
session = agent.request_registration(
    mode="linked",
    human_address="0xYourWallet",
    disclosures={"minimum_age": 18, "ofac": True},
)

print(session.deep_link)  # show to user
print(session.session_token)  # save for polling

# Poll until complete
result = agent.wait_for_registration(session.session_token)
print(result.agent_id)  # on-chain agent ID
```

```rust
use self_agent_sdk::SelfAgent;

let agent = SelfAgent::new(
    "https://agent-api.self.xyz",
    "testnet",
);

// Request registration
let session = agent.request_registration(
    "linked",
    "0xYourWallet",
    Disclosures { minimum_age: 18, ofac: true, ..Default::default() },
).await?;

println!("{}", session.deep_link); // show to user

// Poll until complete
let result = agent.wait_for_registration(&session.session_token).await?;
println!("Agent ID: {}", result.agent_id);
```

## Authentication

The API uses encrypted session tokens instead of API keys. Tokens are returned by `POST /register` and `POST /deregister` and must be passed as a `token` query parameter to all subsequent endpoints.

- Tokens expire after **30 minutes**
- Each token is scoped to a single registration or deregistration session
- Updated tokens are returned in each response — always use the latest one
- Query endpoints (`/info`, `/agents`, `/verify`) require no authentication

## Error Codes

All errors return `{ "error": "message" }` with the appropriate HTTP status.

| Code | Meaning                                                         |
| ---- | --------------------------------------------------------------- |
| 400  | Bad request — invalid parameters, missing fields, or wrong mode |
| 401  | Invalid or tampered session token                               |
| 404  | Agent not found on-chain                                        |
| 409  | Operation not available at current session stage                |
| 410  | Session expired (30-minute TTL)                                 |
| 500  | Server error — RPC failure or configuration issue               |

## Footer

Full source code and SDK packages are available on [GitHub](https://github.com/selfxyz/self-agent-id). See the [CLI Quickstart](/cli) for command-line usage.
