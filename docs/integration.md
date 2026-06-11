# Integration Guide

> Archived from the former /integration web page.

Everything you need to verify agents in your service, authenticate your agent with other services, or register agents from the terminal.

```
npm install @selfxyz/agent-sdk
```

```
pip install selfxyz-agent-sdk
```

```
cargo add self-agent-sdk
```

mcp · @selfxyz/mcp-server

## Verify Agents in Your Service

These code snippets are for **service developers** who want to verify agents in their applications. Pre-filled with the deployed contract address for **Celo** (the default mainnet network; `network.label`).

Smart contracts are currently deployed on **Celo** (mainnet & Sepolia testnet). Multichain support is coming soon.

Use-case tabs: **Agent → Service**, **Agent → Agent**, **Agent → Chain**.

Optional feature toggles: Over 18, Over 21, Not on OFAC List, Nationality, Issuing State, Custom Sybil Limit, Registration Age, Read All Credentials, Rate Limit. (The code blocks below show the default state with no features toggled.)

Security default: `requireSelfProvider: true`. Turning this off accepts any approved proof provider, not only Self.

### Agent → Service

Verify that an AI agent calling your API is human-backed. The SDK recovers the signer from the ECDSA signature, checks isVerifiedAgent() on-chain, and optionally reads ZK-attested credentials and enforces sybil limits.

Flow: `npm install @selfxyz/agent-sdk (or pip install selfxyz-agent-sdk or cargo add self-agent-sdk) → Create verifier → Add middleware → Done`

**TypeScript**

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

import express from "express";

const app = express();
app.use(express.json({
  verify: (req: any, _res: any, buf: any) => {
    req.rawBody = typeof buf === "string" ? buf : buf.toString("utf8");
  },
}));
const verifier = SelfAgentVerifier.create().build();

app.use("/api", verifier.auth());

app.post("/api/data", (req, res) => {
  console.log("Verified agent:", req.agent.address);

  res.json({ ok: true });
});
```

**Python**

```python
from flask import Flask, g, jsonify
from self_agent_sdk import SelfAgentVerifier
from self_agent_sdk.middleware.flask import require_agent

app = Flask(__name__)
verifier = SelfAgentVerifier.create().build()

@app.route("/api/data", methods=["POST"])
@require_agent(verifier)
def handle():
    print("Verified agent:", g.agent.agent_address)

    return jsonify(ok=True)
```

**Rust**

```rust
use axum::{Router, routing::post, middleware, Json, Extension};
use self_agent_sdk::{SelfAgentVerifier, VerifiedAgent, self_agent_auth};
use std::sync::Arc;
use tokio::sync::Mutex;

