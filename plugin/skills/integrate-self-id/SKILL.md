---
name: integrate-self-id
description: >
  This skill should be used when the user asks to "add self agent id",
  "integrate self id", "setup self agent", "add agent verification to my project",
  "self agent id sdk", "install agent sdk", "integrate proof of human",
  or wants to add Self Agent ID to an existing project from scratch.
---

# Integrate Self Agent ID

## Decision Tree — What Are You Building?

Before beginning integration, identify which components the project needs:

```
Start
  |
  +-- "Building an agent that needs identity"
  |     -> Agent-side integration (SelfAgent class)
  |        Install the SDK, generate/load a keypair, register, sign outbound HTTP requests.
  |
  +-- "Building a service/API that verifies agents"
  |     -> Service-side integration (SelfAgentVerifier class)
  |        Install the SDK, configure verification rules, protect API routes with middleware.
  |
  +-- "Building a smart contract that gates on agent identity"
  |     -> On-chain integration (Solidity)
  |        Import registry interfaces, add modifiers that check on-chain proof status and credentials.
  |
  +-- "Want AI tool (Claude Code / Cursor) to manage agent identity"
  |     -> MCP server setup
  |        Install @selfxyz/mcp-server, configure env vars, use MCP tools for registration and signing.
  |
  +-- Not sure?
        -> Most projects need BOTH agent-side AND service-side.
           Start with the agent-side to register and sign, then add
           service-side to verify incoming requests.
```

Select one or more paths below based on the project's requirements. Each section is self-contained.

---

## Agent-Side Quick Start

Install the SDK for the agent's language, initialize with a private key (or generate a new one), and start making authenticated HTTP requests.

### TypeScript

```bash
npm install @selfxyz/agent-sdk
```

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({
  privateKey: process.env.AGENT_PRIVATE_KEY!,
  network: "mainnet", // or "testnet"
});

// Check if registered
const info = await agent.getInfo();
if (!info.registered) {
  // Initiate registration — human scans QR with Self app
  const session = await agent.requestRegistration({ minimumAge: 18, ofac: true });
  console.log("Scan QR:", session.qrUrl);
}

// Make authenticated requests (auto-signs with 3-header system)
const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "hello" }),
});
```

### Python

```bash
pip install selfxyz-agent-sdk
```

```python
import os
from self_agent_sdk import SelfAgent

agent = SelfAgent(private_key=os.environ["AGENT_PRIVATE_KEY"], network="mainnet")

# Check registration status
info = agent.get_info()

# Make authenticated requests
response = agent.fetch(
    "https://api.example.com/data",
    method="POST",
    body='{"query":"hello"}'
)
```

### Rust

```bash
cargo add self-agent-sdk
```

```rust
use self_agent_sdk::SelfAgent;

let agent = SelfAgent::new(std::env::var("AGENT_PRIVATE_KEY").unwrap())?;
let info = agent.get_info().await?;

