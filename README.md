# Self Agent ID

[![npm](https://img.shields.io/npm/v/@selfxyz/agent-sdk?label=npm)](https://www.npmjs.com/package/@selfxyz/agent-sdk)
[![PyPI](https://img.shields.io/pypi/v/selfxyz-agent-sdk?label=pypi)](https://pypi.org/project/selfxyz-agent-sdk/)
[![crates.io](https://img.shields.io/crates/v/self-agent-sdk?label=crates.io)](https://crates.io/crates/self-agent-sdk)
[![MCP](https://img.shields.io/npm/v/@selfxyz/mcp-server?label=mcp)](https://www.npmjs.com/package/@selfxyz/mcp-server)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Proof-of-human identity for AI agents on Celo.

- **Live**: [self-agent-id.vercel.app](https://self-agent-id.vercel.app)
- **Standard**: [ERC-8004 Proof-of-Human extension](https://eips.ethereum.org/EIPS/eip-8004)
- **SDKs**: TypeScript, Python, Rust — identical feature parity

## Quick Start

### Install

```bash
npm install @selfxyz/agent-sdk    # TypeScript
pip install selfxyz-agent-sdk      # Python
cargo add self-agent-sdk           # Rust
```

### Agent-side (sign requests)

```ts
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey: process.env.AGENT_PRIVATE_KEY! });
const res = await agent.fetch("https://api.example.com/protected", {
  method: "POST",
  body: JSON.stringify({ ping: true }),
});
```

### Service-side (verify agents)

```ts
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .requireAge(18)
  .requireOFAC()
  .sybilLimit(3)
  .build();

app.use("/api", verifier.auth());
```

### Run the web app locally

```bash
cd app
cp .env.example .env.local
npm install && npm run dev
```

---

## Integration Guides

| I want to... | Guide |
|---|---|
| Build an AI agent with identity | [Agent Builder Guide](https://docs.self.xyz/agent-id/guides/agent-builder) |
| Verify agent requests in my API | [Service Operator Guide](https://docs.self.xyz/agent-id/guides/service-operator) |
| Gate smart contracts by agent ID | [Contract Developer Guide](https://docs.self.xyz/agent-id/guides/contract-developer) |
| Use MCP with Claude/Cursor | [MCP Guide](https://docs.self.xyz/agent-id/guides/mcp-user) |

---

## 1. Overview

Self Agent ID is an on-chain identity registry that binds AI agent identities to Self Protocol human proofs. Each agent receives a soulbound ERC-721 NFT backed by a ZK passport verification, enabling trustless proof-of-human for autonomous agents.

### Audiences

1. **Agent builders** — Register an agent identity, sign outbound requests with `SelfAgent`.
2. **Service/API teams** — Verify inbound agent signatures with `SelfAgentVerifier` middleware.
3. **Protocol/infra teams** — Gate smart contracts, query on-chain state, compose with registry interfaces.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Self Agent ID System                        │
│                                                                     │
│  ┌──────────┐    ┌────────────┐    ┌───────────────────────────┐   │
│  │  Human    │───▶│  Self App  │───▶│  Identity Verification    │   │
│  │ (Passport)│    │ (ZK Proof) │    │  Hub V2 (on-chain)        │   │
│  └──────────┘    └────────────┘    └───────────┬───────────────┘   │
│                                                 │ callback          │
│  ┌──────────────────────────────────────────────▼───────────────┐  │
│  │              SelfAgentRegistry (ERC-721)                      │  │
│  │  - Soulbound NFTs (non-transferable)                         │  │
│  │  - 4 registration modes                                      │  │
│  │  - 6 verification configs (age × OFAC)                       │  │
│  │  - ZK-attested credential storage                            │  │
│  │  - Nullifier-based sybil resistance                          │  │
│  │  - Guardian support for compromise recovery                  │  │
│  └──────────┬──────────────┬──────────────┬─────────────────────┘  │
│             │              │              │                          │
│  ┌──────────▼──┐ ┌────────▼─────┐ ┌─────▼──────────────────┐      │
│  │ Reputation  │ │  Validation  │ │  Demo Contracts         │      │
│  │ Provider    │ │  Provider    │ │  (DemoVerifier, Gate)   │      │
│  └─────────────┘ └──────────────┘ └────────────────────────┘      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    SDKs (TS / Python / Rust)                 │   │
│  │  Agent-side: SelfAgent (signing, fetch, status, cards)      │   │
│  │  Service-side: SelfAgentVerifier (middleware, policy)        │   │
│  │  CLI: register/deregister workflows                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    MCP Server (@selfxyz/mcp-server)          │   │
│  │  10 tools: register, verify, sign, discover, fetch          │   │
│  │  Works with Claude Code / Cursor / Windsurf / Codex         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    REST API (Next.js)                        │   │
│  │  Registration (5) · Deregistration (3) · Query (3)          │   │
│  │  Demo (5) · Discovery (3) · AA Proxy (3)                    │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. Networks & Addresses

### Celo Mainnet (Chain ID: 42220)

| Contract | Address |
|----------|---------|
| SelfAgentRegistry | `0x62e37d0f6c5f67784b8828b3df68bcdbb2e55095` |
| SelfHumanProofProvider | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` |
| AgentDemoVerifier | `0x0aA08262b0Bd2d07ab15ffc8FFfF3D256291e0b2` |
| AgentGate | `0x2d710190e018fCf006E38eEB869b25C5F7d82424` |
| Hub V2 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` |

- RPC: `https://forno.celo.org`
- Block Explorer: `https://celoscan.io`
- Self Endpoint Type: `celo`

### Celo Sepolia Testnet (Chain ID: 11142220)

| Contract | Address |
|----------|---------|
| SelfAgentRegistry | `0x42cea1b318557ade212bed74fc3c7f06ec52bd5b` |
| SelfHumanProofProvider | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` |
| AgentDemoVerifier | `0x26e05bF632fb5bACB665ab014240EAC1413dAE35` |
| AgentGate | `0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577` |
| Hub V2 | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |

- RPC: `https://forno.celo-sepolia.celo-testnet.org`
- Block Explorer: `https://celo-sepolia.blockscout.com`
- Self Endpoint Type: `staging_celo`

> **Important**: Celo Sepolia chain ID is **11142220**, not 44787 (deprecated Alfajores).

---

## 4. Registration Modes

### 4.1 Verified Wallet (`verified-wallet`)

The human's wallet address is the agent identity. Best for human-operated on-chain gating.

- **Agent key**: `bytes32(uint256(uint160(humanAddress)))`
- **NFT owner**: Human wallet
- **Guardian**: None (human controls wallet directly)
- **Use case**: Human-operated agents, DeFi gating, DAO membership

### 4.2 Agent Identity (`agent-identity`)

Dedicated generated agent keypair. The human proves ownership via Self, then the agent operates independently. Recommended for autonomous agents.

- **Agent key**: `bytes32(uint256(uint160(agentAddress)))`
- **NFT owner**: Human wallet (creator)
- **Guardian**: None
- **Challenge**: Agent signs `keccak256("self-agent-id:register:" + humanAddress + chainId + registryAddress + nonce)`
- **Use case**: Autonomous AI agents, API bots, server-side agents

### 4.3 Wallet-Free (`wallet-free`)

No user wallet required. Agent keypair is generated locally and the agent-owned NFT is minted directly.

- **Agent key**: `bytes32(uint256(uint160(agentAddress)))`
- **NFT owner**: Agent address (self-owned)
- **Guardian**: Optional address for compromise recovery
- **Challenge**: Same as agent-identity mode
- **Use case**: Embedded agents, IoT devices, CLI-only workflows

### 4.4 Smart Wallet (`smart-wallet`)

Passkey-based smart wallet as guardian + dedicated agent keypair. Uses ZeroDev Kernel + Pimlico bundler/paymaster.

- **Agent key**: `bytes32(uint256(uint160(agentAddress)))`
- **NFT owner**: Agent address (self-owned)
- **Guardian**: Smart wallet address (passkey-controlled)
- **Challenge**: Same as agent-identity mode
- **Use case**: Consumer-facing agents, gasless UX, passkey-based recovery

> Smart wallet mode manages guardian actions with passkeys, but agents still use their own ECDSA key for API request signing.

---

## 5. Verification Configs

Six verification configurations combine age requirements with OFAC sanctions screening. The config is selected at registration time via the `userDefinedData[1]` byte.

| Config Index | Minimum Age | OFAC Screening | `userDefinedData[1]` |
|:---:|:---:|:---:|:---:|
| 0 | None | Off | `'0'` |
| 1 | 18 | Off | `'1'` |
| 2 | 21 | Off | `'2'` |
| 3 | None | On | `'3'` |
| 4 | 18 | On | `'4'` |
| 5 | 21 | On | `'5'` |

The `userDefinedData[0]` byte encodes the action type:

| Byte | Action |
|:---:|--------|
| `'R'` | Simple register |
| `'D'` | Simple deregister |
| `'K'` | Advanced register (agent keypair) |
| `'X'` | Advanced deregister |
| `'W'` | Wallet-free register |

> **Warning — `userDefinedData` encoding**: The Self SDK passes `userDefinedData` as a **UTF-8 string**, not raw bytes. Each byte position uses the ASCII character (e.g., `'0'` not `0x00`). Use `bytes32(bytes1(uint8(x)))` for byte positioning in Solidity. This is the #1 integration mistake — see [Troubleshooting](https://docs.self.xyz/agent-id/troubleshooting) for details.

---

## 6. SDKs

### Package Names

| Language | Package | Install |
|----------|---------|---------|
| TypeScript | `@selfxyz/agent-sdk` | `npm install @selfxyz/agent-sdk` |
| Python | `selfxyz-agent-sdk` | `pip install selfxyz-agent-sdk` |
| Rust | `self-agent-sdk` | `cargo add self-agent-sdk` |

All three SDKs export the same core classes with language-idiomatic naming.

### 6.1 Agent-Side: `SelfAgent`

Creates a signing agent from a private key.

**TypeScript:**

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  network: "mainnet", // or "testnet"
});

// Auto-signed HTTP request
const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "test" }),
});

// Check registration status
const registered = await agent.isRegistered();

// Get full agent info (ID, nullifier, sybil count)
const info = await agent.getInfo();

// Read ZK-attested credentials
const creds = await agent.getCredentials();

// Agent Card (A2A format)
await agent.setAgentCard({
  name: "My Agent",
  description: "Does useful things",
  skills: [{ name: "data-analysis" }],
});
const card = await agent.getAgentCard();
```

**Python:**

```python
from self_agent_sdk import SelfAgent
import os

agent = SelfAgent(
    private_key=os.environ["AGENT_PRIVATE_KEY"],
    network="mainnet",  # or "testnet"
)

res = agent.fetch("https://api.example.com/data",
                   method="POST", body='{"query": "test"}')

print("Registered:", agent.is_registered())
info = agent.get_info()
print(f"Agent ID: {info.agent_id}, Verified: {info.is_verified}")
```

**Rust:**

```rust
use self_agent_sdk::{SelfAgent, SelfAgentConfig, NetworkName};

let agent = SelfAgent::new(SelfAgentConfig {
    private_key: std::env::var("AGENT_PRIVATE_KEY").unwrap(),
    network: Some(NetworkName::Mainnet),
    registry_address: None,
    rpc_url: None,
}).unwrap();

let res = agent.fetch(
    "https://api.example.com/data",
    Some(reqwest::Method::POST),
    Some(r#"{"query":"test"}"#.to_string()),
).await.unwrap();

let registered = agent.is_registered().await.unwrap();
```

#### SelfAgent Methods (All SDKs)

| Method | Description |
|--------|-------------|
| `isRegistered()` | Check if agent is verified on-chain |
| `getInfo()` | Full agent info: ID, nullifier, sybil count |
| `signRequest(method, url, body?)` | Generate auth headers (3 headers) |
| `fetch(url, options)` | Auto-signed HTTP request |
| `getCredentials()` | Read ZK-attested credentials from on-chain |
| `getVerificationStrength()` | Provider verification strength (0-100) |
| `getAgentCard()` | Read A2A agent card from on-chain metadata |
| `setAgentCard(fields)` | Write agent card to on-chain metadata |
| `toAgentCardDataURI()` | Generate base64 data URI for card |
| `requestRegistration(opts)` | Initiate registration via REST API (static) |
| `requestDeregistration(opts?)` | Initiate deregistration via REST API |
| `getAgentInfo(agentId, opts?)` | Query agent info by ID (static) |
| `getAgentsForHuman(address, opts?)` | Get all agents for a human (static) |

#### Auth Headers

Every signed request includes three headers:

| Header | Value |
|--------|-------|
| `x-self-agent-address` | Agent's Ethereum address |
| `x-self-agent-signature` | ECDSA signature of `keccak256(timestamp + METHOD + path + bodyHash)` |
| `x-self-agent-timestamp` | Unix timestamp in milliseconds |

### 6.2 Service-Side: `SelfAgentVerifier`

Verifies inbound agent requests with configurable policy.

**TypeScript (Builder Pattern):**

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";
import express from "express";

const verifier = SelfAgentVerifier.create()
  .requireAge(18)
  .requireOFAC()
  .sybilLimit(3)
  .rateLimit({ perMinute: 10 })
  .build();

const app = express();
app.use("/api", verifier.auth());

app.post("/api/data", (req, res) => {
  console.log("Verified agent:", req.agent.address);
  console.log("Credentials:", req.agent.credentials);
  res.json({ ok: true });
});
```

**Python (Flask):**

```python
from flask import Flask, g, jsonify
from self_agent_sdk import SelfAgentVerifier
from self_agent_sdk.middleware.flask import require_agent

app = Flask(__name__)
verifier = (SelfAgentVerifier.create()
    .require_age(18)
    .require_ofac()
    .sybil_limit(3)
    .rate_limit(per_minute=10)
    .build())

@app.route("/api/data", methods=["POST"])
@require_agent(verifier)
def handle():
    print("Verified agent:", g.agent.agent_address)
    return jsonify(ok=True)
```

**Python (FastAPI):**

```python
from fastapi import FastAPI, Depends
from self_agent_sdk import SelfAgentVerifier
from self_agent_sdk.middleware.fastapi import AgentAuth

app = FastAPI()
verifier = SelfAgentVerifier.create().require_age(18).build()
agent_auth = AgentAuth(verifier)

@app.post("/api/data")
async def handle(agent=Depends(agent_auth)):
    print("Verified agent:", agent.agent_address)
    return {"ok": True}
```

**Rust (Axum):**

```rust
use axum::{Router, routing::post, middleware, Json, Extension};
use self_agent_sdk::{SelfAgentVerifier, VerifiedAgent, self_agent_auth};
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() {
    let verifier = Arc::new(Mutex::new(
        SelfAgentVerifier::create()
            .require_age(18)
            .require_ofac()
            .build()
    ));

    let app = Router::new()
        .route("/api/data", post(handle))
        .layer(middleware::from_fn_with_state(verifier, self_agent_auth));

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle(Extension(agent): Extension<VerifiedAgent>) -> Json<serde_json::Value> {
    println!("Verified agent: {:?}", agent.address);
    Json(serde_json::json!({ "ok": true }))
}
```

#### VerifierBuilder Methods (All SDKs)

| Method | Description |
|--------|-------------|
| `create()` | Factory — returns chainable builder |
| `fromConfig(cfg)` | Create from flat config object |
| `.network(name)` | Set network (`"mainnet"` / `"testnet"`) |
| `.registry(addr)` | Custom registry address |
| `.rpc(url)` | Custom RPC URL |
| `.requireAge(n)` | Minimum age requirement (18 or 21) |
| `.requireOFAC()` | Require OFAC sanctions pass |
| `.requireNationality(...codes)` | Allowed ISO country codes |
| `.requireSelfProvider()` | Require Self Protocol as proof provider |
| `.sybilLimit(n)` | Max agents per human (0 = unlimited) |
| `.rateLimit(config)` | Per-agent rate limiting |
| `.replayProtection(enabled?)` | Toggle replay detection |
| `.includeCredentials()` | Include credentials in verification result |
| `.maxAge(ms)` | Max timestamp age (default: 5 min) |
| `.cacheTtl(ms)` | On-chain cache TTL (default: 1 min) |
| `.build()` | Build the verifier instance |

#### Verification Security Chain

The verifier performs these checks in order:

1. Timestamp freshness (max 5 minutes old)
2. ECDSA signature recovery
3. Replay protection (signature+timestamp cache)
4. Agent key derivation from recovered address
5. On-chain `isVerifiedAgent()` check (cached)
6. Provider verification (Self Protocol check)
7. Sybil resistance (agent count per human)
8. Credential fetch (if required)
9. Age requirement check
10. OFAC screening check
11. Nationality allowlist check
12. Rate limiting (per-agent sliding window)

#### Verifier Defaults

| Setting | Default |
|---------|---------|
| `requireSelfProvider` | `true` |
| `maxAgentsPerHuman` | `1` |
| `replayProtection` | `true` |
| `maxAgeMs` | `300000` (5 min) |
| `cacheTtlMs` | `60000` (1 min) |
| `includeCredentials` | `false` |

### 6.3 Registration Utilities

All SDKs export registration helper functions:

| Function | Description |
|----------|-------------|
| `getRegistrationConfigIndex(disclosures?)` | Maps age/OFAC flags to config digit (0-5) |
| `computeRegistrationChallengeHash(input)` | Keccak256 of challenge material |
| `signRegistrationChallenge(privateKey, input)` | Sign challenge, return r/s/v components |
| `buildSimpleRegisterUserDataAscii(disclosures?)` | Returns `"R" + configDigit` |
| `buildSimpleDeregisterUserDataAscii(disclosures?)` | Returns `"D" + configDigit` |
| `buildAdvancedRegisterUserDataAscii(params)` | Returns `"K" + config + address + r + s + v` |
| `buildAdvancedDeregisterUserDataAscii(params)` | Returns `"X" + config + address` |
| `buildWalletFreeRegisterUserDataAscii(params)` | Returns `"W" + config + agent + guardian + r + s + v` |

### 6.4 Agent Card (A2A Format)

Agent cards follow a standardized format for agent-to-agent discovery:

```json
{
  "a2aVersion": "0.1",
  "name": "My Agent",
  "description": "Analyzes data",
  "url": "https://myagent.example.com",
  "skills": [{ "name": "data-analysis", "description": "Analyzes CSV data" }],
  "selfProtocol": {
    "agentId": 5,
    "registry": "0x62e37d0f6c5f67784b8828b3df68bcdbb2e55095",
    "chainId": 42220,
    "proofProvider": "0x0B43f87aE9F2AE2a50b3698573B614fc6643A084",
    "providerName": "self",
    "verificationStrength": 100,
    "trustModel": {
      "proofType": "passport",
      "sybilResistant": true,
      "ofacScreened": true,
      "minimumAgeVerified": 18
    },
    "credentials": {
      "nationality": "US",
      "olderThan": 18,
      "ofacClean": true
    }
  }
}
```

Cards are stored on-chain via `updateAgentMetadata()` and readable via `getAgentMetadata()`.

### Examples

| Example | Language | What it shows |
|---------|----------|---------------|
| [Minimal TypeScript](examples/minimal-ts/) | TypeScript | Agent signing + Express verifier middleware |
| [Minimal Python](examples/minimal-python/) | Python | Agent signing + FastAPI verifier middleware |
| [Minimal Rust](examples/minimal-rust/) | Rust | Agent signing + Axum verifier middleware |
| [LangChain Agent](examples/langchain-agent/) | Python | AI agent with on-chain verification gate |

---

## 7. CLI

All three SDKs ship a CLI binary with identical command surface.

| SDK | Binary Names |
|-----|-------------|
| TypeScript | `self-agent`, `self-agent-cli` |
| Python | `self-agent` (via entry point) |
| Rust | `self-agent-cli` |

### Registration Commands

```bash
# Initialize a registration session
self-agent register init \
  --mode agent-identity \
  --human-address 0xYourWallet \
  --network testnet \
  --minimum-age 18 \
  --ofac

# Open the browser handoff URL
self-agent register open --session .self/session-abc123.json

# Wait for callback + on-chain verification
self-agent register wait --session .self/session-abc123.json

# Check session status
self-agent register status --session .self/session-abc123.json

# Export generated agent private key
self-agent register export --session .self/session-abc123.json --unsafe --print-private-key
```

### Deregistration Commands

```bash
self-agent deregister init \
  --mode agent-identity \
  --human-address 0xYourWallet \
  --agent-address 0xAgentAddr \
  --network testnet

self-agent deregister open --session .self/session-abc123.json
self-agent deregister wait --session .self/session-abc123.json
self-agent deregister status --session .self/session-abc123.json
```

### CLI Flags

**`register init` / `deregister init`:**

| Flag | Description | Required |
|------|-------------|----------|
| `--mode` | `verified-wallet`, `agent-identity`, `wallet-free`, `smart-wallet` | Yes |
| `--human-address` | Human's wallet address | For verified-wallet, agent-identity |
| `--agent-address` | Agent's wallet address | For deregister (non-verified-wallet) |
| `--network` | `mainnet` or `testnet` (default: `testnet`) | No |
| `--chain` | Custom chain ID | No |
| `--registry` | Custom registry address | No |
| `--rpc` | Custom RPC URL | No |
| `--minimum-age` | 0, 18, or 21 | No |
| `--ofac` | Request OFAC screening | No |
| `--nationality` | Request nationality disclosure | No |
| `--name` | Request name disclosure | No |
| `--date-of-birth` | Request DOB disclosure | No |
| `--gender` | Request gender disclosure | No |
| `--issuing-state` | Request issuing state disclosure | No |
| `--out` | Session file output path | No |
| `--callback-port` | Local callback port | No |
| `--ttl-minutes` | Session TTL (default: 30) | No |
| `--app-url` | Self app URL override | No |
| `--app-name` | Self app name override | No |
| `--scope` | Self scope override | No |

**`register wait` / `deregister wait`:**

| Flag | Description |
|------|-------------|
| `--session` | Path to session JSON file (required) |
| `--timeout-seconds` | Max wait time (default: 1800) |
| `--poll-ms` | Poll interval (default: 4000) |
| `--open` | Print handoff URL before waiting |
| `--no-listener` | Disable local callback server |

**`register export`:**

| Flag | Description |
|------|-------------|
| `--session` | Path to session JSON file (required) |
| `--unsafe` | Required to confirm key export |
| `--out-key` | Write key to file |
| `--print-private-key` | Print key to stdout |

### Session Schema (v1)

Sessions are persisted as JSON with restricted file permissions (0600):

```json
{
  "version": 1,
  "operation": "register",
  "sessionId": "uuid",
  "createdAt": 1708617600,
  "expiresAt": 1708619400,
  "mode": "agent-identity",
  "disclosures": { "minimumAge": 18, "ofac": true },
  "network": {
    "chainId": 11142220,
    "rpcUrl": "https://forno.celo-sepolia.celo-testnet.org",
    "registryAddress": "0x42cea1b318557ade212bed74fc3c7f06ec52bd5b",
    "endpointType": "staging_celo",
    "appUrl": "...",
    "appName": "Self Agent ID",
    "scope": "..."
  },
  "registration": {
    "humanIdentifier": "0x...",
    "agentAddress": "0x...",
    "userDefinedData": "K1...",
    "challengeHash": "0x...",
    "signature": "0x..."
  },
  "callback": {
    "listenHost": "127.0.0.1",
    "listenPort": 37142,
    "path": "/callback",
    "stateToken": "random-token",
    "used": false
  },
  "state": {
    "stage": "initialized",
    "updatedAt": 1708617600
  },
  "secrets": {
    "agentPrivateKey": "0x..."
  }
}
```

Session stages: `initialized` → `handoff_opened` → `callback_received` → `onchain_verified` (or `onchain_deregistered`) / `failed` / `expired`.

---

## 8. MCP Server

The [MCP server](https://github.com/selfxyz/self-agent-id-mcp) gives AI coding agents direct access to Self Agent ID through the [Model Context Protocol](https://modelcontextprotocol.io/). It works with Claude Code, Cursor, Windsurf, Codex, and any MCP-compatible client.

### Install

```bash
npx @selfxyz/mcp-server
```

### Configuration

**Claude Code** (`~/.claude.json` or project `.mcp.json`):

```json
{
  "mcpServers": {
    "self-agent-id": {
      "command": "npx",
      "args": ["@selfxyz/mcp-server"],
      "env": {
        "SELF_NETWORK": "mainnet"
      }
    }
  }
}
```

**Cursor / Windsurf** — same JSON format in the respective MCP configuration file.

Set `SELF_AGENT_PRIVATE_KEY` in `env` for full mode (register, sign, fetch). Omit it for query-only mode (lookup, verify).

### Tools

| Tool | Description | Key Required? |
|------|-------------|:---:|
| `self_register_agent` | Register agent with proof-of-human | No |
| `self_check_registration` | Poll registration status | No |
| `self_get_identity` | Get current agent's on-chain identity | Yes |
| `self_deregister_agent` | Revoke agent identity | Yes |
| `self_sign_request` | Generate auth headers for HTTP request | Yes |
| `self_authenticated_fetch` | Make signed HTTP request | Yes |
| `self_verify_agent` | Verify another agent's identity | No |
| `self_verify_request` | Verify incoming request headers | No |
| `self_lookup_agent` | Look up agent by on-chain ID | No |
| `self_list_agents_for_human` | List agents for a human address | No |

### Resources

| URI | Description |
|-----|-------------|
| `self://networks` | Contract addresses, chain IDs, RPC URLs |
| `self://identity` | Current agent's on-chain identity |

### Links

- **Repository**: [github.com/selfxyz/self-agent-id-mcp](https://github.com/selfxyz/self-agent-id-mcp)
- **Guide**: [MCP User Guide](https://docs.self.xyz/agent-id/guides/mcp-user)

---

## 9. REST API

Base URL: `https://self-agent-id.vercel.app` (or your deployment)

SDK default base URL can be overridden with env var `SELF_AGENT_API_BASE`.

### 9.1 Registration Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/register` | Initiate registration, generate keypair, build QR |
| GET | `/api/agent/register/qr?token=` | Retrieve QR code image URL and deep link |
| GET | `/api/agent/register/status?token=` | Poll registration status |
| POST | `/api/agent/register/callback?token=` | Receive Self app callback after passport scan |
| GET | `/api/agent/register/export?token=` | Export agent private key |

**POST `/api/agent/register`** request body:

```json
{
  "mode": "agent-identity",
  "network": "testnet",
  "humanAddress": "0x...",
  "disclosures": {
    "minimumAge": 18,
    "ofac": true
  },
  "agentName": "My Agent",
  "agentDescription": "Does things"
}
```

**Registration status stages**: `qr-ready` → `proof-received` → `pending` → `completed` / `failed`

### 9.2 Deregistration Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/agent/deregister` | Initiate deregistration |
| GET | `/api/agent/deregister/status?token=` | Poll deregistration status |
| POST | `/api/agent/deregister/callback?token=` | Receive Self app callback |

### 9.3 Query Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/agent/info/{chainId}/{agentId}` | Full agent info by ID |
| GET | `/api/agent/agents/{chainId}/{address}` | List all agents for a human address |
| GET | `/api/agent/verify/{chainId}/{agentId}` | Verification status and provider info |

**`chainId`**: `42220` (mainnet) or `11142220` (testnet)

**GET `/api/agent/info/{chainId}/{agentId}`** response:

```json
{
  "agentId": 5,
  "chainId": 11142220,
  "agentKey": "0x00000000000000000000000083fa4380903fecb801f4e123835664973001ff00",
  "agentAddress": "0x83fa4380903fecb801F4e123835664973001ff00",
  "isVerified": true,
  "proofProvider": "0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4",
  "verificationStrength": 100,
  "strengthLabel": "passport",
  "credentials": {
    "nationality": "US",
    "olderThan": 18,
    "ofac": [true, true, true]
  },
  "registeredAt": 12345678,
  "network": "testnet"
}
```

### 9.4 Discovery Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cards/{chainId}/{agentId}` | Agent metadata card (A2A) |
| GET | `/api/reputation/{chainId}/{agentId}` | Reputation score and proof type |
| GET | `/api/verify-status/{chainId}/{agentId}` | Verification status summary |

### 9.5 Demo Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/demo/verify` | Verify agent signature, return credentials |
| POST | `/api/demo/agent-to-agent` | Demo agent verifies caller, responds signed |
| POST | `/api/demo/chain-verify` | Relay EIP-712 meta-tx to AgentDemoVerifier |
| POST | `/api/demo/census` | Record agent credentials in census |
| GET | `/api/demo/census` | Read aggregate census statistics |
| POST | `/api/demo/chat` | Forward chat to LangChain with agent verification |

### 9.6 Account Abstraction Proxy

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/aa/token?chainId=` | Issue AA proxy token |
| POST | `/api/aa/bundler?chainId=` | Proxy to Pimlico bundler |
| POST | `/api/aa/paymaster?chainId=` | Proxy to Pimlico paymaster |

---

## 10. Smart Contracts

### 10.1 SelfAgentRegistry

Main ERC-721 registry. Soulbound NFTs binding agent identities to Self-verified humans.

**Key functions:**

```solidity
// Registration (IERC8004ProofOfHuman)
function registerWithHumanProof(string agentURI, address proofProvider, bytes proof, bytes providerData) returns (uint256 agentId)
function revokeHumanProof(uint256 agentId, address proofProvider, bytes proof, bytes providerData)
function verifySelfProof(bytes proofPayload, bytes userContextData) // Hub V2 async

// Query
function isVerifiedAgent(bytes32 agentKey) view returns (bool)
function getAgentId(bytes32 agentKey) view returns (uint256)
function hasHumanProof(uint256 agentId) view returns (bool)
function getHumanNullifier(uint256 agentId) view returns (uint256)
function getAgentCountForHuman(uint256 nullifier) view returns (uint256)
function sameHuman(uint256 agentIdA, uint256 agentIdB) view returns (bool)
function getProofProvider(uint256 agentId) view returns (address)
function isApprovedProvider(address provider) view returns (bool)
function getAgentCredentials(uint256 agentId) view returns (AgentCredentials)
function getAgentMetadata(uint256 agentId) view returns (string)
function agentRegisteredAt(uint256 agentId) view returns (uint256)

// Management
function guardianRevoke(uint256 agentId) // Guardian force-revoke
function selfDeregister(uint256 agentId) // NFT owner deregister
function updateAgentMetadata(uint256 agentId, string metadata) // Write card/metadata

// Admin (owner-only)
function setSelfProofProvider(address provider)
function addProofProvider(address provider)
function removeProofProvider(address provider)
function setMaxAgentsPerHuman(uint256 max)
```

**AgentCredentials struct:**

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
```

### 10.2 SelfHumanProofProvider

Metadata wrapper describing Self Protocol as a proof-of-human provider.

- `providerName()` → `"self"`
- `verificationStrength()` → `100` (passport/NFC + biometric)
- `verifyHumanProof()` — Always reverts (Self uses async Hub V2 callback)

### 10.3 AgentDemoVerifier

Demo contract for EIP-712 meta-transaction verification. Relayer submits signed typed data on behalf of the agent.

```solidity
function metaVerifyAgent(bytes32 agentKey, uint256 nonce, uint256 deadline, bytes signature) returns (uint256 agentId)
function checkAccess(bytes32 agentKey) view returns (uint256 agentId)
```

EIP-712 domain: `{name: "AgentDemoVerifier", version: "1", chainId, verifyingContract}`

### 10.4 AgentGate

Demo contract gating access behind age-verified agent identity.

```solidity
function checkAccess(bytes32 agentKey) view returns (uint256 agentId, uint256 olderThan, string nationality)
function gatedAction(bytes32 agentKey) // Requires caller = agent address
```

### 10.5 SelfReputationProvider

ERC-8004 compatible reputation scoring. Stateless view over registry.

```solidity
function getReputationScore(uint256 agentId) view returns (uint8)  // 0-100
function getReputation(uint256 agentId) view returns (uint8 score, string providerName, bool hasProof, uint256 registeredAtBlock)
function getReputationBatch(uint256[] agentIds) view returns (uint8[])
```

### 10.6 SelfValidationProvider

ERC-8004 compatible proof validation with freshness checks.

```solidity
function validateAgent(uint256 agentId) view returns (bool valid, bool fresh, uint256 registeredAt, uint256 blockAge, address proofProvider)
function isValidAgent(uint256 agentId) view returns (bool) // valid + fresh
function setFreshnessThreshold(uint256 blocks) // Owner-only (default: ~1 year)
function validateBatch(uint256[] agentIds) view returns (bool[])
```

### 10.7 LocalRegistryHarness

Test-only mock registry for CLI integration testing.

```solidity
function setAgent(bytes32 agentKey, uint256 agentId, bool isVerified)
function isVerifiedAgent(bytes32 agentKey) view returns (bool)
function getAgentId(bytes32 agentKey) view returns (uint256)
```

---

## 11. Verification Patterns

### 11.1 Agent → Service (ECDSA Middleware)

The agent signs each HTTP request with ECDSA. The service middleware recovers the signer, checks `isVerifiedAgent()` on-chain, and enforces policy.

```
Agent                          Service
  │  POST /api/data              │
  │  x-self-agent-address: 0x…  │
  │  x-self-agent-signature: 0x… │
  │  x-self-agent-timestamp: ms  │
  │──────────────────────────────▶│
  │                               │ 1. Check timestamp freshness
  │                               │ 2. Recover signer from signature
  │                               │ 3. Derive agentKey = pad(address)
  │                               │ 4. Check isVerifiedAgent(agentKey)
  │                               │ 5. Check provider, sybil, credentials
  │                               │ 6. Attach agent info to request
  │  200 OK                       │
  │◀──────────────────────────────│
```

### 11.2 Agent → Agent (Peer Verification)

Both agents verify each other's signatures and on-chain status. Use `sameHuman()` to detect sybil attacks in multi-agent systems.

### 11.3 Agent → Chain (Direct)

The agent calls a smart contract directly. The contract derives the agent key from `msg.sender` and checks the registry:

```solidity
modifier onlyVerifiedAgent() {
    bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
    require(registry.isVerifiedAgent(agentKey), "Agent not human-verified");
    _;
}
```

### 11.4 Agent → Chain (EIP-712 Meta-Transaction)

For gasless verification, a relayer submits the agent's EIP-712 typed data signature on-chain:

```
Agent                    Relayer                  Contract
  │  Sign EIP-712 data     │                        │
  │─────────────────────▶  │  metaVerifyAgent(...)   │
  │                         │───────────────────────▶│
  │                         │                        │ Recover signer
  │                         │                        │ Check registry
  │                         │                        │ Write state
  │                         │  tx receipt             │
  │  confirmation           │◀───────────────────────│
  │◀────────────────────────│
```

---

## 12. Security

### Sybil Resistance

- Each human receives a unique nullifier from their ZK proof.
- `maxAgentsPerHuman` (default: 1) limits how many agents one human can register.
- `getAgentCountForHuman(nullifier)` returns the active agent count.
- `sameHuman(agentIdA, agentIdB)` checks if two agents share a nullifier.
- SDKs default `maxAgentsPerHuman: 1` — configurable via `.sybilLimit(n)`.

### Replay Protection

- SDK verifiers cache `{signature + timestamp}` hashes (default: 10,000 entries).
- Timestamp freshness check (default: 5 minutes) prevents old signatures.
- Each agent has a monotonic nonce in the EIP-712 demo contract.

### Rate Limiting

- SDK verifiers support per-agent sliding-window rate limits.
- On-chain demo: 3 meta-tx verifications per hour per human nullifier.
- Configurable via `.rateLimit({ perMinute: 10, perHour: 100 })`.

### Provider Verification

- `requireSelfProvider: true` (default) ensures the agent was verified by Self Protocol's own provider, not a competitor.
- The verifier checks `getProofProvider(agentId)` matches `selfProofProvider()`.

### Guardians

- Wallet-free and smart-wallet modes support a guardian address.
- `guardianRevoke(agentId)` allows the guardian to force-revoke a compromised agent.
- Smart wallet guardians are passkey-controlled via ZeroDev Kernel.

### Soulbound NFTs

- Agent NFTs are non-transferable (ERC-721 `_update` override blocks transfers).
- Only mint (register) and burn (deregister) are allowed.

### CLI Security

- Private key export requires explicit `--unsafe` flag.
- Session files use restricted permissions (mode 0600).
- Callback listener binds to `127.0.0.1` only (loopback).
- Session expiry enforced before handoff/wait operations.
- Callback validation checks `sessionId` and `stateToken`.

---

## 13. Credential System

### What's Stored

Nine ZK-attested credential fields are stored on-chain per agent:

| Field | Type | Description |
|-------|------|-------------|
| `issuingState` | `string` | Passport issuing country code |
| `name` | `string[]` | Name components |
| `idNumber` | `string` | Document ID number |
| `nationality` | `string` | ISO country code |
| `dateOfBirth` | `string` | Date of birth |
| `gender` | `string` | Gender |
| `expiryDate` | `string` | Document expiry date |
| `olderThan` | `uint256` | Verified minimum age (0, 18, or 21) |
| `ofac` | `bool[3]` | OFAC screening results |

### Credential Flow

1. Human scans passport with Self app → ZK proof generated.
2. Hub V2 verifies proof → calls registry callback.
3. Registry extracts disclosures from proof output → stores as `AgentCredentials`.
4. SDKs query credentials via `getAgentCredentials(agentId)`.
5. Verifier middleware optionally checks age, OFAC, nationality.

### Querying Credentials

**On-chain:**

```solidity
AgentCredentials memory creds = registry.getAgentCredentials(agentId);
require(creds.olderThan >= 18, "Must be 18+");
```

**SDK (TypeScript):**

```typescript
const creds = await agent.getCredentials();
console.log(creds.nationality, creds.olderThan);
```

**REST API:**

```
GET /api/agent/info/{chainId}/{agentId}
→ response.credentials.nationality, response.credentials.olderThan
```

---

## 14. Discovery & Lookup

### On-Chain Queries

```solidity
// Check if agent is verified
bool verified = registry.isVerifiedAgent(agentKey);

// Get agent ID from public key
uint256 agentId = registry.getAgentId(agentKey);

// Check if two agents are the same human
bool same = registry.sameHuman(agentIdA, agentIdB);

// Get registration block
uint256 block = registry.agentRegisteredAt(agentId);

// Read metadata (agent card JSON)
string memory metadata = registry.getAgentMetadata(agentId);
```

### REST API Queries

```
GET /api/agent/info/{chainId}/{agentId}       → Full agent info
GET /api/agent/agents/{chainId}/{address}     → All agents for human
GET /api/agent/verify/{chainId}/{agentId}     → Verification status
GET /api/cards/{chainId}/{agentId}            → Agent card metadata
GET /api/reputation/{chainId}/{agentId}       → Reputation score
GET /api/verify-status/{chainId}/{agentId}    → Proof status
```

### A2A Agent Cards

Cards follow the Agent-to-Agent (A2A) format with a `selfProtocol` extension. Stored on-chain via `updateAgentMetadata()`. Can be read via:

```typescript
const card = await agent.getAgentCard();
// or
const uri = await agent.toAgentCardDataURI();
```

---

## Appendix: Repo Layout

```
self-agent-id/
├── app/                  # Next.js web app + REST API
│   ├── app/              # Pages and API routes
│   │   ├── api/          # REST API (agent/, demo/, aa/, cards/, reputation/)
│   │   ├── register/     # Registration flow pages
│   │   ├── explainer/    # Technical explainer page
│   │   ├── api-docs/     # API documentation page
│   │   ├── cli/          # CLI documentation + browser handoff
│   │   ├── demo/         # Live demo page
│   │   └── erc8004/      # ERC-8004 spec page
│   └── lib/              # Shared utilities (network.ts, snippets.ts)
├── sdk/                  # TypeScript SDK
│   └── src/              # SelfAgent, SelfAgentVerifier, CLI, registration
├── python-sdk/           # Python SDK
│   └── src/self_agent_sdk/  # agent, verifier, middleware, CLI
├── rust-sdk/             # Rust SDK
│   └── src/              # agent, verifier, middleware, CLI binary
├── contracts/            # Solidity contracts (Foundry)
│   ├── src/              # Registry, providers, demo contracts, interfaces
│   └── test/             # Foundry tests
├── functions/            # Demo Cloud Functions
└── docs/                 # Integration guides, CLI spec
```

## Additional Documentation

- `docs/SELF_PROTOCOL_INTEGRATION.md` — Self Protocol integration guide
- `docs/CLI_REGISTRATION_SPEC.md` — CLI command specification
- `docs/CLI_REGISTRATION_GUIDE.md` — Human + agent-guided registration workflows
