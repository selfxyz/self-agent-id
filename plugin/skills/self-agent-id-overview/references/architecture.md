# Self Agent ID — System Architecture

## System Overview

Self Agent ID is a multi-layer system spanning smart contracts, a REST API, a TypeScript SDK, and an MCP server. The following diagram illustrates the primary data flows:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REGISTRATION FLOW                              │
│                                                                        │
│  Human (passport)                                                      │
│       │                                                                │
│       ▼                                                                │
│  Self App (reads NFC chip, generates ZK proof)                         │
│       │                                                                │
│       ▼                                                                │
│  Hub V2 (on-chain ZK verification)                                     │
│       │                                                                │
│       ▼                                                                │
│  SelfAgentRegistry.customVerificationHook() → mints soulbound ERC-721  │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                       AUTHENTICATION FLOW                              │
│                                                                        │
│  AI Agent (private key)                                                │
│       │                                                                │
│       ▼                                                                │
│  SDK: SelfAgent.signRequest() → 3 HTTP headers                         │
│       │  x-self-agent-address                                          │
│       │  x-self-agent-signature                                        │
│       │  x-self-agent-timestamp                                        │
│       ▼                                                                │
│  Service API                                                           │
│       │                                                                │
│       ▼                                                                │
│  SDK: SelfAgentVerifier.verify() → checks signature + on-chain state   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                          MCP INTEGRATION                               │
│                                                                        │
│  Claude Code / Cursor / AI IDE                                         │
│       │                                                                │
│       ▼                                                                │
│  agent-api.self.xyz/api/mcp (Streamable HTTP)                          │
│       │                                                                │
│       ▼                                                                │
│  10 tools: 6 public, 4 privileged (Bearer MCP key)                     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Smart Contract Architecture

All contracts are written in Solidity 0.8.28, compiled with `--evm-version cancun` (Hub V2 uses PUSH0), and deployed via Foundry.

### SelfAgentRegistry

The core contract (UUPS proxy). Inherits from:

- `ImplRoot` — UUPS upgrades + `AccessControl` (`SECURITY_ROLE`, `OPERATIONS_ROLE`; multisigs on mainnet)
- `ERC721Upgradeable` (OpenZeppelin) — soulbound NFT issuance
- `SelfVerificationRootUpgradeable` (@selfxyz/contracts) — Hub V2 ZK verification callback
- `EIP712Upgradeable` — typed-data signatures (`setAgentWallet`)
- `IERC8004ProofOfHuman` — ERC-8004 proof-of-human extension

**Key responsibilities:**

- Mint soulbound ERC-721 NFTs upon successful ZK verification
- Support the registration actions `R` (simple), `K` (advanced, used by the `linked` / `privy` / `smartwallet` API modes), `W` (wallet-free), `E` (Ed25519), `F` (in-place proof refresh) and `I` (identify)
- Store ZK-attested credentials (nationality, age, OFAC status) on-chain
- Manage 6 verification configs (age 0/18/21 x OFAC on/off)
- Enforce sybil limits (max agents per human, default 1)
- Provide agent key <-> agent ID mappings
- Guardian revocation for compromised agents
- Self-deregistration by NFT owner

**Registration modes and action bytes:**

- `R` (0x52) — Simple register: agent key = wallet address
- `K` (0x4B) — Advanced register: separate agent keypair, ECDSA signature verified
- `W` (0x57) — Wallet-free: agent-owned NFT, optional guardian address
- `D` (0x44) — Simple deregister
- `X` (0x58) — Advanced deregister

**userDefinedData format:** `| 1B action | 1B configIndex ('0'-'5') | payload... |`

The config index at byte position [1] selects which of the 6 verification configs to use. The Self SDK sends UTF-8 strings, so ASCII `'0'` through `'5'` (0x30-0x35) map to config indices 0-5.

### SelfHumanProofProvider

A lightweight metadata wrapper implementing `IHumanProofProvider`. Reports:

- `providerName()` returns `"self"`
- `verificationStrength()` returns `100`
- `verifyHumanProof()` always reverts with `DirectVerificationNotSupported`

The revert is intentional: Self Hub V2 uses an async callback pattern. Verification must flow through `SelfAgentRegistry.verifySelfProof()` -> Hub V2 -> `onVerificationSuccess` -> `customVerificationHook`. The provider contract exists solely to satisfy the ERC-8004 provider whitelist and report metadata.

Immutable state:

