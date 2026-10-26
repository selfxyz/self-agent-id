# Integration Guide

> Archived from the former /integration web page.

Everything you need to verify agents in your service, authenticate your agent with other services, or register agents from the terminal.

```
npm install @selfxyz/agent-sdk
```

The TypeScript SDK is the official client. From other languages, call the REST API at `https://agent-api.self.xyz` directly (see `docs/api-docs.md`). MCP clients can connect to `https://agent-api.self.xyz/api/mcp`.

## Verify Agents in Your Service

These snippets are for **service developers** verifying agents. Solidity samples use the Celo mainnet registry (`0xaC3DF9ABf80d0F5c020C06B04Cced27763355944`; Celo Sepolia: `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379`).

Optional verifier builder checks: `.requireAge(18|21)`, `.requireOFAC()`, `.requireNationality(...)`, `.sybilLimit(n)`, `.includeCredentials()`, `.rateLimit({...})`.

Security default: `requireSelfProvider: true`. Turning this off accepts any approved proof provider, not only Self.

### Agent → Service

Verify that an AI agent calling your API is human-backed. The SDK recovers the signer from the ECDSA signature, checks on-chain that the agent has a fresh human proof (`isVerifiedAgent()` + `isProofFresh()`), and optionally reads ZK-attested credentials and enforces sybil limits.

Flow: `npm install @selfxyz/agent-sdk → Create verifier → Add middleware → Done`

**TypeScript**

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

import express from "express";

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: Buffer }).rawBody = buf; // auth() verifies the exact bytes
    },
  }),
);
const verifier = SelfAgentVerifier.create().build();

app.use("/api", verifier.auth());

app.post("/api/data", (req, res) => {
  console.log("Verified agent:", req.agent!.address); // set by verifier.auth()

  res.json({ ok: true });
});
```

### Agent → Agent

Verify a peer agent is human-backed before collaborating. Recover the signer from their ECDSA signature, check on-chain that it has a fresh human proof, and use sameHuman() to detect sybil attacks in multi-agent systems.

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
    body: await req.text(),
  });
  if (!result.valid) return false;

  return true;
}
```

**Solidity**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISelfAgentRegistry {
    function isVerifiedAgent(bytes32 key) external view returns (bool);
    function getAgentId(bytes32 key) external view returns (uint256);
    function isProofFresh(uint256 agentId) external view returns (bool);
}

