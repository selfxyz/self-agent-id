---
name: integrate-self-id
description: >
  End-to-end integration guide for adding Self Agent ID to a project. Covers
  agent-side setup (SelfAgent class), service-side verification (SelfAgentVerifier),
  MCP server configuration, on-chain Solidity integration, and quick starts for
  TypeScript (Express, Hono, Next.js) and the REST API. Use when the user
  asks to "add self agent id", "integrate self id", "setup self agent", "add agent
  verification to my project", "self agent id sdk", "install agent sdk", or
  "integrate proof of human".
license: MIT
metadata:
  author: Self Protocol
  version: 1.0.0
  mcp-server: self-agent-id
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
  |        Connect to the hosted MCP server, use MCP tools for registration, lookup and verification.
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

// Check registration: isVerified = human proof present AND fresh
const info = await agent.getInfo();
if (!info.isVerified) {
  console.warn(
    info.hasHumanProof
      ? "Proof expired: refresh it (requestProofRefresh)"
      : "Not registered: register first (see the register-agent skill)",
  );
}

// Make authenticated requests (auto-signs with 3-header system)
const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "hello" }),
});
```

A new agent key comes from registration: `requestRegistration({ mode: "linked", humanAddress, ... })` returns a session whose `scanUrl` the human scans; after `waitForCompletion()`, `exportKey()` returns the private key. See the `register-agent` skill.

For Ed25519 agents (e.g. keys from Solana, OpenClaw or Eliza), use `Ed25519Agent` after registering the key with mode `"ed25519"` or `"ed25519-linked"`:

```typescript
import { Ed25519Agent } from "@selfxyz/agent-sdk";

const agent = new Ed25519Agent({ privateKey: process.env.ED25519_SEED! }); // 64 hex chars
const res = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "hello" }),
});
```

The TypeScript SDK (`@selfxyz/agent-sdk`) is the only SDK; agents in other languages call the REST API directly (registration via `POST /api/agent/register`) and sign requests by reproducing the algorithm in the `sign-requests` skill. The `fetch()` method wraps the native HTTP client, auto-attaching the `x-self-agent-address`, `x-self-agent-signature`, and `x-self-agent-timestamp` headers to every request (Ed25519 agents send `x-self-agent-key` and `x-self-agent-keytype` instead of the address).

---

## Service-Side Quick Start

Install the SDK on the server, configure a verifier with the desired checks, and protect API routes.

### TypeScript (Express)

```typescript
import express from "express";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: Buffer }).rawBody = buf; // auth() verifies the exact bytes
    },
  }),
);

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider() // on by default; keep it in production
  .sybilLimit(3)
  .includeCredentials()
  .build();

// Protect all /api routes
app.use("/api", verifier.auth());

// Access verified agent info in handlers
app.get("/api/profile", (req, res) => {
  const agent = req.agent!; // set by verifier.auth() // { address, agentKey, agentId, agentCount, nullifier, credentials? }
  res.json({
    agentId: agent.agentId.toString(),
    nationality: agent.credentials?.nationality,
  });
});

