# Self Agent ID — System Architecture

## System Overview

Self Agent ID is a multi-layer system spanning smart contracts, backend APIs, client SDKs, an MCP server, and a web application. The following diagram illustrates the primary data flows:

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
│  @selfxyz/mcp-server (stdio transport)                                 │
│       │                                                                │
│       ▼                                                                │
│  10 tools: identity (4), auth (2), discovery (2), verification (2)     │
└─────────────────────────────────────────────────────────────────────────┘
```

## Smart Contract Architecture

All contracts are written in Solidity 0.8.28, compiled with `--evm-version cancun` (Hub V2 uses PUSH0), and deployed via Foundry.

### SelfAgentRegistry

The core contract. Inherits from:
- `ERC721` (OpenZeppelin) — soulbound NFT issuance
- `Ownable` (OpenZeppelin) — admin functions (provider whitelist, config)
- `SelfVerificationRoot` (@selfxyz/contracts) — Hub V2 ZK verification callback
- `IERC8004ProofOfHuman` — ERC-8004 proof-of-human extension

**Key responsibilities:**
- Mint soulbound ERC-721 NFTs upon successful ZK verification
- Support 4 registration modes (simple, advanced, wallet-free, smart-wallet)
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

### SelfReputationProvider

A stateless view-only wrapper implementing ERC-8004 reputation scoring. It reads `verificationStrength()` from the proof provider that verified each agent. No storage of its own — purely reads from the registry and provider contracts.

Functions:
- `getReputationScore(agentId)` — Returns 0-100 score (0 if unverified)
- `getReputation(agentId)` — Returns (score, providerName, hasProof, registeredAtBlock)
- `getReputationBatch(agentIds)` — Batch query for multiple agents

Score interpretation:
- 100 = Passport NFC chip + biometric (Self Protocol)
- 60 = Government ID without chip
- 40 = Video liveness check
- 0 = No proof or unverified

### SelfValidationProvider

An ERC-8004 validation provider performing freshness checks. Measures proof age in blocks since registration and compares against a configurable threshold.

Functions:
- `validateAgent(agentId)` — Returns (valid, fresh, registeredAt, blockAge, proofProvider)
- `isValidAgent(agentId)` — Returns true only if valid AND fresh
- `validateBatch(agentIds)` — Batch boolean check
- `setFreshnessThreshold(blocks)` — Owner-only configuration

Default threshold: 6,307,200 blocks (~1 year on Celo at 5 seconds per block).

### AgentDemoVerifier

An example contract demonstrating EIP-712 meta-transaction verification. Agents sign typed data off-chain; any relayer can submit the transaction. Demonstrates how to gate contract functions behind agent identity verification.

### AgentGate

An example contract demonstrating age-gated access control. Reads `getAgentCredentials(agentId)` from the registry and requires `olderThan >= threshold`. Shows how to combine on-chain credential checks with agent identity.

## SDK Architecture

All three SDKs (TypeScript, Python, Rust) follow identical API designs.

### SelfAgent (Agent-Side)

The `SelfAgent` class is instantiated by the agent (the AI system making authenticated requests). It manages:

**Construction:**
```typescript
const agent = new SelfAgent({
  privateKey: "0x...",           // Agent's ECDSA private key
  chainId: 42220,               // Celo Mainnet (or 11142220 for testnet)
  registryAddress: "0x62E3...", // Optional override
});
```

**Core methods:**
- `signRequest(method, path, body?)` — Generate the 3 auth headers
- `register(mode, options?)` — Initiate registration flow (returns QR URL)
- `getRegistrationStatus()` — Poll registration completion
- `fetch(url, options?)` — Wrapper around fetch() that auto-signs requests
- `getCredentials()` — Read on-chain credentials for this agent
- `getAgentCard()` — Get the agent's public profile card
- `getAgentId()` — Resolve agent key to agent ID

**Auth header generation:**
1. Compute body hash: `keccak256(body || "")`
2. Build message: concatenate `timestamp + METHOD + pathWithQuery + bodyHash` as a single string
3. Compute signing message: `keccak256(message)`
4. Sign with EIP-191: `personal_sign(signingMessage, privateKey)`
5. Return headers: `{ x-self-agent-address, x-self-agent-signature, x-self-agent-timestamp }`

### SelfAgentVerifier (Service-Side)

The `SelfAgentVerifier` class is used by services receiving agent requests. It verifies signatures and checks on-chain state. Builder pattern configuration:

```typescript
const verifier = new SelfAgentVerifier()
  .setChainId(42220)
  .setRegistryAddress("0x62E3...")
  .setProviderAddress("0x0B43...")   // Verify provider is Self Protocol
  .setMaxAgentsPerHuman(1)           // Sybil limit
  .setMaxTimestampAge(300)           // 5-minute signature window
  .build();