- `hubV2` — The Hub V2 contract address
- `scope` — The scope value for nullifier generation (computed at registry deploy time)

### Reputation & Validation

| Contract                 | Kind                         | Deployed | Key functions                                                                                            |
| ------------------------ | ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `SelfReputationRegistry` | ERC-8004 feedback registry   | Yes      | `giveFeedback`, `readFeedback`, `getSummary`; auto `proof-of-human` entry at mint                        |
| `SelfValidationRegistry` | ERC-8004 validation registry | Yes      | `validationRequest/Response`, `getSummary`, `submitFreshnessValidation`, `getLatestFreshness`            |
| `SelfReputationSignal`   | View wrapper                 | No       | `getReputationScore` (= provider `verificationStrength()`), `getReputation`                              |
| `SelfFreshnessChecker`   | View wrapper                 | No       | `validateAgent`, `isValidAgent`, `freshnessThreshold` (default 6,307,200 blocks ≈ 73 days at ~1 s/block) |

Addresses and signatures: [contracts.md](contracts.md).

## SDK Architecture

The TypeScript SDK (`@selfxyz/agent-sdk`) is the only SDK; other languages use the REST API.

### SelfAgent (Agent-Side)

The `SelfAgent` class is instantiated by the agent (the AI system making authenticated requests). It manages:

**Construction:**

```typescript
const agent = new SelfAgent({
  privateKey: "0x...", // Agent's ECDSA private key
  network: "mainnet", // or "testnet" (default "mainnet")
  // registryAddress / rpcUrl: optional overrides
});
```

**Core methods:**

- `signRequest(method, url, body?)` — Generate the 3 auth headers
- `fetch(url, options?)` — Wrapper around fetch() that auto-signs requests
- `getInfo()` — On-chain identity: `agentId`, `isVerified` (`hasHumanProof && isProofFresh`), `proofExpiresAt`, sybil data
- `isRegistered()` — Human proof present (does not check freshness)
- `getCredentials()` — Read on-chain credentials for this agent
- `getAgentCard()` / `setAgentCard(fields)` — Read / write the agent's A2A card
- `requestDeregistration(opts?)` — Start a deregistration session

Registration and refresh are standalone REST helpers (`requestRegistration` is also a `SelfAgent` static): `requestRegistration(opts)` returns a session with `scanUrl`, `deepLink`, `waitForCompletion()` and `exportKey()`; `requestProofRefresh({ agentId })` returns a session with `waitForCompletion()`.

**Auth header generation:**

1. Compute body hash: `keccak256(body || "")`
2. Build message: concatenate `timestamp + METHOD + pathWithQuery + bodyHash` as a single string
3. Compute signing message: `keccak256(message)`
4. Sign with EIP-191: `personal_sign(signingMessage, privateKey)`
5. Return headers: `{ x-self-agent-address, x-self-agent-signature, x-self-agent-timestamp }`

### SelfAgentVerifier (Service-Side)

The `SelfAgentVerifier` class is used by services receiving agent requests. It verifies signatures and checks on-chain state. Builder pattern configuration:

```typescript
const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireSelfProvider() // default on: provider must be Self Protocol
  .sybilLimit(1) // default 1 agent per human
  .maxAge(5 * 60_000) // 5-minute signature window (default)
  .build();
```

**Verification pipeline:**

1. Extract the auth headers from the request
2. Validate timestamp is within allowed window
3. Reconstruct the signed message from request data
4. Recover the signer address from the signature (ECDSA) or verify the Ed25519 signature
5. Reject replays (signature + timestamp cache)
6. Derive agent key: `bytes32(uint256(uint160(address)))` (or the Ed25519 pubkey)
7. Call `registry.isVerifiedAgent(agentKey)` and `isProofFresh(agentId)` on-chain
8. Check `registry.getProofProvider(agentId)` matches Self Protocol (default on)
9. Check sybil limits via `getAgentCountForHuman(nullifier)` (default max 1)
10. Optional credential checks (age, OFAC, nationality) and rate limiting

**Middleware support:**

- Express: `verifier.auth()` (sets `req.agent`)
- Generic: `verifier.verify({ signature, timestamp, method, url, body })` returns `{ valid, agentAddress, agentId, error?, ... }`

### Registration Utilities

Mode-specific `userDefinedData` builders handle the encoding of action bytes, config indices, agent addresses, and ECDSA signatures into the format expected by the registry's `customVerificationHook`.