#[tokio::main]
async fn main() {
    let verifier = Arc::new(Mutex::new(
        SelfAgentVerifier::create().build()
    ));

    let app = Router::new()
        .route("/api/data", post(handle))
        .layer(middleware::from_fn_with_state(verifier, self_agent_auth));

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn handle(
    Extension(agent): Extension<VerifiedAgent>,
) -> Json<serde_json::Value> {
    let agent = req.extensions().get::<VerifiedAgent>().unwrap();
    println!("Verified agent: {:?}", agent.address);

    Json(serde_json::json!({ "ok": true }))
}
```

### Agent → Agent

Verify a peer agent is human-backed before collaborating. Recover the signer from their ECDSA signature, check isVerifiedAgent() on-chain, and use sameHuman() to detect sybil attacks in multi-agent systems.

Flow: `Receive signed message → Verify via SDK → Check identity → Collaborate`

**TypeScript**

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create().build();

async function verifyPeer(req: Request): Promise<boolean> {
  const result = await verifier.verify({
    signature: req.headers.get("x-self-agent-signature")!,
    timestamp: req.headers.get("x-self-agent-timestamp")!,
    method: req.method,
    url: req.url,
  });
  if (!result.valid) return false;

  return true;
}
```

**Python**

```python
from self_agent_sdk import SelfAgentVerifier

verifier = SelfAgentVerifier.create().build()

def verify_peer(headers: dict, method: str, url: str) -> bool:
    result = verifier.verify(
        signature=headers.get("x-self-agent-signature", ""),
        timestamp=headers.get("x-self-agent-timestamp", ""),
        method=method, url=url,
    )
    if not result.valid:
        return False

    return True
```

**Rust**

```rust
use self_agent_sdk::SelfAgentVerifier;

let mut verifier = SelfAgentVerifier::create().build();
async fn verify_peer(
    verifier: &mut SelfAgentVerifier,
    signature: &str, timestamp: &str,
    method: &str, url: &str, body: Option<&str>,
) -> bool {
    let result = verifier.verify(
        signature, timestamp, method, url, body,
    ).await;
    if !result.valid { return false; }

    true
}
```

**Solidity**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISelfAgentRegistry {
    function isVerifiedAgent(bytes32 key) external view returns (bool);
}

contract AgentCollaboration {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(0xaC3DF9ABf80d0F5c020C06B04Cced27763355944);

    modifier onlyVerifiedPair(bytes32 agentA, bytes32 agentB) {
        require(registry.isVerifiedAgent(agentA) && registry.isVerifiedAgent(agentB), "Not verified");
        _;
    }

    function collaborate(
        bytes32 agentA,
        bytes32 agentB,
        bytes calldata data
    ) external onlyVerifiedPair(agentA, agentB) {
        // Both agents are verified
    }
}
```

### Agent → Chain

Gate your smart contract so only human-backed agents can call it. The contract derives the agent key as bytes32(uint256(uint160(msg.sender))) and calls isVerifiedAgent() on the registry. No SDK needed — pure on-chain verification.

Flow: `Agent calls your contract → Modifier derives key from msg.sender → Checks registry → Executes`

**Solidity**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISelfAgentRegistry {
    function isVerifiedAgent(bytes32 key) external view returns (bool);
}

contract MyProtocol {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(0xaC3DF9ABf80d0F5c020C06B04Cced27763355944);

    modifier onlyVerifiedAgent() {
        bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
        require(registry.isVerifiedAgent(agentKey), "Agent not human-verified");
        _;
    }

    function agentAction(
        bytes calldata data
    ) external onlyVerifiedAgent {
        // Only human-backed agents reach here
    }
}
```

## How to Use Your Agent

If you are the **agent operator**, use these snippets to authenticate your agent with services or submit on-chain transactions. Set `AGENT_PRIVATE_KEY` in your agent's environment first.

Snippet tabs: **Sign Requests**, **Submit Transactions**, **Test Your Setup**.

Optional feature toggles: Check Status, Read Credentials, Agent Info, Same Human Check, Different Human, Mutual Verification. (The code blocks below show the default state with no features toggled.)

### Sign Requests

Your agent signs every outgoing HTTP request with ECDSA (timestamp + method + URL + body hash). Services recover the signer from the signature and check isVerifiedAgent() on-chain — no API keys or tokens needed.

Flow: `npm install @selfxyz/agent-sdk (or pip install selfxyz-agent-sdk or cargo add self-agent-sdk) → Create agent → Use agent.fetch() → Service verifies automatically`

**TypeScript**

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY,
});

// Every request is signed automatically
const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "test" }),
});

// Check your own registration status
const registered = await agent.isRegistered();
```

**Python**

```python
from self_agent_sdk import SelfAgent
import os

agent = SelfAgent(private_key=os.environ["AGENT_PRIVATE_KEY"])

# Every request is signed automatically
res = agent.fetch("https://api.example.com/data",
                   method="POST", body='{"query": "test"}')

# Check your own registration status
print("Registered:", agent.is_registered())

# Get full agent info (ID, nullifier, sybil count)
info = agent.get_info()
print(f"Agent ID: {info.agent_id}, Verified: {info.is_verified}")
```

**Rust**

```rust
use self_agent_sdk::{SelfAgent, SelfAgentConfig, NetworkName};

let agent = SelfAgent::new(SelfAgentConfig {
    private_key: std::env::var("AGENT_PRIVATE_KEY").unwrap(),
    network: Some(NetworkName::Testnet),
    registry_address: None,
    rpc_url: None,
}).unwrap();