let response = agent.fetch(
    "https://api.example.com/data",
    "POST",
    Some(r#"{"query":"hello"}"#),
    None,
).await?;
```

All three SDKs expose identical API surfaces. The `fetch()` method wraps the native HTTP client, auto-attaching the `x-self-agent-address`, `x-self-agent-signature`, and `x-self-agent-timestamp` headers to every request.

---

## Service-Side Quick Start

Install the SDK on the server, configure a verifier with the desired checks, and protect API routes.

### TypeScript (Express)

```typescript
import express from "express";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const app = express();
app.use(express.json());

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider() // CRITICAL: always include in production
  .sybilLimit(3)
  .build();

// Protect all /api routes
app.use("/api", verifier.auth());

// Access verified agent info in handlers
app.get("/api/profile", (req, res) => {
  const agent = req.verifiedAgent;
  res.json({
    agentId: agent.agentId,
    nationality: agent.credentials.nationality,
  });
});

app.listen(3000);
```

### Python (FastAPI)

```python
from fastapi import FastAPI, Request, HTTPException
from self_agent_sdk import SelfAgentVerifier

app = FastAPI()

verifier = (
    SelfAgentVerifier.create()
    .network("mainnet")
    .require_age(18)
    .require_ofac()
    .require_self_provider()  # CRITICAL
    .sybil_limit(3)
    .build()
)

@app.middleware("http")
async def verify_agent(request: Request, call_next):
    if request.url.path.startswith("/api"):
        address = request.headers.get("x-self-agent-address")
        signature = request.headers.get("x-self-agent-signature")
        timestamp = request.headers.get("x-self-agent-timestamp")

        if not all([address, signature, timestamp]):
            raise HTTPException(status_code=401, detail="Missing agent auth headers")

        body = await request.body()
        result = await verifier.verify(
            address=address, signature=signature, timestamp=timestamp,
            method=request.method, path=request.url.path,
            body=body.decode("utf-8") if body else "",
        )

        if not result.valid:
            raise HTTPException(status_code=401, detail=result.error)

        request.state.agent = result

    return await call_next(request)

@app.get("/api/profile")
async def profile(request: Request):
    agent = request.state.agent
    return {"agent_id": agent.agent_id}
```

### Rust (Axum)

```rust
use axum::{routing::get, Router, middleware};
use self_agent_sdk::SelfAgentVerifier;
use std::sync::Arc;

let verifier = SelfAgentVerifier::builder()
    .network("mainnet")
    .require_age(18)
    .require_ofac()
    .require_self_provider() // CRITICAL
    .sybil_limit(3)
    .build()?;

let state = AppState { verifier: Arc::new(verifier) };

let protected = Router::new()
    .route("/api/profile", get(profile_handler))
    .layer(middleware::from_fn_with_state(state.clone(), verify_agent_middleware));

let app = Router::new()
    .route("/health", get(health))
    .merge(protected)
    .with_state(state);
```

---

## MCP Server Setup

Install the MCP server to give AI coding assistants (Claude Code, Cursor, Windsurf) access to Self Agent ID tools.

### Installation

```bash
# Install globally
npm install -g @selfxyz/mcp-server

# Or run via npx (no install required)
npx @selfxyz/mcp-server
```

### Claude Code Configuration

Add to the MCP settings (`.claude/mcp_servers.json` or project-level config):

```json
{
  "self-agent-id": {
    "command": "npx",
    "args": ["-y", "@selfxyz/mcp-server"],
    "env": {
      "SELF_AGENT_PRIVATE_KEY": "0x...",
      "SELF_NETWORK": "testnet",
      "SELF_AGENT_API_BASE": "https://self-agent-id.vercel.app"
    }
  }
}
```

### Cursor Configuration

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "self-agent-id": {
      "command": "npx",
      "args": ["-y", "@selfxyz/mcp-server"],
      "env": {
        "SELF_AGENT_PRIVATE_KEY": "0x...",
        "SELF_NETWORK": "testnet",
        "SELF_AGENT_API_BASE": "https://self-agent-id.vercel.app"
      }
    }
  }
}
```

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SELF_AGENT_PRIVATE_KEY` | No | Agent's hex private key (0x-prefixed). Enables identity and auth tools. If omitted, only read-only tools (lookup, list, verify) are available. |
| `SELF_NETWORK` | No | `mainnet` or `testnet`. Default: `testnet`. |
| `SELF_AGENT_API_BASE` | No | API base URL override. Default: `https://self-agent-id.vercel.app`. |

`SELF_AGENT_API_BASE` is the canonical environment variable. The previous `SELF_API_URL` has been removed.

### Available MCP Tools

Once configured, the MCP server exposes 10 tools:

| Category | Tool | Description |
|---|---|---|
| Identity | `self_register_agent` | Start agent registration flow |
| Identity | `self_check_registration` | Poll registration status |
| Identity | `self_get_identity` | Get own agent info |
| Identity | `self_deregister_agent` | Start deregistration flow |
| Auth | `self_sign_request` | Generate auth headers |
| Auth | `self_authenticated_fetch` | Make signed HTTP request |
| Discovery | `self_lookup_agent` | Look up any agent by address or ID |
| Discovery | `self_list_agents_for_human` | List agents for a human address |
| Verification | `self_verify_agent` | Verify agent on-chain |
| Verification | `self_verify_request` | Validate signed HTTP request |

---

## On-Chain Integration Quick Start (Solidity)

Import the registry interface and add modifiers that gate contract functions on agent identity.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC8004ProofOfHuman} from "./interfaces/IERC8004ProofOfHuman.sol";

interface ISelfAgentRegistryReader is IERC8004ProofOfHuman {
    function isVerifiedAgent(bytes32 agentKey) external view returns (bool);
    function getAgentId(bytes32 agentKey) external view returns (uint256);
    function getProofProvider(uint256 agentId) external view returns (address);
    function getAgentKey(uint256 agentId) external view returns (bytes32);
}