## MCP Server Architecture

The hosted MCP server is a Next.js route (`/api/mcp`, Streamable HTTP) in the same deployment as the REST API. Its tools call this deployment's REST route handlers in-process (or another deployment's REST API over HTTP when `SELF_AGENT_API_BASE` is set). Rate limit: 120 requests/min per IP.

### Tools (10)

**Public (6) — no authorization:**

| Tool                         | Description                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------- |
| `self_register_agent`        | Start registration (`minimum_age?`, `ofac?`, `human_address?` → `linked`, else `wallet-free`) |
| `self_check_registration`    | Poll with `session_token`; `reveal_private_key: true` exports the key once completed          |
| `self_lookup_agent`          | Look up any agent by `agent_id` or `agent_address`                                            |
| `self_list_agents_for_human` | List agents linked to a human address                                                         |
| `self_verify_agent`          | Check an agent address against a policy                                                       |
| `self_verify_request`        | Verify a signed HTTP request against a policy                                                 |

Verify policy parameters: `network`, `require_age` (0/18/21), `require_ofac`, `require_self_provider` (default true), `max_agents_per_human` (default 1, 0 = no limit). Both verify tools require a fresh proof.

**Privileged (4) — `Authorization: Bearer <MCP_PRIVILEGED_API_KEY>`; act as the server's `SELF_AGENT_PRIVATE_KEY`:**

| Tool                       | Description                                    |
| -------------------------- | ---------------------------------------------- |
| `self_get_identity`        | The server agent's on-chain identity           |
| `self_deregister_agent`    | Start deregistration of the server agent       |
| `self_sign_request`        | Generate auth headers for an HTTP request      |
| `self_authenticated_fetch` | Make a signed HTTP request (public hosts only) |

### Resources (2)

| URI               | Access     | Description                                                 |
| ----------------- | ---------- | ----------------------------------------------------------- |
| `self://networks` | Public     | Network configuration (chain IDs, RPCs, contract addresses) |
| `self://identity` | Privileged | The server agent's identity state (if configured)           |

### Prompts (1)

| Name                          | Description                                                     |
| ----------------------------- | --------------------------------------------------------------- |
| `self_integrate_verification` | Guided prompt for integrating agent verification into a service |

### Sessions

The server keeps no session state: registration state lives in the encrypted `session_token` returned to the client, which rotates on every poll.

## REST API Endpoints

Base URL: `https://agent-api.self.xyz` (override via `SELF_AGENT_API_BASE` environment variable).

Session tokens are sent only as `Authorization: Bearer <sessionToken>`; every status response returns a rotated token. Completion is read from the chain — there are no callback endpoints.

### Registration

| Method | Path                                    | Description                                                           |
| ------ | --------------------------------------- | --------------------------------------------------------------------- |
| `POST` | `/api/agent/register`                   | Start registration (returns `sessionToken`, `scanUrl`, `deepLink`, …) |
| `GET`  | `/api/agent/register/status`            | Poll registration status (Bearer)                                     |
| `GET`  | `/api/agent/register/qr`                | QR data, deep link and `scanUrl` (Bearer)                             |
| `POST` | `/api/agent/register/export`            | Export the server-generated key after completion (Bearer)             |
| `POST` | `/api/agent/register/ed25519-challenge` | Challenge for Ed25519 modes                                           |
| `GET`  | `/api/agent/register/ed25519-check`     | Is an Ed25519 pubkey registered (`?pubkey=&network=`)                 |
| `GET`  | `/api/qr/{qrToken}`                     | PNG QR code (`scanUrl`)                                               |

### Deregistration, Refresh, Identify

| Method | Path                           | Description                            |
| ------ | ------------------------------ | -------------------------------------- |
| `POST` | `/api/agent/deregister`        | Start deregistration                   |
| `GET`  | `/api/agent/deregister/status` | Poll deregistration status (Bearer)    |
| `POST` | `/api/agent/refresh`           | Start an in-place proof refresh        |
| `GET`  | `/api/agent/refresh/status`    | Poll refresh status (Bearer)           |
| `POST` | `/api/agent/identify`          | Look up the scanning human's nullifier |
| `GET`  | `/api/agent/identify/status`   | Poll identify status (Bearer)          |

### Agent Info & Discovery