```

**Verification pipeline:**
1. Extract 3 headers from the request
2. Validate timestamp is within allowed window
3. Reconstruct the signed message from request data
4. Recover signer address from signature via ECDSA
5. Compare recovered address to `x-self-agent-address`
6. Derive agent key: `bytes32(uint256(uint160(address)))`
7. Call `registry.isVerifiedAgent(agentKey)` on-chain
8. Optionally check `registry.getProofProvider(agentId)` matches expected provider
9. Optionally check sybil limits via `getAgentCountForHuman(nullifier)`

**Middleware support:**
- Express: `verifier.expressMiddleware()`
- Generic: `verifier.verify(request)` returns `{ valid, agentAddress, agentId, error? }`

### Registration Utilities

Mode-specific `userDefinedData` builders handle the encoding of action bytes, config indices, agent addresses, and ECDSA signatures into the format expected by the registry's `customVerificationHook`.

## MCP Server Architecture

The `@selfxyz/mcp-server` package implements the Model Context Protocol for AI coding assistants.

### Tools (10)

**Identity (4):**
| Tool | Description |
|---|---|
| `self_register_agent` | Initiate agent registration (returns QR code URL) |
| `self_check_registration` | Poll registration completion status |
| `self_get_identity` | Get current agent's on-chain identity |
| `self_deregister_agent` | Initiate agent deregistration |

**Auth (2):**
| Tool | Description |
|---|---|
| `self_sign_request` | Generate auth headers for an HTTP request |
| `self_authenticated_fetch` | Make a signed HTTP request (server performs fetch) |

**Discovery (2):**
| Tool | Description |
|---|---|
| `self_lookup_agent` | Look up any agent by agent ID or address |
| `self_list_agents_for_human` | List all agents registered by a human address |

**Verification (2):**
| Tool | Description |
|---|---|
| `self_verify_agent` | Verify agent's on-chain proof status |
| `self_verify_request` | Verify signed HTTP request authenticity |

### Resources (2)

| URI | Description |
|---|---|
| `self://networks` | Network configuration (chain IDs, RPCs, contract addresses) |
| `self://identity` | Current agent identity state (if configured) |

### Prompts (1)

| Name | Description |
|---|---|
| `self_integrate_verification` | Guided prompt for integrating agent verification into a service |

### Session Management

- Storage: in-memory (no persistence across restarts)
- Maximum concurrent sessions: 50
- Session TTL: 30 minutes (auto-cleanup)
- Transport: stdio (standard for MCP servers)

## REST API Endpoints

Base URL: `https://self-agent-id.vercel.app` (override via `SELF_AGENT_API_BASE` environment variable).

### Registration

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/agent/register` | Start registration (returns session ID) |
| `GET` | `/api/agent/register/status?token=X` | Poll registration status |
| `GET` | `/api/agent/register/qr?token=X` | Get QR code for Self app scanning |
| `POST` | `/api/agent/register/callback` | Hub V2 callback (internal) |

### Deregistration

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/agent/deregister` | Start deregistration |
| `GET` | `/api/agent/deregister/status?token=X` | Poll deregistration status |
| `POST` | `/api/agent/deregister/callback` | Hub V2 callback (internal) |

### Agent Info & Discovery

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/agent/info/{chainId}/{agentId}` | Get agent details |
| `GET` | `/api/agent/agents/{chainId}/{address}` | List agents for an address |
| `GET` | `/api/agent/verify/{chainId}/{agentId}` | Verify agent on-chain status |

### Cards & Reputation

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/cards/{chainId}/{agentId}` | Get agent's public profile card |
| `GET` | `/api/reputation/{chainId}/{agentId}` | Get agent's reputation score |