app.listen(3000);
```

Services in other languages can verify incoming requests with the public `self_verify_request` MCP tool, or check an agent's status with `GET /api/agent/verify/{chainId}/{agentId}`.

---

## MCP Server Setup

Give AI coding assistants (Claude Code, Cursor, Windsurf) access to Self Agent ID tools through the hosted MCP server (Streamable HTTP). This plugin's `.mcp.json` already configures it.

### Claude Code Configuration

Project `.mcp.json`:

```json
{
  "mcpServers": {
    "self-agent-id": {
      "type": "http",
      "url": "https://agent-api.self.xyz/api/mcp"
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
      "url": "https://agent-api.self.xyz/api/mcp"
    }
  }
}
```

### Public vs Privileged Tools

| Access     | Tool                         | Description                                                   |
| ---------- | ---------------------------- | ------------------------------------------------------------- |
| Public     | `self_register_agent`        | Start agent registration (QR + `session_token`)               |
| Public     | `self_check_registration`    | Poll registration; `reveal_private_key: true` exports the key |
| Public     | `self_lookup_agent`          | Look up any agent by `agent_id` or `agent_address`            |
| Public     | `self_list_agents_for_human` | List agents for a human address                               |
| Public     | `self_verify_agent`          | Verify an agent address against a policy                      |
| Public     | `self_verify_request`        | Validate a signed HTTP request against a policy               |
| Privileged | `self_get_identity`          | The server's configured agent identity                        |
| Privileged | `self_deregister_agent`      | Start deregistration of the server's agent                    |
| Privileged | `self_sign_request`          | Auth headers signed as the server's agent                     |
| Privileged | `self_authenticated_fetch`   | Signed HTTP request as the server's agent                     |

Privileged tools need `Authorization: Bearer <key>` matching the server's `MCP_PRIVILEGED_API_KEY(S)`, and the server's own `SELF_AGENT_PRIVATE_KEY`. The shared hosted deployment has no agent key, so these tools are only useful on a deployment you run yourself (configure it via `app/.env.example`: `SELF_AGENT_PRIVATE_KEY`, `SELF_AGENT_NETWORK` = `mainnet` (default) or `testnet`, `MCP_PRIVILEGED_API_KEY`). To sign with your own key, use the local stdio server below or the SDK.

### Local stdio server (your own key)

`@selfxyz/mcp-server` ([`mcp/`](../../../mcp/README.md)) runs the same 10 tools over stdio on your machine. With `SELF_AGENT_PRIVATE_KEY` set, the agent tools sign as your agent; the key never leaves the process. Configure with `SELF_AGENT_NETWORK` (`mainnet` default, or `testnet`), `SELF_RPC_URL` and `SELF_AGENT_API_BASE` (default `https://agent-api.self.xyz`).

```bash
claude mcp add self-agent-id -e SELF_AGENT_NETWORK=testnet -e SELF_AGENT_PRIVATE_KEY=0x... -- npx -y @selfxyz/mcp-server
```

---

## On-Chain Integration Quick Start (Solidity)

Declare the registry functions you need and add modifiers that gate contract functions on agent identity.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ISelfAgentRegistry {
    function hasHumanProof(uint256 agentId) external view returns (bool);
    function isProofFresh(uint256 agentId) external view returns (bool);
    function getProofProvider(uint256 agentId) external view returns (address);
}