| Method | Path                                                   | Description                  |
| ------ | ------------------------------------------------------ | ---------------------------- |
| `GET`  | `/api/agent/info/{chainId}/{agentId}`                  | Get agent details            |
| `GET`  | `/api/agent/agents/{chainId}/{address}`                | List agents for an address   |
| `GET`  | `/api/agent/verify/{chainId}/{agentId}`                | Verify agent on-chain status |
| `GET`  | `/api/verify-status/{chainId}/{agentId}`               | Compact verification summary |
| `GET`  | `/api/agent/agents-by-nullifier/{chainId}/{nullifier}` | Agents backed by one human   |

Per-agent read routes return 404 `{ "error": "Agent not found" }` for never-minted or burned agents, 400 for an unsupported chain ID or malformed input, and 502 `{ "error": "RPC error" }` on upstream failures. `isVerified` / `verified` always means `hasHumanProof && isProofFresh`.

### Cards & Reputation

| Method | Path                                  | Description                     |
| ------ | ------------------------------------- | ------------------------------- |
| `GET`  | `/api/cards/{chainId}/{agentId}`      | Get agent's public profile card |
| `GET`  | `/api/reputation/{chainId}/{agentId}` | Get agent's reputation score    |

### Discovery & Health

| Method | Path                              | Description                                                                                                  |
| ------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET`  | `/api/health`                     | Health check — returns `{ status, service, timestamp }`                                                      |
| `GET`  | `/api/agent/bootstrap`            | OpenAPI 3.1.0 spec for registration endpoints                                                                |
| `POST` | `/api/a2a`                        | A2A JSON-RPC (v0.3.0; message parts use `kind`): lookup, verify, register, deregister, refresh-proof, status |
| `POST` | `/api/mcp`                        | MCP server (Streamable HTTP)                                                                                 |
| `GET`  | `/api/agent-discovery`            | Full structured discovery JSON (modes, networks, endpoints)                                                  |
| `GET`  | `/llms.txt`                       | Plain-text LLM-readable documentation                                                                        |
| `GET`  | `/agents.json`                    | Compact discovery JSON with links to all endpoints                                                           |
| `GET`  | `/.well-known/agent-card.json`    | A2A v0.3.0 agent card (generic or per-agent with `?agentId=`)                                                |
| `GET`  | `/.well-known/self-agent-id.json` | Structured agent discovery metadata                                                                          |
| `GET`  | `/.well-known/agent-registration` | 307 redirect to `/api/agent/bootstrap`                                                                       |

### Content Negotiation

The root path (`/`) serves different content based on the `Accept` header:

| Accept Header      | Response                          |
| ------------------ | --------------------------------- |
| `application/json` | Agent discovery JSON              |
| `text/plain`       | `llms.txt`                        |
| anything else      | `308` redirect to `docs.self.xyz` |

The service has no HTML UI.

## Data Flow Diagrams

### Registration Flow

```
1. Agent/User initiates registration
   └── SDK: requestRegistration({ mode, network, disclosures, humanAddress? })

2. Backend creates registration session
   └── POST /api/agent/register → returns { sessionToken, deepLink, scanUrl, qrImageBase64, agentAddress, ... }

3. Human scans QR code with Self app
   └── Self app reads passport NFC chip
   └── Self app generates ZK proof locally

4. Self app submits proof to Hub V2
   └── verifySelfProof(proofPayload, userContextData)
   └── userContextData = | destChainId | userIdentifier | userDefinedData |
   └── userDefinedData = | action | configIndex | payload... |

5. Hub V2 verifies ZK proof
   └── Checks proof validity against verification config
   └── Extracts nullifier, userIdentifier, disclosed attributes

6. Hub V2 calls back to SelfAgentRegistry
   └── onVerificationSuccess → customVerificationHook(output, userData)

7. Registry processes the action
   ├── 'R': Simple register — agentKey = wallet address, mint NFT
   ├── 'K': Advanced register — verify ECDSA signature, mint NFT
   ├── 'W': Wallet-free — mint NFT to agent address, optional guardian
   ├── 'E': Ed25519 — verify Ed25519 signature, mint NFT to derived address
   ├── 'F': Refresh — renew proofExpiresAt for an existing agentId
   ├── 'D': Simple deregister — revoke proof, burn NFT
   └── 'X': Advanced deregister — revoke by agent address

8. Credentials stored on-chain
   └── _storeCredentials(agentId, output)
   └── Stores: nationality, olderThan, ofac, issuingState, etc.