// Every request is signed automatically
let res = agent.fetch(
    "https://api.example.com/data",
    Some(reqwest::Method::POST),
    Some(r#"{"query":"test"}"#.to_string()),
).await.unwrap();

// Check your own registration status
let registered = agent.is_registered().await.unwrap();
println!("Registered: {registered}");

// Get full agent info (ID, nullifier, sybil count)
let info = agent.get_info().await.unwrap();
println!("Agent ID: {:?}, Verified: {}", info.agent_id, info.is_verified);
```

### Submit Transactions

Your agent address is a real Ethereum wallet. Fund it with gas and it can call smart contracts directly. Contracts derive bytes32(uint256(uint160(msg.sender))) and check the registry — no off-chain signature needed for on-chain calls.

Flow: `Fund agent wallet with gas → Agent calls contract → Contract checks registry → Action proceeds`

**TypeScript**

```typescript
import { ethers } from "ethers";

// Your agent wallet — fund this address with gas
const wallet = new ethers.Wallet(
  process.env.AGENT_PRIVATE_KEY,
  new ethers.JsonRpcProvider("https://forno.celo.org")
);

console.log("Agent address:", wallet.address);
console.log("Fund this address with CELO for gas");

// Call any contract that uses onlyVerifiedAgent modifier
const contract = new ethers.Contract(
  CONTRACT_ADDRESS, CONTRACT_ABI, wallet
);
const tx = await contract.agentAction("0x...");
await tx.wait();
// Contract checks msg.sender against the registry automatically
```

**Python**

```python
from web3 import Web3
import os

w3 = Web3(Web3.HTTPProvider(
    "https://forno.celo.org"
))
account = w3.eth.account.from_key(os.environ["AGENT_PRIVATE_KEY"])
print("Agent address:", account.address)
print("Fund this address with CELO for gas")

contract = w3.eth.contract(
    address=CONTRACT_ADDRESS,
    abi=CONTRACT_ABI,
)

# Build and sign the transaction
tx = contract.functions.agentAction(b"\x00").build_transaction({
    "from": account.address,
    "nonce": w3.eth.get_transaction_count(account.address),
    "gas": 200_000,
    "gasPrice": w3.eth.gas_price,
})
signed = account.sign_transaction(tx)
tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)
receipt = w3.eth.wait_for_transaction_receipt(tx_hash)
print("Confirmed in block:", receipt["blockNumber"])
# Contract checks msg.sender against the registry automatically
```

**Rust**

```rust
use alloy::providers::ProviderBuilder;
use alloy::signers::local::PrivateKeySigner;
use alloy::sol;

sol! {
    #[sol(rpc)]
    interface IMyProtocol {
        function agentAction(bytes calldata data) external;
    }
}

#[tokio::main]
async fn main() -> eyre::Result<()> {
    let signer: PrivateKeySigner = std::env::var("AGENT_PRIVATE_KEY")?
        .parse()?;
    println!("Agent address: {}", signer.address());
    println!("Fund this address with CELO for gas");

    let provider = ProviderBuilder::new()
        .wallet(signer)
        .connect_http("https://forno.celo.org".parse()?);

    let contract = IMyProtocol::new(
        CONTRACT_ADDRESS.parse()?,
        &provider,
    );

    let tx = contract.agentAction(bytes::Bytes::from_static(b""))
        .send().await?
        .watch().await?;
    println!("Confirmed: {tx:?}");
    // Contract checks msg.sender against the registry automatically
    Ok(())
}
```

**Solidity (Contract)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Example contract that gates actions behind Self Agent ID
/// Deploy this, then call agentAction() from your agent wallet
interface ISelfAgentRegistry {
    function isVerifiedAgent(bytes32 key) external view returns (bool);
}

contract MyProtocol {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(0xaC3DF9ABf80d0F5c020C06B04Cced27763355944);

    event AgentActed(address indexed agent, bytes data);

    modifier onlyVerifiedAgent() {
        bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
        require(
            registry.isVerifiedAgent(agentKey),
            "Agent not human-verified"
        );
        _;
    }

    function agentAction(
        bytes calldata data
    ) external onlyVerifiedAgent {
        emit AgentActed(msg.sender, data);
    }
}
```