contract AgentCollaboration {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(0xaC3DF9ABf80d0F5c020C06B04Cced27763355944);

    function isHumanBacked(bytes32 agentKey) internal view returns (bool) {
        // isVerifiedAgent ignores expiry, so also require a fresh proof
        return registry.isVerifiedAgent(agentKey) &&
            registry.isProofFresh(registry.getAgentId(agentKey));
    }

    modifier onlyVerifiedPair(bytes32 agentA, bytes32 agentB) {
        require(isHumanBacked(agentA) && isHumanBacked(agentB), "Not verified");
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

Gate your smart contract so only human-backed agents can call it. The contract derives the agent key as bytes32(uint256(uint160(msg.sender))), calls isVerifiedAgent() on the registry and checks the proof is still fresh with isProofFresh(). No SDK needed — pure on-chain verification.

Flow: `Agent calls your contract → Modifier derives key from msg.sender → Checks registry → Executes`

**Solidity**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISelfAgentRegistry {
    function isVerifiedAgent(bytes32 key) external view returns (bool);
    function getAgentId(bytes32 key) external view returns (uint256);
    function isProofFresh(uint256 agentId) external view returns (bool);
}

contract MyProtocol {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(0xaC3DF9ABf80d0F5c020C06B04Cced27763355944);

    modifier onlyVerifiedAgent() {
        bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
        require(
            registry.isVerifiedAgent(agentKey) &&
                registry.isProofFresh(registry.getAgentId(agentKey)),
            "Agent not human-verified"
        );
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

### Sign Requests

Your agent signs every outgoing HTTP request with ECDSA (timestamp + method + URL + body hash). Services recover the signer from the signature and check on-chain that it has a fresh human proof — no API keys or tokens needed.

Flow: `npm install @selfxyz/agent-sdk → Create agent → Use agent.fetch() → Service verifies automatically`

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

// Check your own status: isVerified = has a human proof that hasn't expired
const { isVerified, proofExpiresAt } = await agent.getInfo();
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
  new ethers.JsonRpcProvider("https://forno.celo.org"),
);

console.log("Agent address:", wallet.address);
console.log("Fund this address with CELO for gas");

// Call any contract that uses onlyVerifiedAgent modifier
const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, wallet);
const tx = await contract.agentAction("0x...");
await tx.wait();
// Contract checks msg.sender against the registry automatically
```

**Solidity (Contract)**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @notice Example contract that gates actions behind Self Agent ID
/// Deploy this, then call agentAction() from your agent wallet
interface ISelfAgentRegistry {
    function isVerifiedAgent(bytes32 key) external view returns (bool);
    function getAgentId(bytes32 key) external view returns (uint256);
    function isProofFresh(uint256 agentId) external view returns (bool);
}

contract MyProtocol {
    ISelfAgentRegistry immutable registry =
        ISelfAgentRegistry(0xaC3DF9ABf80d0F5c020C06B04Cced27763355944);

    event AgentActed(address indexed agent, bytes data);

    modifier onlyVerifiedAgent() {
        bytes32 agentKey = bytes32(uint256(uint160(msg.sender)));
        require(
            registry.isVerifiedAgent(agentKey) &&
                registry.isProofFresh(registry.getAgentId(agentKey)),
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
console.log("Verified (fresh proof):", (await agent.getInfo()).isVerified);

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

## CLI & Agent-Guided Registration

Register agents from your terminal or let your backend orchestrate the registration flow programmatically. The CLI (shipped with the TypeScript SDK, `linked` and `wallet-free` modes) generates the agent key locally, prints a QR code URL for the human to scan with the Self app, and polls the registry until the agent is on-chain.

### Quick Start

```bash
npx -p @selfxyz/agent-sdk self-agent register init \
  --mode linked \
  --human-address 0xYourWalletAddress \
  --network mainnet \
  --out .self/session.json

# Print the QR code URL for the human to scan with the Self app
npx -p @selfxyz/agent-sdk self-agent register open --session .self/session.json

# Wait for on-chain verification
npx -p @selfxyz/agent-sdk self-agent register wait --session .self/session.json

# Export the generated agent key
npx -p @selfxyz/agent-sdk self-agent register export --session .self/session.json --unsafe --out-key .self/agent.key
```

> **Agent-guided flow (recommended):** Your backend calls `POST /api/agent/register` (or `requestRegistration()` in the SDK), shows the human the returned `scanUrl` QR code, polls `GET /api/agent/register/status` with `Authorization: Bearer <sessionToken>`, and exports the key with `POST /api/agent/register/export`. This supports every mode, including `ed25519`, `privy` and `smartwallet`.
>
> More: `docs/CLI_REGISTRATION.md`, `docs/api-docs.md`.

## MCP Server & Claude Code Plugin

Use Self Agent ID directly from your AI coding assistant. The hosted MCP server exposes tools for identity management — register, verify, and query agents without leaving your editor.

### MCP Server (any MCP-compatible IDE)

Add this to your project's `.mcp.json` or IDE MCP settings:

**MCP Config**

```json
{
  "mcpServers": {
    "self-agent-id": {
      "url": "https://agent-api.self.xyz/api/mcp"
    }
  }
}
```

Registration, lookup and verification tools are public. The signing tools (`self_get_identity`, `self_deregister_agent`, `self_sign_request`, `self_authenticated_fetch`) act as the deployment's own agent and need a self-hosted deployment with `SELF_AGENT_PRIVATE_KEY` plus an `Authorization: Bearer` key from `MCP_PRIVILEGED_API_KEYS`. To sign as your own agent, use the SDK.

### Claude Code Plugin (guided workflows)

The plugin adds 6 skills that guide Claude through registration, signing, verification, and integration — with full protocol context loaded automatically.

**Install**

```bash
# Clone the repo and start Claude Code with the plugin loaded
git clone https://github.com/selfxyz/self-agent-id.git
claude --plugin-dir ./self-agent-id/plugin

# Or point to an existing checkout
claude --plugin-dir /path/to/self-agent-id/plugin
```

### 10 MCP Tools

| Tool                         | Description                                     |
| ---------------------------- | ----------------------------------------------- |
| `self_register_agent`        | Start agent registration (QR + `scan_url`)      |
| `self_check_registration`    | Poll registration status; optionally export key |
| `self_lookup_agent`          | Look up agent by ID or address                  |
| `self_list_agents_for_human` | List agents for a human                         |
| `self_verify_agent`          | Verify on-chain proof status against a policy   |
| `self_verify_request`        | Verify ECDSA-signed request headers             |
| `self_get_identity`          | Deployment agent's identity (privileged)        |
| `self_deregister_agent`      | Deregister the deployment agent (privileged)    |
| `self_sign_request`          | Generate auth headers (privileged)              |
| `self_authenticated_fetch`   | Make a signed HTTP request (privileged)         |

### 6 Plugin Skills

Each skill is a self-contained knowledge module with decision trees, code examples, and reference docs. They load automatically in Claude Code when triggered by your request.

| Skill                    | Description                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `self-agent-id-overview` | Architecture, contracts, trust model, ERC-8004 standard, provider system                                  |
| `register-agent`         | Step-by-step registration in all modes (linked, wallet-free, smartwallet, privy, ed25519, ed25519-linked) |
| `sign-requests`          | ECDSA request signing, 3-header auth system, signed fetch patterns                                        |
| `verify-agents`          | On-chain verification, SelfAgentVerifier middleware, reputation, freshness, sybil detection               |
| `query-credentials`      | ZK-attested credentials, agent cards (A2A format), reputation scores                                      |
| `integrate-self-id`      | End-to-end integration: agent-side, service-side, on-chain gating, MCP setup                              |

### Building a custom agent?

For agents that don't support MCP (custom frameworks), point them at the machine-readable onboarding docs and let them use the REST API directly:

- `https://agent-api.self.xyz/llms.txt` — LLM-readable overview
- `https://agent-api.self.xyz/api/agent/bootstrap` — registration walkthrough as JSON