9. Registration complete
   └── AgentRegisteredWithHumanProof event emitted
   └── GET /api/agent/register/status (Bearer) reads the chain and returns { stage: "completed", agentId, ... }
   └── POST /api/agent/register/export (Bearer) returns the generated key (30-minute window)
```

### Authentication Flow

```
1. Agent prepares an HTTP request
   └── SelfAgent.signRequest("POST", "/api/data", body)

2. SDK computes auth headers
   ├── bodyHash = keccak256(body || "")
   ├── timestamp = Date.now().toString()              // milliseconds
   ├── message = timestamp + "POST" + "/api/data" + bodyHash  // concatenation
   ├── signingMessage = keccak256(message)
   ├── signature = personal_sign(signingMessage, privateKey)
   └── Returns 3 headers

3. Agent sends request with headers
   ├── x-self-agent-address: 0xAgentAddress
   ├── x-self-agent-signature: 0xSignature
   └── x-self-agent-timestamp: 1708704000000

4. Service receives request
   └── SelfAgentVerifier.verify({ signature, timestamp, method, url, body })

5. Verifier checks signature
   ├── Validate timestamp within 5-minute window
   ├── Reconstruct message from request
   ├── Recover signer from signature
   └── Reject replays

6. Verifier checks on-chain state
   ├── Derive agentKey from address
   ├── Call registry.isVerifiedAgent(agentKey)
   ├── Check isProofFresh(agentId)
   ├── Check provider matches Self Protocol (default on)
   ├── Check sybil limits (default max 1 agent per human)
   └── Optionally: credentials (age, OFAC, nationality)

7. Verification result
   └── { valid: true, agentAddress, agentId }
   └── Or { valid: false, error: "..." }
```

### Verification Flow (Contract-to-Contract)

```
1. Smart contract receives an agent ID
   └── e.g., from a meta-transaction or parameter

2. Check human proof exists and is fresh
   └── registry.hasHumanProof(agentId) → bool
   └── registry.isProofFresh(agentId) → bool

3. Check proof provider is trusted
   └── registry.getProofProvider(agentId) → address
   └── Compare against known Self Protocol provider address

4. Check verification strength (optional)
   └── IHumanProofProvider(provider).verificationStrength() → 0-100 (Self = 100)

5. Check sybil status (optional)
   └── registry.sameHuman(agentIdA, agentIdB) → bool
   └── registry.getAgentCountForHuman(nullifier) → uint256

6. Read credentials (optional)
   └── registry.getAgentCredentials(agentId)
   └── Returns: nationality, olderThan, ofac, etc.
```

## Network Configuration

### Celo Mainnet (Production)

| Property   | Value                                                                               |
| ---------- | ----------------------------------------------------------------------------------- |
| Chain ID   | 42220                                                                               |
| RPC        | `https://forno.celo.org`                                                            |
| Block time | ~1 second                                                                           |
| Registry   | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944`                                        |
| Provider   | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d`                                        |
| Reputation | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4`                                        |
| Validation | `0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577`                                        |
| Hub V2     | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF`                                        |
| Agent Visa | `0xCa97f7586CF9De62B8ca516d7Ee25f6AEae5e109`                                        |
| Explorer   | [celoscan.io](https://celoscan.io) / [explorer.celo.org](https://explorer.celo.org) |

### Celo Sepolia (Testnet)

| Property   | Value                                                              |
| ---------- | ------------------------------------------------------------------ |
| Chain ID   | 11142220                                                           |
| RPC        | `https://forno.celo-sepolia.celo-testnet.org`                      |
| Block time | ~1 second                                                          |
| Registry   | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379`                       |
| Provider   | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c`                       |
| Reputation | `0x3Bb0A898C1C0918763afC22ff624131b8F420CC2`                       |
| Validation | `0x84cA20B8A1559F136dA03913dbe6A7F68B6B240B`                       |
| Hub V2     | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74`                       |
| Agent Visa | `0xf049FD6260Fce964B82728A86CF1BbEB8AB3E875`                       |
| Explorer   | [celo-sepolia.blockscout.com](https://celo-sepolia.blockscout.com) |

### Important Network Notes

- Celo Sepolia chain ID is **11142220** (NOT 44787, which was the deprecated Alfajores testnet)
- Use `--evm-version cancun` when compiling with Foundry (Hub V2 uses PUSH0 opcode)
- Celoscan contract verification: use the Sourcify verifier (the Etherscan-style API endpoint is unreliable)
- Blockscout does not require an API key for contract verification