### Test Your Setup

Verify your agent works end to end with no hosted service: sign a request with the agent key, then verify it locally with `SelfAgentVerifier`. If the agent is registered on-chain, the round-trip succeeds.

**TypeScript**

```typescript
import { SelfAgent, SelfAgentVerifier } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  network: "testnet", // or omit for mainnet
});

console.log("Agent:", agent.address);
console.log("Registered:", await agent.isRegistered());

// Sign a request, then verify it locally — the full round-trip.
const headers = await agent.signRequest("POST", "/api/test", '{"test":true}');

const verifier = SelfAgentVerifier.create().network("testnet").build();
const result = await verifier.verify({
  signature: headers["x-self-agent-signature"],
  timestamp: headers["x-self-agent-timestamp"],
  method: "POST",
  url: "/api/test",
  body: '{"test":true}',
});

console.log("Valid:", result.valid);
console.log("Agent ID:", result.agentId);
console.log("Address:", result.agentAddress);
```

**Python**

```python
import os
from self_agent_sdk import SelfAgent, SelfAgentVerifier

agent = SelfAgent(private_key=os.environ["AGENT_PRIVATE_KEY"], network="testnet")
print(f"Agent: {agent.address}")
print(f"Registered: {agent.is_registered()}")

# Sign a request, then verify it locally — the full round-trip.
verifier = SelfAgentVerifier.create().network("testnet").sybil_limit(0).build()
headers = agent.sign_request("POST", "/api/test", body='{"test":true}')
result = verifier.verify(
    signature=headers["x-self-agent-signature"],
    timestamp=headers["x-self-agent-timestamp"],
    method="POST", url="/api/test", body='{"test":true}',
)
print(f"Valid: {result.valid}")
print(f"Agent ID: {result.agent_id}")
print(f"Address: {result.agent_address}")
```

**Rust**

```rust
use self_agent_sdk::{SelfAgent, SelfAgentConfig, SelfAgentVerifier, NetworkName, constants::headers};

#[tokio::main]
async fn main() {
    let agent = SelfAgent::new(SelfAgentConfig {
        private_key: std::env::var("AGENT_PRIVATE_KEY").unwrap(),
        network: Some(NetworkName::Testnet),
        registry_address: None,
        rpc_url: None,
    }).unwrap();

    println!("Agent: {:?}", agent.address());
    println!("Registered: {}", agent.is_registered().await.unwrap());

    // Sign a request, then verify it locally — the full round-trip.
    let body = r#"{"test":true}"#;
    let hdrs = agent.sign_request("POST", "/api/test", Some(body)).await.unwrap();
    let mut verifier = SelfAgentVerifier::create()
        .network(NetworkName::Testnet)
        .sybil_limit(0)
        .build();
    let result = verifier.verify(
        &hdrs[headers::SIGNATURE],
        &hdrs[headers::TIMESTAMP],
        "POST", "/api/test", Some(body),
    ).await;
    println!("Recovered address: {:?}", result.agent_address);
    println!("Agent key: {:?}", result.agent_key);
}
```

## CLI & Agent-Guided Registration

Register agents from your terminal or let your backend orchestrate the registration flow programmatically. The CLI creates a session, generates a browser handoff URL, and polls for completion.

### Quick Start

**TypeScript**

```bash
npx @selfxyz/agent-sdk register init \
  --mode linked \
  --human-address 0xYourWalletAddress \
  --network mainnet \
  --out .self/session.json

# Open browser for Self proof
npx @selfxyz/agent-sdk register open --session .self/session.json

# Wait for completion
npx @selfxyz/agent-sdk register wait --session .self/session.json

# Export credentials
npx @selfxyz/agent-sdk register export --session .self/session.json
```

**Python**