## Data Flow Diagrams

### Registration Flow

```
1. Agent/User initiates registration
   ├── SDK: SelfAgent.register(mode, { configIndex, ... })
   └── dApp: User clicks "Register" button

2. Backend creates registration session
   └── POST /api/agent/register → returns { sessionToken, qrData, deepLink }

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
   ├── 'W': Wallet-free — mint NFT to agent address, set guardian
   ├── 'D': Simple deregister — revoke proof, burn NFT
   └── 'X': Advanced deregister — revoke by agent address

8. Credentials stored on-chain
   └── _storeCredentials(agentId, output)
   └── Stores: nationality, olderThan, ofac, issuingState, etc.

9. Registration complete
   └── AgentRegisteredWithHumanProof event emitted
   └── Status API returns { status: "complete", agentId }
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
   └── SelfAgentVerifier.verify(request)

5. Verifier checks signature
   ├── Validate timestamp within 5-minute window
   ├── Reconstruct message from request
   ├── Recover signer from signature
   └── Compare recovered address to header address

6. Verifier checks on-chain state
   ├── Derive agentKey from address
   ├── Call registry.isVerifiedAgent(agentKey)
   ├── Optionally: check provider matches Self Protocol
   ├── Optionally: check sybil limits
   └── Optionally: check freshness via ValidationProvider

7. Verification result
   └── { valid: true, agentAddress, agentId }
   └── Or { valid: false, error: "..." }
```

### Verification Flow (Contract-to-Contract)

```
1. Smart contract receives an agent ID
   └── e.g., from a meta-transaction or parameter

2. Check human proof exists
   └── registry.hasHumanProof(agentId) → bool

3. Check proof provider is trusted
   └── registry.getProofProvider(agentId) → address
   └── Compare against known Self Protocol provider address

4. Check reputation score
   └── reputationProvider.getReputationScore(agentId) → 0-100

5. Check proof freshness
   └── validationProvider.isValidAgent(agentId) → bool
   └── Or: validationProvider.validateAgent(agentId) for full details

6. Check sybil status (optional)
   └── registry.sameHuman(agentIdA, agentIdB) → bool
   └── registry.getAgentCountForHuman(nullifier) → uint256

7. Read credentials (optional)
   └── registry.getAgentCredentials(agentId)
   └── Returns: nationality, olderThan, ofac, etc.
```

## Network Configuration

### Celo Mainnet (Production)

| Property | Value |
|---|---|
| Chain ID | 42220 |
| RPC | `https://forno.celo.org` |
| Block time | ~5 seconds |
| Registry | `0x60651482a3033A72128f874623Fc790061cc46D4` |
| Provider | `0xb0F718Bad279e51A9447D36EAa457418dBd4D95b` |
| DemoVerifier | `0x404A2Bce7Dc4A9c19Cc41c4247E2bA107bce394C` |
| AgentGate | `0xD4B30Da5319893FEAB07620DbFf0945e3aDef619` |
| Hub V2 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` |
| Explorer | [celoscan.io](https://celoscan.io) / [explorer.celo.org](https://explorer.celo.org) |

### Celo Sepolia (Testnet)

| Property | Value |
|---|---|
| Chain ID | 11142220 |
| RPC | `https://forno.celo-sepolia.celo-testnet.org` |
| Block time | ~5 seconds |
| Registry | `0x29d941856134b1D053AfFF57fa560324510C79fa` |
| Provider | `0x8e248DEB0F18B0A4b1c608F2d80dBCeB1B868F81` |
| DemoVerifier | `0x31A5A1d34728c5e6425594A596997A7Bf4aD607d` |
| AgentGate | `0x9880Dc26c5D5aAA334e12C255a03A3Be3E50003E` |
| Hub V2 | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |
| Explorer | [celo-sepolia.celoscan.io](https://celo-sepolia.celoscan.io) |

### Important Network Notes

- Celo Sepolia chain ID is **11142220** (NOT 44787, which was the deprecated Alfajores testnet)
- Use `--evm-version cancun` when compiling with Foundry (Hub V2 uses PUSH0 opcode)
- Celoscan contract verification: use the Sourcify verifier (the Etherscan-style API endpoint is unreliable)
- Blockscout does not require an API key for contract verification
