# Self Agent ID

[![npm](https://img.shields.io/npm/v/@selfxyz/agent-sdk?label=npm)](https://www.npmjs.com/package/@selfxyz/agent-sdk)
[![PyPI](https://img.shields.io/pypi/v/selfxyz-agent-sdk?label=pypi)](https://pypi.org/project/selfxyz-agent-sdk/)
[![crates.io](https://img.shields.io/crates/v/self-agent-sdk?label=crates.io)](https://crates.io/crates/self-agent-sdk)
[![MCP](https://img.shields.io/badge/MCP-remote-blue)](https://app.ai.self.xyz/api/mcp)
[![License: BUSL--1.1](https://img.shields.io/badge/license-BUSL--1.1-blue.svg)](LICENSE)

Proof-of-human identity for AI agents on Celo.

- **Live**: [app.ai.self.xyz](https://app.ai.self.xyz)
- **Standard**: [ERC-8004 Proof-of-Human extension](https://eips.ethereum.org/EIPS/eip-8004)
- **SDKs**: TypeScript, Python, Rust — identical feature parity
- **Docs**: [docs.self.xyz/agent-id](https://docs.self.xyz/agent-id)

## Quick Start

### Install

```bash
npm install @selfxyz/agent-sdk    # TypeScript
pip install selfxyz-agent-sdk      # Python
cargo add self-agent-sdk           # Rust
```

### Register an Agent

Agents need a human-backed identity before they can make authenticated requests. Registration binds an agent keypair to a human's passport via a ZK proof.

**Option A — Web UI**: Visit [app.ai.self.xyz/register](https://app.ai.self.xyz/register) and follow the guided flow.

**Option B — CLI** (all three SDKs ship the same CLI):

```bash
self-agent register init --mode agent-identity --human-address 0xYourWallet --network testnet
self-agent register open --session .self/session.json   # Opens browser handoff
self-agent register wait --session .self/session.json   # Polls until on-chain
self-agent register export --session .self/session.json --unsafe --print-private-key
```

**Option C — REST API** (for programmatic/agent-guided flows):

```typescript
import { requestRegistration } from "@selfxyz/agent-sdk";

const session = await requestRegistration({
  mode: "agent-identity",
  network: "testnet",
  humanAddress: "0xYourWallet",
  disclosures: { minimumAge: 18, ofac: true },
  agentName: "My Agent",
});
// session.qrUrl → show QR to human
// session.sessionToken → poll status with GET /api/agent/register/status
```

### Agent-Side (Sign Requests)

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey: process.env.AGENT_PRIVATE_KEY! });
const res = await agent.fetch("https://api.example.com/protected", {
  method: "POST",
  body: JSON.stringify({ ping: true }),
});
```

### Service-Side (Verify Agents)

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .requireAge(18)
  .requireOFAC()
  .sybilLimit(3)
  .build();

app.use("/api", verifier.auth());
```

### Prerequisites

1. Success-path verification requires an agent key that is already registered on-chain.
2. If the key is not registered, a protected request will fail with `401 Agent not verified on-chain`.
3. Ensure signer network matches verifier network (`mainnet` vs `testnet`) before debugging signatures.

---

## Integration Guides

| I want to...                     | Guide                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| Build an AI agent with identity  | [Agent Builder Guide](https://docs.self.xyz/agent-id/guides/agent-builder)           |
| Verify agent requests in my API  | [Service Operator Guide](https://docs.self.xyz/agent-id/guides/service-operator)     |
| Gate smart contracts by agent ID | [Contract Developer Guide](https://docs.self.xyz/agent-id/guides/contract-developer) |
| Use MCP with Claude/Cursor       | [MCP Guide](https://docs.self.xyz/agent-id/guides/mcp-user)                          |

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
│  │ Registry    │ │  Registry    │ │  (DemoVerifier, Gate)   │      │
│  └─────────────┘ └──────────────┘ └────────────────────────┘      │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    SDKs (TS / Python / Rust)                 │   │
│  │  Agent-side: SelfAgent / Ed25519Agent (signing, fetch)      │   │
│  │  Service-side: SelfAgentVerifier (middleware, policy)        │   │
│  │  CLI: register / deregister workflows                       │   │
│  │  REST: requestRegistration / requestDeregistration           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    MCP Server (@selfxyz/mcp-server)          │   │
│  │  10 tools: register, verify, sign, discover, fetch          │   │
│  │  Works with Claude Code / Cursor / Windsurf / Codex         │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Discovery & A2A Protocol                  │   │
│  │  /.well-known/agent-card.json · llms.txt · A2A JSON-RPC     │   │
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

| Contract               | Address                                      |
| ---------------------- | -------------------------------------------- |
| SelfAgentRegistry      | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` |
| SelfHumanProofProvider | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` |
| SelfReputationRegistry | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` |
| SelfValidationRegistry | `0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577` |
| AgentDemoVerifier      | `0xD8ec054FD869A762bC977AC328385142303c7def` |
| AgentGate              | `0x26e05bF632fb5bACB665ab014240EAC1413dAE35` |
| Hub V2                 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` |

- RPC: `https://forno.celo.org`
- Block Explorer: `https://celoscan.io`
- Self Endpoint Type: `celo`

### Celo Sepolia Testnet (Chain ID: 11142220)

| Contract               | Address                                      |
| ---------------------- | -------------------------------------------- |
| SelfAgentRegistry      | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| SelfHumanProofProvider | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |
| SelfReputationRegistry | `0x3Bb0A898C1C0918763afC22ff624131b8F420CC2` |
| SelfValidationRegistry | `0x84cA20B8A1559F136dA03913dbe6A7F68B6B240B` |
| AgentDemoVerifier      | `0xc31BAe8f2d7FCd19f737876892f05d9bDB294241` |
| AgentGate              | `0x86Af07e30Aa42367cbcA7f2B1764Be346598bbc2` |
| Hub V2                 | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |

- RPC: `https://forno.celo-sepolia.celo-testnet.org`
- Block Explorer: `https://celo-sepolia.blockscout.com`
- Self Endpoint Type: `staging_celo`

> **Important**: Celo Sepolia chain ID is **11142220**, not 44787 (deprecated Alfajores).

---

## 4. Registration

### 4.1 Registration Modes

#### Verified Wallet (`verified-wallet`)

The human's wallet address is the agent identity. Best for human-operated on-chain gating.

- **Agent key**: `bytes32(uint256(uint160(humanAddress)))`
- **NFT owner**: Human wallet
- **Guardian**: None (human controls wallet directly)
- **Use case**: Human-operated agents, DeFi gating, DAO membership

#### Agent Identity (`agent-identity`)

Dedicated generated agent keypair. The human proves ownership via Self, then the agent operates independently. Recommended for autonomous agents.

- **Agent key**: `bytes32(uint256(uint160(agentAddress)))`
- **NFT owner**: Human wallet (creator)
- **Guardian**: None
- **Challenge**: Agent signs `keccak256("self-agent-id:register:" + humanAddress + chainId + registryAddress + nonce)`
- **Use case**: Autonomous AI agents, API bots, server-side agents

#### Wallet-Free (`wallet-free`)

No user wallet required. Agent keypair is generated locally and the agent-owned NFT is minted directly.

- **Agent key**: `bytes32(uint256(uint160(agentAddress)))`
- **NFT owner**: Agent address (self-owned)
- **Guardian**: Optional address for compromise recovery
- **Challenge**: Same as agent-identity mode
- **Use case**: Embedded agents, IoT devices, CLI-only workflows

#### Smart Wallet (`smart-wallet`)

Passkey-based smart wallet as guardian + dedicated agent keypair. Uses ZeroDev Kernel + Pimlico bundler/paymaster.

- **Agent key**: `bytes32(uint256(uint160(agentAddress)))`
- **NFT owner**: Agent address (self-owned)
- **Guardian**: Smart wallet address (passkey-controlled)
- **Challenge**: Same as agent-identity mode
- **Use case**: Consumer-facing agents, gasless UX, passkey-based recovery

> Smart wallet mode manages guardian actions with passkeys, but agents still use their own ECDSA key for API request signing.

### 4.2 Agent-Guided Registration Flow

For programmatic registration (chatbots, agent frameworks, fleet management), use the REST API-based flow. The agent backend orchestrates the entire process without requiring the human to visit a web UI directly.

**Flow:**

```
Agent Backend                    Human                     Self App / On-Chain
     │                            │                              │
     │  1. POST /api/agent/register                              │
     │────────────────────────────────────────────────────────────▶
     │  ◀── sessionToken + qrUrl                                 │
     │                            │                              │
     │  2. Show QR code to human  │                              │
     │───────────────────────────▶│                              │
     │                            │  3. Scan passport in Self app│
     │                            │─────────────────────────────▶│
     │                            │                              │
     │  4. Poll GET /api/agent/register/status                   │
     │────────────────────────────────────────────────────────────▶
     │  ◀── stage: qr-ready → proof-received → pending → completed
     │                            │                              │
     │  5. Agent is now registered on-chain                      │
```

**SDK helpers** (all three SDKs):

```typescript
import { requestRegistration } from "@selfxyz/agent-sdk";

// Step 1: Initiate registration
const session = await requestRegistration({
  mode: "agent-identity",
  network: "testnet",
  humanAddress: "0x...",
  disclosures: { minimumAge: 18, ofac: true },
  agentName: "My Bot",
  agentDescription: "Answers questions about crypto markets",
});

// Step 2: Present QR to human (session.qrUrl)
// Step 3: Poll status until completed
// Step 4: Use the returned agent private key
```

```python
from self_agent_sdk import request_registration

session = request_registration(
    mode="agent-identity",
    network="testnet",
    human_address="0x...",
    disclosures={"minimum_age": 18, "ofac": True},
)
```

**CLI orchestration** (recommended for agent backends that shell out):

```bash
# 1. Initialize — generates keypair, builds QR, writes session file
self-agent register init --mode agent-identity --human-address 0x... --network testnet

# 2. Open browser handoff URL (or extract URL from session JSON to show inline)
self-agent register open --session .self/session.json

# 3. Wait for human to scan passport → on-chain verification
self-agent register wait --session .self/session.json

# 4. Export the agent private key
self-agent register export --session .self/session.json --unsafe --print-private-key
```

Session stages: `initialized` → `handoff_opened` → `callback_received` → `onchain_verified` / `failed` / `expired`.

### 4.3 Verification Configs

Six verification configurations combine age requirements with OFAC sanctions screening. The config is selected at registration time via the `userDefinedData[1]` byte.

| Config Index | Minimum Age | OFAC Screening | `userDefinedData[1]` |
| :----------: | :---------: | :------------: | :------------------: |
|      0       |    None     |      Off       |        `'0'`         |
|      1       |     18      |      Off       |        `'1'`         |
|      2       |     21      |      Off       |        `'2'`         |
|      3       |    None     |       On       |        `'3'`         |
|      4       |     18      |       On       |        `'4'`         |
|      5       |     21      |       On       |        `'5'`         |

The `userDefinedData[0]` byte encodes the action type:

| Byte  | Action                            |
| :---: | --------------------------------- |
| `'R'` | Simple register                   |
| `'D'` | Simple deregister                 |
| `'K'` | Advanced register (agent keypair) |
| `'X'` | Advanced deregister               |
| `'W'` | Wallet-free register              |

> **Warning — `userDefinedData` encoding**: The Self SDK passes `userDefinedData` as a **UTF-8 string**, not raw bytes. Each byte position uses the ASCII character (e.g., `'0'` not `0x00`). Use `bytes32(bytes1(uint8(x)))` for byte positioning in Solidity. This is the #1 integration mistake — see [Troubleshooting](https://docs.self.xyz/agent-id/troubleshooting) for details.

### 4.4 Deregistration

```bash
self-agent deregister init --mode agent-identity --human-address 0x... --agent-address 0x... --network testnet
self-agent deregister open --session .self/session.json
self-agent deregister wait --session .self/session.json
```

Or via SDK:

```typescript
await agent.requestDeregistration({
  mode: "agent-identity",
  network: "testnet",
});
```

---

## 5. SDKs

### Package Names

| Language   | Package              | Install                          |
| ---------- | -------------------- | -------------------------------- |
| TypeScript | `@selfxyz/agent-sdk` | `npm install @selfxyz/agent-sdk` |
| Python     | `selfxyz-agent-sdk`  | `pip install selfxyz-agent-sdk`  |
| Rust       | `self-agent-sdk`     | `cargo add self-agent-sdk`       |

All three SDKs export the same core classes with language-idiomatic naming.

### 5.1 Agent-Side: `SelfAgent` (ECDSA) / `Ed25519Agent`

Both key types produce authenticated HTTP requests with the same header protocol. Choose based on your ecosystem:

| Feature             | `SelfAgent` (ECDSA)        | `Ed25519Agent`             |
| ------------------- | -------------------------- | -------------------------- |
| Ecosystem           | Ethereum, EVM chains       | Python, Rust, Solana, SSH  |
| Key format          | `0x`-prefixed 66 hex chars | 64 hex chars (no `0x`)     |
| On-chain verify gas | ~3K                        | ~456K                      |
| Registration        | EIP-712 or wallet-free     | Ed25519 challenge-response |
| SDK class           | `SelfAgent`                | `Ed25519Agent`             |

**ECDSA (TypeScript):**

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  network: "mainnet",
});

const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "test" }),
});
```

**Ed25519 (TypeScript):**

```typescript
import { Ed25519Agent } from "@selfxyz/agent-sdk";

const agent = new Ed25519Agent({
  privateKey: process.env.ED25519_SEED!, // 64-char hex, no 0x
  network: "mainnet",
});

const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "test" }),
});
```

**Python:**

```python
from self_agent_sdk import SelfAgent, Ed25519Agent
import os

# ECDSA
agent = SelfAgent(private_key=os.environ["AGENT_PRIVATE_KEY"], network="mainnet")

# Ed25519
agent = Ed25519Agent(private_key=os.environ["ED25519_SEED"], network="mainnet")

res = agent.fetch("https://api.example.com/data", method="POST", body='{"query": "test"}')
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
```

#### SelfAgent Methods (All SDKs)

| Method                              | Description                                 |
| ----------------------------------- | ------------------------------------------- |
| `isRegistered()`                    | Check if agent is verified on-chain         |
| `getInfo()`                         | Full agent info: ID, nullifier, sybil count |
| `signRequest(method, url, body?)`   | Generate auth headers (3 headers)           |
| `fetch(url, options)`               | Auto-signed HTTP request                    |
| `getCredentials()`                  | Read ZK-attested credentials from on-chain  |
| `getVerificationStrength()`         | Provider verification strength (0-100)      |
| `getAgentCard()`                    | Read A2A agent card from on-chain metadata  |
| `setAgentCard(fields)`              | Write agent card to on-chain metadata       |
| `toAgentCardDataURI()`              | Generate base64 data URI for card           |
| `requestRegistration(opts)`         | Initiate registration via REST API (static) |
| `requestDeregistration(opts?)`      | Initiate deregistration via REST API        |
| `getAgentInfo(agentId, opts?)`      | Query agent info by ID (static)             |
| `getAgentsForHuman(address, opts?)` | Get all agents for a human (static)         |

#### Auth Headers

Every signed request includes three headers:

| Header                   | Value                                                          |
| ------------------------ | -------------------------------------------------------------- |
| `x-self-agent-address`   | Agent's Ethereum address                                       |
| `x-self-agent-signature` | Signature of `keccak256(timestamp + METHOD + path + bodyHash)` |
| `x-self-agent-timestamp` | Unix timestamp in milliseconds                                 |

> **Critical integration note**: verify against the exact request bytes received by your server. If middleware rewrites or reserializes JSON before verification, signatures can fail even when the client is correct.

### 5.2 Service-Side: `SelfAgentVerifier`

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

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle(Extension(agent): Extension<VerifiedAgent>) -> Json<serde_json::Value> {
    println!("Verified agent: {:?}", agent.address);
    Json(serde_json::json!({ "ok": true }))
}
```

#### VerifierBuilder Methods (All SDKs)

| Method                          | Description                                |
| ------------------------------- | ------------------------------------------ |
| `create()`                      | Factory — returns chainable builder        |
| `fromConfig(cfg)`               | Create from flat config object             |
| `.network(name)`                | Set network (`"mainnet"` / `"testnet"`)    |
| `.registry(addr)`               | Custom registry address                    |
| `.rpc(url)`                     | Custom RPC URL                             |
| `.requireAge(n)`                | Minimum age requirement (18 or 21)         |
| `.requireOFAC()`                | Require OFAC sanctions pass                |
| `.requireNationality(...codes)` | Allowed ISO country codes                  |
| `.requireSelfProvider()`        | Require Self Protocol as proof provider    |
| `.sybilLimit(n)`                | Max agents per human (0 = unlimited)       |
| `.rateLimit(config)`            | Per-agent rate limiting                    |
| `.replayProtection(enabled?)`   | Toggle replay detection                    |
| `.includeCredentials()`         | Include credentials in verification result |
| `.maxAge(ms)`                   | Max timestamp age (default: 5 min)         |
| `.cacheTtl(ms)`                 | On-chain cache TTL (default: 1 min)        |
| `.build()`                      | Build the verifier instance                |

#### Verification Security Chain

The verifier performs these checks in order:

1. Timestamp freshness (max 5 minutes old)
2. ECDSA/Ed25519 signature recovery
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

| Setting               | Default          |
| --------------------- | ---------------- |
| `requireSelfProvider` | `true`           |
| `maxAgentsPerHuman`   | `1`              |
| `replayProtection`    | `true`           |
| `maxAgeMs`            | `300000` (5 min) |
| `cacheTtlMs`          | `60000` (1 min)  |
| `includeCredentials`  | `false`          |

### 5.3 Registration Utilities

All SDKs export registration helper functions:

| Function                                           | Description                                           |
| -------------------------------------------------- | ----------------------------------------------------- |
| `getRegistrationConfigIndex(disclosures?)`         | Maps age/OFAC flags to config digit (0-5)             |
| `computeRegistrationChallengeHash(input)`          | Keccak256 of challenge material                       |
| `signRegistrationChallenge(privateKey, input)`     | Sign challenge, return r/s/v components               |
| `buildSimpleRegisterUserDataAscii(disclosures?)`   | Returns `"R" + configDigit`                           |
| `buildSimpleDeregisterUserDataAscii(disclosures?)` | Returns `"D" + configDigit`                           |
| `buildAdvancedRegisterUserDataAscii(params)`       | Returns `"K" + config + address + r + s + v`          |
| `buildAdvancedDeregisterUserDataAscii(params)`     | Returns `"X" + config + address`                      |
| `buildWalletFreeRegisterUserDataAscii(params)`     | Returns `"W" + config + agent + guardian + r + s + v` |

---

## 6. CLI

All three SDKs ship a CLI binary with identical command surface.

| SDK        | Binary Names                   |
| ---------- | ------------------------------ |
| TypeScript | `self-agent`, `self-agent-cli` |
| Python     | `self-agent` (via entry point) |
| Rust       | `self-agent-cli`               |

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

| Flag              | Description                                                        | Required                             |
| ----------------- | ------------------------------------------------------------------ | ------------------------------------ |
| `--mode`          | `verified-wallet`, `agent-identity`, `wallet-free`, `smart-wallet` | Yes                                  |
| `--human-address` | Human's wallet address                                             | For verified-wallet, agent-identity  |
| `--agent-address` | Agent's wallet address                                             | For deregister (non-verified-wallet) |
| `--network`       | `mainnet` or `testnet` (default: `testnet`)                        | No                                   |
| `--chain`         | Custom chain ID                                                    | No                                   |
| `--registry`      | Custom registry address                                            | No                                   |
| `--rpc`           | Custom RPC URL                                                     | No                                   |
| `--minimum-age`   | 0, 18, or 21                                                       | No                                   |
| `--ofac`          | Request OFAC screening                                             | No                                   |
| `--nationality`   | Request nationality disclosure                                     | No                                   |
| `--name`          | Request name disclosure                                            | No                                   |
| `--date-of-birth` | Request DOB disclosure                                             | No                                   |
| `--gender`        | Request gender disclosure                                          | No                                   |
| `--issuing-state` | Request issuing state disclosure                                   | No                                   |
| `--out`           | Session file output path                                           | No                                   |
| `--callback-port` | Local callback port                                                | No                                   |
| `--ttl-minutes`   | Session TTL (default: 30)                                          | No                                   |
| `--app-url`       | Self app URL override                                              | No                                   |
| `--app-name`      | Self app name override                                             | No                                   |
| `--scope`         | Self scope override                                                | No                                   |

**`register wait` / `deregister wait`:**

| Flag                | Description                          |
| ------------------- | ------------------------------------ |
| `--session`         | Path to session JSON file (required) |
| `--timeout-seconds` | Max wait time (default: 1800)        |
| `--poll-ms`         | Poll interval (default: 4000)        |
| `--open`            | Print handoff URL before waiting     |
| `--no-listener`     | Disable local callback server        |

**`register export`:**

| Flag                  | Description                          |
| --------------------- | ------------------------------------ |
| `--session`           | Path to session JSON file (required) |
| `--unsafe`            | Required to confirm key export       |
| `--out-key`           | Write key to file                    |
| `--print-private-key` | Print key to stdout                  |

### Session Schema (v1)

Sessions are persisted as JSON with restricted file permissions (0600):

```json
{
  "version": 1,
  "operation": "register",
  "sessionId": "uuid",
  "createdAt": 1708617600,
  "expiresAt": 1708619400,
  "mode": "linked",
  "disclosures": { "minimumAge": 18, "ofac": true },
  "network": {
    "chainId": 11142220,
    "rpcUrl": "https://forno.celo-sepolia.celo-testnet.org",
    "registryAddress": "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
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

## 7. Discovery & A2A Protocol

### Well-Known Endpoints

| Endpoint                          | Description                                                      |
| --------------------------------- | ---------------------------------------------------------------- |
| `/.well-known/agent-card.json`    | A2A v0.3.0 agent card (supports `?agentId=&chain=` query params) |
| `/.well-known/self-agent-id.json` | Agent discovery metadata with CORS                               |
| `/.well-known/a2a/{agentId}`      | Redirects to `/api/cards/{chainId}/{agentId}`                    |
| `/llms.txt`                       | LLM-readable agent discovery text (1-hour cache)                 |

### A2A (Agent-to-Agent) Protocol

The `/api/a2a` endpoint implements JSON-RPC 2.0 for task-based agent communication:

- **Natural language agent lookup** — ask "is this agent human-verified?" in plain text
- **Task management** — create, poll, and complete verification tasks
- **Push notifications** — webhook delivery for task status updates
- **Registration intents** — detect "register" commands and generate QR codes inline

### Agent Cards

Standardized metadata for agent-to-agent discovery, stored on-chain via `updateAgentMetadata()`:

```json
{
  "a2aVersion": "0.1",
  "name": "My Agent",
  "description": "Analyzes data",
  "url": "https://myagent.example.com",
  "skills": [{ "name": "data-analysis", "description": "Analyzes CSV data" }],
  "selfProtocol": {
    "agentId": 5,
    "registry": "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
    "chainId": 42220,
    "proofProvider": "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
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

**Read/write agent cards via SDK:**

```typescript
await agent.setAgentCard({
  name: "My Agent",
  description: "Does useful things",
  skills: [{ name: "data-analysis" }],
});
const card = await agent.getAgentCard();
const uri = await agent.toAgentCardDataURI(); // base64 data URI
```

### REST API Discovery Endpoints

```
GET /api/cards/{chainId}/{agentId}            → Agent card metadata (A2A format)
GET /api/reputation/{chainId}/{agentId}       → Reputation score and proof type
GET /api/verify-status/{chainId}/{agentId}    → Verification status summary
GET /api/agent/info/{chainId}/{agentId}       → Full agent info
GET /api/agent/agents/{chainId}/{address}     → All agents for a human address
GET /api/agent/verify/{chainId}/{agentId}     → Verification status and provider info
```

### On-Chain Queries

```solidity
bool verified = registry.isVerifiedAgent(agentKey);
uint256 agentId = registry.getAgentId(agentKey);
bool same = registry.sameHuman(agentIdA, agentIdB);
string memory metadata = registry.getAgentMetadata(agentId);
```

---

## 8. MCP Server

The [MCP server](https://github.com/selfxyz/self-agent-id-mcp) gives AI coding agents direct access to Self Agent ID through the [Model Context Protocol](https://modelcontextprotocol.io/). It works with Claude Code, Cursor, Windsurf, Codex, and any MCP-compatible client.

### Remote MCP (Streamable HTTP)

Connect any MCP-compatible client directly via URL — no local install required:

```json
{
  "mcpServers": {
    "self-agent-id": {
      "url": "https://app.ai.self.xyz/api/mcp"
    }
  }
}
```

Works with Claude Desktop, Cursor, Windsurf, and any client supporting Streamable HTTP transport.

### Local MCP (stdio)

For local/offline use, run the MCP server directly:

```bash
npx @selfxyz/mcp-server
```

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

| Tool                         | Description                            | Key Required? |
| ---------------------------- | -------------------------------------- | :-----------: |
| `self_register_agent`        | Register agent with proof-of-human     |      No       |
| `self_check_registration`    | Poll registration status               |      No       |
| `self_get_identity`          | Get current agent's on-chain identity  |      Yes      |
| `self_deregister_agent`      | Revoke agent identity                  |      Yes      |
| `self_sign_request`          | Generate auth headers for HTTP request |      Yes      |
| `self_authenticated_fetch`   | Make signed HTTP request               |      Yes      |
| `self_verify_agent`          | Verify another agent's identity        |      No       |
| `self_verify_request`        | Verify incoming request headers        |      No       |
| `self_lookup_agent`          | Look up agent by on-chain ID           |      No       |
| `self_list_agents_for_human` | List agents for a human address        |      No       |

### Resources

| URI               | Description                             |
| ----------------- | --------------------------------------- |
| `self://networks` | Contract addresses, chain IDs, RPC URLs |
| `self://identity` | Current agent's on-chain identity       |

### Links

- **Repository**: [github.com/selfxyz/self-agent-id-mcp](https://github.com/selfxyz/self-agent-id-mcp)
- **Guide**: [MCP User Guide](https://docs.self.xyz/agent-id/guides/mcp-user)

---

## 9. REST API

Base URL: `https://app.ai.self.xyz` (or your deployment)

SDK default base URL can be overridden with env var `SELF_AGENT_API_BASE`.

### 9.1 Registration Endpoints

| Method | Path                                  | Description                                        |
| ------ | ------------------------------------- | -------------------------------------------------- |
| POST   | `/api/agent/register`                 | Initiate registration, generate keypair, build QR  |
| GET    | `/api/agent/register/qr`              | Retrieve QR code data and deep link (Bearer token) |
| GET    | `/api/agent/register/status`          | Poll registration status (Bearer token)            |
| POST   | `/api/agent/register/callback?token=` | Receive Self app callback after passport scan      |
| POST   | `/api/agent/register/export`          | Export agent private key                           |

**POST `/api/agent/register`** request body:

```json
{
  "mode": "linked",
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

| Method | Path                                    | Description                               |
| ------ | --------------------------------------- | ----------------------------------------- |
| POST   | `/api/agent/deregister`                 | Initiate deregistration                   |
| GET    | `/api/agent/deregister/status`          | Poll deregistration status (Bearer token) |
| POST   | `/api/agent/deregister/callback?token=` | Receive Self app callback                 |

### 9.3 Query Endpoints

| Method | Path                                    | Description                           |
| ------ | --------------------------------------- | ------------------------------------- |
| GET    | `/api/agent/info/{chainId}/{agentId}`   | Full agent info by ID                 |
| GET    | `/api/agent/agents/{chainId}/{address}` | List all agents for a human address   |
| GET    | `/api/agent/verify/{chainId}/{agentId}` | Verification status and provider info |

**`chainId`**: `42220` (mainnet) or `11142220` (testnet)

**GET `/api/agent/info/{chainId}/{agentId}`** response:

```json
{
  "agentId": 5,
  "chainId": 11142220,
  "agentKey": "0x00000000000000000000000083fa4380903fecb801f4e123835664973001ff00",
  "agentAddress": "0x83fa4380903fecb801F4e123835664973001ff00",
  "isVerified": true,
  "proofProvider": "0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c",
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

| Method | Path                                     | Description                     |
| ------ | ---------------------------------------- | ------------------------------- |
| GET    | `/api/cards/{chainId}/{agentId}`         | Agent metadata card (A2A)       |
| GET    | `/api/reputation/{chainId}/{agentId}`    | Reputation score and proof type |
| GET    | `/api/verify-status/{chainId}/{agentId}` | Verification status summary     |

### 9.5 Demo Endpoints

| Method | Path                       | Description                                       |
| ------ | -------------------------- | ------------------------------------------------- |
| POST   | `/api/demo/verify`         | Verify agent signature, return credentials        |
| POST   | `/api/demo/agent-to-agent` | Demo agent verifies caller, responds signed       |
| POST   | `/api/demo/chain-verify`   | Relay EIP-712 meta-tx to AgentDemoVerifier        |
| POST   | `/api/demo/census`         | Record agent credentials in census                |
| GET    | `/api/demo/census`         | Read aggregate census statistics                  |
| POST   | `/api/demo/chat`           | Forward chat to LangChain with agent verification |

### 9.6 Account Abstraction Proxy

| Method | Path                         | Description                |
| ------ | ---------------------------- | -------------------------- |
| POST   | `/api/aa/token?chainId=`     | Issue AA proxy token       |
| POST   | `/api/aa/bundler?chainId=`   | Proxy to Pimlico bundler   |
| POST   | `/api/aa/paymaster?chainId=` | Proxy to Pimlico paymaster |

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

### 10.3 SelfReputationRegistry

ERC-8004 compatible reputation scoring. Stateless view over registry.

```solidity
function getReputationScore(uint256 agentId) view returns (uint8)  // 0-100
function getReputation(uint256 agentId) view returns (uint8 score, string providerName, bool hasProof, uint256 registeredAtBlock)
function getReputationBatch(uint256[] agentIds) view returns (uint8[])
```

### 10.4 SelfValidationRegistry

ERC-8004 compatible proof validation with freshness checks.

```solidity
function validateAgent(uint256 agentId) view returns (bool valid, bool fresh, uint256 registeredAt, uint256 blockAge, address proofProvider)
function isValidAgent(uint256 agentId) view returns (bool) // valid + fresh
function setFreshnessThreshold(uint256 blocks) // Owner-only (default: ~1 year)
function validateBatch(uint256[] agentIds) view returns (bool[])
```

### 10.5 AgentDemoVerifier

Demo contract for EIP-712 meta-transaction verification. Relayer submits signed typed data on behalf of the agent.

```solidity
function metaVerifyAgent(bytes32 agentKey, uint256 nonce, uint256 deadline, bytes signature) returns (uint256 agentId)
function checkAccess(bytes32 agentKey) view returns (uint256 agentId)
```

EIP-712 domain: `{name: "AgentDemoVerifier", version: "1", chainId, verifyingContract}`

### 10.6 AgentGate

Demo contract gating access behind age-verified agent identity.

```solidity
function checkAccess(bytes32 agentKey) view returns (uint256 agentId, uint256 olderThan, string nationality)
function gatedAction(bytes32 agentKey) // Requires caller = agent address
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

### 11.1 Agent → Service (Middleware)

The agent signs each HTTP request. The service middleware recovers the signer, checks `isVerifiedAgent()` on-chain, and enforces policy.

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

### Verification Failure Drills (Recommended)

Use these deterministic checks to validate your service integration:

1. Tamper drill: sign body `A`, send body `B` with the same auth headers. Expected: signature failure (`401 Invalid signature`).
2. Expired drill: send a timestamp older than your configured `maxAge`. Expected: freshness failure (`401 Timestamp expired or invalid`).
3. Replay drill: submit the exact same signed request twice. Expected: first accepted, second rejected when replay protection is enabled.

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

| Field          | Type       | Description                         |
| -------------- | ---------- | ----------------------------------- |
| `issuingState` | `string`   | Passport issuing country code       |
| `name`         | `string[]` | Name components                     |
| `idNumber`     | `string`   | Document ID number                  |
| `nationality`  | `string`   | ISO country code                    |
| `dateOfBirth`  | `string`   | Date of birth                       |
| `gender`       | `string`   | Gender                              |
| `expiryDate`   | `string`   | Document expiry date                |
| `olderThan`    | `uint256`  | Verified minimum age (0, 18, or 21) |
| `ofac`         | `bool[3]`  | OFAC screening results              |

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

## 13.1 Proof Expiry & Refresh

Human proofs have a limited validity period. The on-chain `proofExpiresAt` timestamp is set at registration time as:

```
proofExpiresAt = min(passport_document_expiry, block.timestamp + maxProofAge)
```

- **`maxProofAge`** defaults to **365 days** (configurable by the registry owner via `setMaxProofAge()`).
- **`isProofFresh(agentId)`** returns `true` only if `block.timestamp < proofExpiresAt[agentId]`.
- **`hasHumanProof(agentId)`** returns `true` as long as the proof exists (regardless of expiry) — use `isProofFresh()` for time-sensitive checks.
- **`proofExpiresAt(agentId)`** returns the raw expiry timestamp (unix seconds).

### Checking Expiry (SDK)

```typescript
// TypeScript SDK — check if proof is expiring soon
const info = await agent.getInfo();
const expiresAt = info.proofExpiresAt; // unix timestamp (seconds)
const THIRTY_DAYS = 30 * 24 * 60 * 60;
if (expiresAt > 0 && expiresAt - Math.floor(Date.now() / 1000) < THIRTY_DAYS) {
  console.warn("Proof expiring soon — consider refreshing registration");
}
```

### Refreshing an Expired Proof

There is no in-place "refresh" function. To renew an expired proof, the agent must **deregister and re-register**:

1. **Deregister** — call `self_deregister_agent` (MCP), `agent.requestDeregistration()` (SDK), or the CLI `deregister` flow. This burns the soulbound NFT and clears all on-chain state.
2. **Re-register** — initiate a new registration with the same agent key. The human scans their passport again via the Self app. A new agentId is minted with a fresh `proofExpiresAt`.

The old agentId is permanently burned. The new agentId is monotonically higher. Services using `isProofFresh()` will automatically accept the refreshed agent.

### On-Chain (Solidity)

```solidity
// Gate on fresh proof, not just existence
require(registry.isProofFresh(agentId), "Proof expired — agent must re-verify");
```

---

## 14. Examples

See the [`examples/`](examples/) directory for framework integrations:

### Runtime-Tested

| Example                                          | Language   | Key Type | What it shows                               |
| ------------------------------------------------ | ---------- | -------- | ------------------------------------------- |
| [Standalone TypeScript](examples/standalone-ts/) | TypeScript | Ed25519  | Ed25519 agent signing reference             |
| [Standalone Python](examples/standalone-py/)     | Python     | Ed25519  | Ed25519 agent signing reference             |
| [Minimal TypeScript](examples/minimal-ts/)       | TypeScript | ECDSA    | Agent signing + Express verifier middleware |
| [Minimal Python](examples/minimal-python/)       | Python     | ECDSA    | Agent signing + FastAPI verifier middleware |
| [LangChain Agent](examples/langchain-agent/)     | Python     | ECDSA    | Full AI agent with on-chain verification    |

### Framework Integrations (Doc-Quality)

| Example                          | Language   | Key Type | What it shows                               |
| -------------------------------- | ---------- | -------- | ------------------------------------------- |
| [Eliza (ai16z)](examples/eliza/) | TypeScript | Ed25519  | Plugin for Eliza agents (reuses Solana key) |
| [OpenClaw](examples/openclaw/)   | Python     | Ed25519  | Skill handler (reuses Clawdentity key)      |
| [LangChain](examples/langchain/) | Python     | Ed25519  | Custom LangChain tools                      |
| [CrewAI](examples/crewai/)       | Python     | Ed25519  | Custom CrewAI tools                         |
| [AutoGen](examples/autogen/)     | Python     | Ed25519  | Function tools for AutoGen agents           |

> **Eliza note**: Eliza agents on Solana already use Ed25519 keypairs. The plugin registers the same key with Self Agent ID — no new key generation required.

> **OpenClaw note**: OpenClaw uses Ed25519 for device identity (Clawdentity). The skill loads the existing device key directly.

---

## Appendix: Repo Layout

```
self-agent-id/
├── app/                  # Next.js web app + REST API
│   ├── app/              # Pages and API routes
│   │   ├── api/          # REST API (agent/, demo/, aa/, cards/, reputation/, a2a/)
│   │   ├── register/     # Registration flow pages (4 modes)
│   │   ├── .well-known/  # Agent discovery endpoints
│   │   ├── llms.txt/     # LLM-readable discovery
│   │   ├── explainer/    # Technical explainer page
│   │   ├── api-docs/     # API documentation page
│   │   ├── cli/          # CLI documentation + browser handoff
│   │   ├── demo/         # Live demo page
│   │   ├── verify/       # Agent inspection page
│   │   ├── my-agents/    # Agent lookup by wallet/passkey/key
│   │   └── erc8004/      # ERC-8004 spec page
│   └── lib/              # Shared utilities (network.ts, snippets.ts)
├── typescript-sdk/       # TypeScript SDK (@selfxyz/agent-sdk)
│   └── src/              # SelfAgent, Ed25519Agent, SelfAgentVerifier, CLI, registration
├── python-sdk/           # Python SDK (selfxyz-agent-sdk)
│   └── src/self_agent_sdk/  # agent, verifier, middleware, CLI
├── rust-sdk/             # Rust SDK (self-agent-sdk)
│   └── src/              # agent, verifier, middleware, CLI binary
├── contracts/            # Solidity contracts (Foundry)
│   ├── src/              # Registry, providers, demo contracts, interfaces
│   └── test/             # Foundry tests
├── examples/             # Framework integration examples (10+)
│   ├── standalone-ts/    # Ed25519 TypeScript reference
│   ├── standalone-py/    # Ed25519 Python reference
│   ├── minimal-ts/       # ECDSA TypeScript + Express
│   ├── minimal-python/   # ECDSA Python + FastAPI
│   ├── langchain-agent/  # Production LangChain agent
│   ├── eliza/            # Eliza (ai16z) plugin
│   ├── openclaw/         # OpenClaw skill
│   ├── langchain/        # LangChain Ed25519 tools
│   ├── crewai/           # CrewAI tools
│   └── autogen/          # AutoGen function tools
├── plugin/               # Claude Code plugin (6 skills)
├── functions/            # Demo Cloud Functions
└── docs/                 # Integration guides, CLI spec, plans
```

## Additional Documentation

- `docs/SELF_PROTOCOL_INTEGRATION.md` — Self Protocol integration guide
- `docs/CLI_REGISTRATION.md` — CLI registration spec, flows, and agent-guided orchestration
- `docs/EIP_DRAFT_PROOF_OF_HUMAN.md` — ERC-8004 Proof-of-Human extension proposal
- `docs/SECURITY_AUDIT_REPORT.md` — Security audit findings
- `docs/THREAT_MODEL_STRIDE.md` — STRIDE threat model

---

## Claude Code Plugin

Install the plugin for guided AI-assisted workflows:

```bash
claude plugin add /path/to/self-agent-id/plugin
```

### Skills (6)

| Skill                    | Triggers                                      |
| ------------------------ | --------------------------------------------- |
| `self-agent-id-overview` | "what is self agent id", "explain ERC-8004"   |
| `register-agent`         | "register agent", "create agent identity"     |
| `sign-requests`          | "sign request", "agent auth headers"          |
| `verify-agents`          | "verify agent", "add verification middleware" |
| `query-credentials`      | "lookup agent", "agent credentials"           |
| `integrate-self-id`      | "add self agent id to my project"             |

See [plugin README](plugin/README.md) for setup details.

---

## Development

### Local Setup

```bash
# Smart contracts
cd contracts && forge install && forge build --evm-version cancun && forge test

# dApp
cd app && cp .env.example .env.local && npm install && npm run dev

# TypeScript SDK
cd typescript-sdk && npm install && npm test

# Python SDK
cd python-sdk && pip install -e ".[dev]" && pytest

# Rust SDK
cd rust-sdk && cargo test
```

### Run the web app locally

```bash
cd app
cp .env.example .env.local
npm install && npm run dev
```

### Verification Smoke Checklist (Before Demos / Releases)

1. Build and test all changed components.
2. Start your verifier service and confirm health endpoint.
3. Run one registered-agent success request.
4. Run at least two failure drills (`tamper`, `expired`, or `replay`) and confirm expected status/errors.

### Environment Variables

| Variable                 | Default                   | Purpose                 |
| ------------------------ | ------------------------- | ----------------------- |
| `SELF_AGENT_PRIVATE_KEY` | —                         | Agent's hex private key |
| `SELF_NETWORK`           | `testnet`                 | `mainnet` or `testnet`  |
| `SELF_AGENT_API_BASE`    | `https://app.ai.self.xyz` | API base URL override   |

Priority: explicit param > env var > default. Note: `SELF_API_URL` is removed — use `SELF_AGENT_API_BASE`.

---

## License

Business Source License 1.1 (`BUSL-1.1`).

- Source-available with a non-commercial additional use grant.
- Commercial use requires a separate written license from Social Connect Labs, Inc.
- Converts to Apache-2.0 on 2029-06-11 (see [LICENSE](LICENSE)).
- Path override: `contracts/**` uses `MIT` (via SPDX headers).
- Path override: `examples/**` uses `MIT` (via SPDX headers).

### License Header Tooling

- Check duplicate headers: `python3 scripts/check-duplicate-headers.py`
- Check formatting/presence: `python3 scripts/check-license-headers.py`
- Auto-fix headers: `python3 scripts/check-license-headers.py --fix`
- Run both checks: `python3 scripts/lint-headers.py`
- Install git pre-commit hook: `./scripts/install-git-hooks.sh`