contract MyContract {
    ISelfAgentRegistry public immutable registry;
    address public immutable selfProvider;

    constructor(address _registry, address _selfProvider) {
        registry = ISelfAgentRegistry(_registry);
        selfProvider = _selfProvider;
    }

    modifier onlyVerifiedAgent(uint256 agentId) {
        require(registry.hasHumanProof(agentId), "Not verified");
        // hasHumanProof ignores expiry; also require freshness
        require(registry.isProofFresh(agentId), "Proof expired");
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

### Contract Addresses

| Contract               | Mainnet (42220)                              | Testnet (11142220)                           |
| ---------------------- | -------------------------------------------- | -------------------------------------------- |
| SelfAgentRegistry      | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| SelfHumanProofProvider | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |
| Hub V2                 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |

---

## Handling Proof Expiry

Human proofs expire after `maxProofAge` (default: 365 days) or when the passport document expires, whichever comes first. Integrations should handle this gracefully.

### Service-Side: Detect Expired Proofs

The `SelfAgentVerifier` checks proof freshness via `isProofFresh()` as part of its `verify()` flow. When a proof has expired, the verifier returns `valid: false` with an error message. Handle this in your error responses to guide agents toward a proof refresh:

```typescript
// TypeScript
const result = await verifier.verify({
  signature,
  timestamp,
  method,
  url,
  body,
});
if (!result.valid && result.error === "Agent's human proof has expired") {
  return res.status(401).json({
    error: "Agent proof has expired",
    action: "refresh_proof",
  });
}
```

### Agent-Side: Monitor Expiry

Check `proofExpiresAt` proactively and warn before expiry:

```typescript
// TypeScript
const info = await agent.getInfo();
if (info.isExpiringSoon) {
  console.warn(
    `Proof expires in ${info.daysUntilExpiry} days — initiate refresh`,
  );
}
```

### On-Chain: Use isProofFresh()

```solidity
// Gate on freshness, not just proof existence
require(registry.isProofFresh(agentId), "Proof expired");
```

### Refresh Flow

**In-place refresh (preferred):** Use `requestProofRefresh({ agentId, network })` (or `POST /api/agent/refresh`) — the human scans their passport again and `proofExpiresAt` is updated without changing the agentId. Disclosures default to the agent's on-chain config.

**Deregister + re-register:** Required when changing verification config or key type, and for agent ids that the refresh endpoint rejects with 422 (ids whose 32-byte big-endian form contains a byte `>= 0x80`, e.g. 128–255: the Self app encodes `userDefinedData` as UTF-8). The agentId changes — update any stored references.

## Troubleshooting

These are the most frequently encountered issues during integration. Read through all of them before starting.

| Gotcha                                | Detail                                                                                                                                                                                                                                                                |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **userDefinedData is UTF-8**          | The Self SDK passes `userDefinedData` as a UTF-8 string, NOT raw bytes. All hex values in the payload are ASCII hex characters. An address is 40 ASCII characters, not 20 raw bytes.                                                                                  |
| **Use `--evm-version cancun`**        | Foundry builds that compile against Hub V2 / `@selfxyz/contracts` (e.g. this repo) need `--evm-version cancun` (PUSH0). Calling the registry through an interface does not.                                                                                           |
| **Provider verification is CRITICAL** | Without checking `getProofProvider()`, a fake provider could deploy a malicious contract that always returns `true` and register illegitimate agents. Always call `.requireSelfProvider()` in the SDK or check `getProofProvider(agentId) == SELF_PROVIDER` on-chain. |
| **bytes32 positioning**               | Use `bytes32(bytes1(uint8(x)))` not `bytes32(uint256(x))` for byte positioning in bytes32. Use `bytes32(uint256(uint160(addr)))` for address-to-agentKey conversion (address in the low-order bytes), not `bytes32(bytes20(addr))`.                                   |
| **Session tokens**                    | Registration/deregistration/refresh status, QR and export calls take the session token only as `Authorization: Bearer <sessionToken>`, and every status response rotates it. `?token=` query parameters are rejected.                                                 |
| **SELF_AGENT_API_BASE**               | `SELF_AGENT_API_BASE` is the canonical env var. `SELF_API_URL` has been removed. Default: `https://agent-api.self.xyz`.                                                                                                                                               |
| **Celo Sepolia chain ID**             | Celo Sepolia is chain `11142220`, NOT `44787` (deprecated Alfajores). RPC: `https://forno.celo-sepolia.celo-testnet.org`.                                                                                                                                             |
| **Blockscout verification**           | Blockscout does not need an API key for contract verification. Celoscan verification should use the Sourcify verifier (not etherscan verifier) as the Celoscan API endpoint is flaky.                                                                                 |
| **Timestamp precision**               | Auth headers use millisecond timestamps (e.g., `"1708704000000"`), not seconds.                                                                                                                                                                                       |
| **Signature message format**          | The signed message is `keccak256(timestamp + METHOD + pathWithQuery + bodyHash)`, where bodyHash is `keccak256(body)` as a hex string including the `0x` prefix.                                                                                                      |

---

## Testing End-to-End

Follow this sequence to validate a full integration from registration through verification:

1. **Register on testnet first** — Use chain `11142220` (Celo Sepolia). No real funds needed. Set `network: "testnet"` in the SDK or pass `network: "testnet"` to the MCP tools.

2. **Scan QR with Self app** — The registration flow generates a QR code. Open the Self app, scan the QR, and scan the passport NFC chip. The Self app generates a ZK proof locally and submits it on-chain.

3. **Poll for completion** — `await session.waitForCompletion()` (SDK) or call `self_check_registration` (MCP) every 5-10 seconds. The flow typically takes 30-90 seconds. Sessions expire after 30 minutes.

4. **Test request signing** — Use `agent.signRequest()` to generate the 3 auth headers. Verify them using `SelfAgentVerifier` or `self_verify_request`.

5. **Verify credentials match** — Call `agent.getCredentials()` or `self_lookup_agent` and confirm the stored credentials (nationality, age threshold, OFAC status) match the selected verification config.

6. **Test signed fetch** — Make a full round-trip: agent signs a request to a protected endpoint, the server verifies the signature and on-chain state, and returns agent-specific data.

7. **Test failure cases** — Verify that the server correctly rejects: missing headers (401), expired timestamps (401), invalid signatures (401), unregistered agents (401), wrong provider (401), and sybil limit exceeded (401). The SDK middleware answers every verification failure with 401, and 429 when rate limited.

---

## Reference Documentation

For the complete SDK API reference covering all classes, methods, types, and constants of the TypeScript SDK, see [`references/sdk-reference.md`](references/sdk-reference.md).

For full runnable integration examples across Express, Hono, Next.js, and Solidity, see [`references/framework-examples.md`](references/framework-examples.md).