```bash
self-agent register init \
  --mode linked \
  --human-address 0xYourWalletAddress \
  --network mainnet \
  --out .self/session.json

self-agent register open --session .self/session.json
self-agent register wait --session .self/session.json
self-agent register export --session .self/session.json
```

**Rust**

```bash
self-agent register init \
  --mode linked \
  --human-address 0xYourWalletAddress \
  --network mainnet \
  --out .self/session.json

self-agent register open --session .self/session.json
self-agent register wait --session .self/session.json
self-agent register export --session .self/session.json
```

> **Agent-guided flow (recommended):** Your backend calls `register init`, forwards the handoff URL to the user, and polls `register wait` for completion. This is the recommended pattern for services that onboard users programmatically.
>
> Links: CLI Quickstart (`/cli`), API Reference (`/api-docs`).

## MCP Server & Claude Code Plugin

Use Self Agent ID directly from your AI coding assistant. The [MCP server](https://www.npmjs.com/package/@selfxyz/mcp-server) exposes tools for identity management — register, sign, verify, and query agents without leaving your editor.

### MCP Server (any MCP-compatible IDE)

Add this to your project's `.mcp.json` or IDE MCP settings:

**MCP Config**

```json
{
  "self-agent-id": {
    "command": "npx",
    "args": ["-y", "@selfxyz/mcp-server"],
    "env": {
      "SELF_AGENT_PRIVATE_KEY": "0x...",
      "SELF_NETWORK": "mainnet",
      "SELF_AGENT_API_BASE": "https://agent-api.self.xyz"
    }
  }
}
```

### Claude Code Plugin (guided workflows)

The plugin adds 6 skills that guide Claude through registration, signing, verification, and integration — with full protocol context loaded automatically.

**Install**

```bash
# Clone the repo and install the plugin
git clone https://github.com/selfxyz/self-agent-id.git
claude plugin add ./self-agent-id/plugin

# Or point to a local checkout
claude plugin add /path/to/self-agent-id/plugin
```

### 10 MCP Tools

| Tool | Description |
| --- | --- |
| `self_register_agent` | Start agent registration (QR URL) |
| `self_check_registration` | Poll registration status |
| `self_get_identity` | Get current agent identity |
| `self_deregister_agent` | Initiate deregistration |
| `self_sign_request` | Generate auth headers |
| `self_authenticated_fetch` | Make a signed HTTP request |
| `self_lookup_agent` | Look up agent by ID or address |
| `self_list_agents_for_human` | List agents for a human |
| `self_verify_agent` | Verify on-chain proof status |
| `self_verify_request` | Verify signed request headers |

### 6 Plugin Skills

Each skill is a self-contained knowledge module with decision trees, code examples, and reference docs. They load automatically in Claude Code when triggered by your request.

| Skill | Description |
| --- | --- |
| `self-agent-id-overview` | Architecture, contracts, trust model, ERC-8004 standard, provider system |
| `register-agent` | Step-by-step registration in all modes (linked, wallet-free, smart-wallet, privy, ed25519, ed25519+guardian) |
| `sign-requests` | ECDSA request signing, 3-header auth system, signed fetch patterns |
| `verify-agents` | On-chain verification, SelfAgentVerifier middleware, reputation, freshness, sybil detection |
| `query-credentials` | ZK-attested credentials, agent cards (A2A format), reputation scores |
| `integrate-self-id` | End-to-end integration: agent-side, service-side, on-chain gating, MCP setup |

### Building a custom agent? Use our system prompts

For agents that don't support MCP (LangChain, AutoGPT, custom frameworks), paste one of these self-contained system prompts. No tools required — the agent gets full protocol knowledge and uses the REST API directly.

- [Full protocol](https://github.com/selfxyz/self-agent-id/blob/main/docs/system-prompts/self-agent-id-full.md)
- [Registration only](https://github.com/selfxyz/self-agent-id/blob/main/docs/system-prompts/self-agent-id-register.md)
- [Verification only](https://github.com/selfxyz/self-agent-id/blob/main/docs/system-prompts/self-agent-id-verify.md)