contract MyContract {
    ISelfAgentRegistryReader public immutable registry;
    address public immutable selfProvider;

    constructor(address _registry, address _selfProvider) {
        registry = ISelfAgentRegistryReader(_registry);
        selfProvider = _selfProvider;
    }

    modifier onlyVerifiedAgent(uint256 agentId) {
        require(
            registry.isVerifiedAgent(registry.getAgentKey(agentId)),
            "Not verified"
        );
        require(
            registry.getProofProvider(agentId) == selfProvider,
            "Wrong provider"
        );
        _;
    }

    function protectedAction(uint256 agentId) external onlyVerifiedAgent(agentId) {
        // Only verified agents reach this point
    }
}
```

Compile with Foundry:

```bash
forge build --evm-version cancun
```

The `--evm-version cancun` flag is required because Hub V2 uses the PUSH0 opcode introduced in the Cancun upgrade.

### Contract Addresses

| Contract | Mainnet (42220) | Testnet (11142220) |
|---|---|---|
| SelfAgentRegistry | `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095` | `0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b` |
| SelfHumanProofProvider | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` |
| Hub V2 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |

---

## Common Gotchas

These are the most frequently encountered issues during integration. Read through all of them before starting.

| Gotcha | Detail |
|---|---|
| **userDefinedData is UTF-8** | The Self SDK passes `userDefinedData` as a UTF-8 string, NOT raw bytes. All hex values in the payload are ASCII hex characters. An address is 40 ASCII characters, not 20 raw bytes. |
| **Use `--evm-version cancun`** | Foundry builds referencing Hub V2 must use `forge build --evm-version cancun`. Hub V2 uses the PUSH0 opcode which requires the Cancun EVM version. |
| **Provider verification is CRITICAL** | Without checking `getProofProvider()`, a fake provider could deploy a malicious contract that always returns `true` and register illegitimate agents. Always call `.requireSelfProvider()` in the SDK or check `getProofProvider(agentId) == SELF_PROVIDER` on-chain. |
| **bytes32 positioning** | Use `bytes32(bytes1(uint8(x)))` not `bytes32(uint256(x))` for byte positioning in bytes32. Use `bytes32(uint256(uint160(addr)))` for address-to-agentKey conversion (right-padded, not left-padded). |
| **NEXT_PUBLIC_SELF_ENDPOINT** | The `.env.local` variable `NEXT_PUBLIC_SELF_ENDPOINT` must be lowercase. A scope mismatch occurs if casing differs. |
| **SELF_AGENT_API_BASE** | `SELF_AGENT_API_BASE` is the canonical env var. `SELF_API_URL` has been removed. Default: `https://self-agent-id.vercel.app`. The old `selfagentid.xyz` domain is retired. |
| **Celo Sepolia chain ID** | Celo Sepolia is chain `11142220`, NOT `44787` (deprecated Alfajores). RPC: `https://forno.celo-sepolia.celo-testnet.org`. |
| **Blockscout verification** | Blockscout does not need an API key for contract verification. Celoscan verification should use the Sourcify verifier (not etherscan verifier) as the Celoscan API endpoint is flaky. |
| **Timestamp precision** | Auth headers use millisecond timestamps (e.g., `"1708704000000"`), not seconds. |
| **Signature message format** | The signed message is `keccak256(timestamp + METHOD + pathWithQuery + bodyHash)`, where bodyHash is `keccak256(body)` as a hex string including the `0x` prefix. |

---

## Testing End-to-End

Follow this sequence to validate a full integration from registration through verification:

1. **Register on testnet first** — Use chain `11142220` (Celo Sepolia). No real funds needed. Set `network: "testnet"` in the SDK or `SELF_NETWORK=testnet` in MCP config.

2. **Scan QR with Self app** — The registration flow generates a QR code. Open the Self app, scan the QR, and scan the passport NFC chip. The Self app generates a ZK proof locally and submits it on-chain.

3. **Poll for completion** — Call `agent.getRegistrationStatus()` (SDK) or `self_check_registration` (MCP) every 5-10 seconds. The flow typically takes 30-90 seconds. Sessions expire after 10 minutes.

4. **Test request signing** — Use `agent.signRequest()` or `self_sign_request` to generate the 3 auth headers. Verify them using `SelfAgentVerifier` or `self_verify_request`.

5. **Verify credentials match** — Call `agent.getCredentials()` or `self_get_identity` and confirm the stored credentials (nationality, age threshold, OFAC status) match the selected verification config.

6. **Test signed fetch** — Make a full round-trip: agent signs a request to a protected endpoint, the server verifies the signature and on-chain state, and returns agent-specific data.

7. **Test failure cases** — Verify that the server correctly rejects: missing headers (401), expired timestamps (401), invalid signatures (401), unregistered agents (401), wrong provider (401), and sybil limit exceeded (403).

---

## Reference Documentation

For the complete SDK API reference covering all classes, methods, types, and constants across TypeScript, Python, and Rust, see [`references/sdk-reference.md`](references/sdk-reference.md).

For full runnable integration examples across Express, FastAPI, Axum, Hono, Next.js, LangChain, and Solidity, see [`references/framework-examples.md`](references/framework-examples.md).
