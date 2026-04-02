# SDK Reference

Complete API reference for the Self Agent ID SDKs across TypeScript, Python, and Rust. All three SDKs expose identical API surfaces with language-idiomatic naming conventions (camelCase for TypeScript, snake_case for Python, snake_case for Rust).

---

## Packages

| Language   | Package              | Install                          |
| ---------- | -------------------- | -------------------------------- |
| TypeScript | `@selfxyz/agent-sdk` | `npm install @selfxyz/agent-sdk` |
| Python     | `selfxyz-agent-sdk`  | `pip install selfxyz-agent-sdk`  |
| Rust       | `self-agent-sdk`     | `cargo add self-agent-sdk`       |

---

## SelfAgent Class (Agent-Side)

The `SelfAgent` class is the primary agent-side client. It manages identity, signs HTTP requests, and interacts with the registry.

### Constructor

**TypeScript:**

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent(config: SelfAgentConfig);
```

**Python:**

```python
from self_agent_sdk import SelfAgent

agent = SelfAgent(**config)
```

**Rust:**

```rust
use self_agent_sdk::SelfAgent;

let agent = SelfAgent::new(config)?;
```

### SelfAgentConfig

| Field             | Type                     | Default                   | Description                                                                 |
| ----------------- | ------------------------ | ------------------------- | --------------------------------------------------------------------------- |
| `privateKey`      | `string`                 | Auto-generated            | Hex private key, 0x-prefixed. If omitted, a new ECDSA keypair is generated. |
| `network`         | `"mainnet" \| "testnet"` | `"testnet"`               | Network selection. Sets chain ID, RPC URL, and contract addresses.          |
| `registryAddress` | `string`                 | Network default           | Override the registry contract address.                                     |
| `rpcUrl`          | `string`                 | Network default           | Override the JSON-RPC endpoint.                                             |
| `apiBase`         | `string`                 | `https://app.ai.self.xyz` | Override the REST API base URL.                                             |

Python uses snake_case: `private_key`, `registry_address`, `rpc_url`, `api_base`.

Rust uses snake_case fields in a `SelfAgentConfig` struct.

### Methods

#### isRegistered

Check whether the agent has an active on-chain registration.

```typescript
// TypeScript
const registered: boolean = await agent.isRegistered();
```

```python
# Python
registered: bool = agent.is_registered()
```

```rust
// Rust
let registered: bool = agent.is_registered().await?;
```

Returns `true` if the agent's address has a verified identity NFT in the registry. Returns `false` if unregistered or deregistered.

---

#### getInfo

Retrieve the full agent identity record from the on-chain registry.

```typescript
// TypeScript
const info: AgentInfo = await agent.getInfo();
```

```python
# Python
info = agent.get_info()
```

```rust
// Rust
let info = agent.get_info().await?;
```

**AgentInfo type:**

| Field               | Type               | Description                                |
| ------------------- | ------------------ | ------------------------------------------ |
| `registered`        | `boolean`          | Whether the agent is registered            |
| `agentId`           | `number`           | On-chain token ID (0 if unregistered)      |
| `address`           | `string`           | Agent's Ethereum address                   |
| `agentKey`          | `string`           | bytes32 registry key                       |
| `owner`             | `string`           | NFT owner address                          |
| `isVerified`        | `boolean`          | Whether the agent has a valid human proof  |
| `proofProvider`     | `string`           | Address of the proof provider              |
| `nullifier`         | `string`           | Cryptographic nullifier (for sybil checks) |
| `registeredAtBlock` | `number`           | Block number of registration               |
| `credentials`       | `AgentCredentials` | ZK-attested credentials                    |

---

#### signRequest

Generate the 3 authentication headers for an HTTP request without sending it.

```typescript
// TypeScript
const headers: Record<string, string> = await agent.signRequest(
  method: string,   // "GET" | "POST" | "PUT" | "DELETE"
  url: string,      // Full URL or path
  body?: string     // Request body (optional, empty string for GET)
);
// Returns: {
//   "x-self-agent-address": "0x...",
//   "x-self-agent-signature": "0x...",
//   "x-self-agent-timestamp": "1708704000000"
// }
```

```python
# Python
headers: dict[str, str] = agent.sign_request(
    method="POST",
    url="https://api.example.com/data",
    body='{"key":"value"}'
)
```

```rust
// Rust
let headers: HashMap<String, String> = agent.sign_request(
    "POST",
    "https://api.example.com/data",
    Some(r#"{"key":"value"}"#),
).await?;
```

The signing algorithm:

1. Compute body hash: `keccak256(body || "")`
2. Canonicalize URL to path + query only
3. Build message: `keccak256(timestamp + METHOD + pathWithQuery + bodyHash)`
4. Sign with EIP-191 personal_sign

---

#### fetch

Make an authenticated HTTP request. Wraps the native HTTP client and auto-attaches all 3 auth headers.

```typescript
// TypeScript
const response: Response = await agent.fetch(
  url: string,
  options?: {
    method?: string;    // Default: "GET"
    body?: string;
    headers?: Record<string, string>;
  }
);
```

```python
# Python
response = agent.fetch(
    url="https://api.example.com/data",
    method="POST",
    body='{"key":"value"}'
)
# Returns httpx.Response
```

```rust
// Rust
let response = agent.fetch(
    "https://api.example.com/data",
    "POST",
    Some(body),
    None, // optional additional headers
).await?;
// Returns reqwest::Response
```

---

#### getCredentials

Retrieve the agent's ZK-attested credentials from on-chain storage.

```typescript
// TypeScript
const creds: AgentCredentials = await agent.getCredentials();
```

```python
# Python
creds = agent.get_credentials()
```

```rust
// Rust
let creds = agent.get_credentials().await?;
```

**AgentCredentials type:**

| Field          | Type         | Description                                              |
| -------------- | ------------ | -------------------------------------------------------- |
| `nationality`  | `string`     | ISO 3166-1 alpha-3 (e.g., "USA", "GBR")                  |
| `olderThan`    | `number`     | Verified age threshold (0, 18, or 21)                    |
| `ofacClean`    | `boolean`    | Whether all 3 OFAC lists are clear                       |
| `issuingState` | `string`     | Passport issuing state                                   |
| `name`         | `string[]`   | Full name components (if disclosed)                      |
| `dateOfBirth`  | `string`     | Date of birth (if disclosed)                             |
| `gender`       | `string`     | Gender (if disclosed)                                    |
| `expiryDate`   | `string`     | Passport expiry (if disclosed)                           |
| `ofac`         | `boolean[3]` | Individual OFAC list results [SDN, nonSDN, consolidated] |

---

#### getVerificationStrength

Query the proof provider's verification strength score.

```typescript
// TypeScript
const strength: number = await agent.getVerificationStrength();
// Self Protocol always returns 100
```

```python
# Python
strength: int = agent.get_verification_strength()
```

```rust
// Rust
let strength: u8 = agent.get_verification_strength().await?;
```

Returns 0-100. Self Protocol agents always score 100 (passport NFC + biometric).

---

#### getAgentCard / setAgentCard

Read or write the agent's A2A (Agent-to-Agent) metadata card stored on-chain.

```typescript
// TypeScript
const card: A2AAgentCard | null = await agent.getAgentCard();
await agent.setAgentCard(card: A2AAgentCard);
```

```python
# Python
card = agent.get_agent_card()
agent.set_agent_card(card)
```

```rust
// Rust
let card = agent.get_agent_card().await?;
agent.set_agent_card(&card).await?;
```

---

#### requestRegistration

Initiate a registration flow. Returns a session with QR code URL for the human to scan with the Self app.

```typescript
// TypeScript
const session: RegistrationSession = await agent.requestRegistration({
  minimumAge?: 0 | 18 | 21,  // Default: 0
  ofac?: boolean,              // Default: false
  mode?: "self-custody" | "linked" | "wallet-free",  // Default: "linked"
});
```

```python
# Python
session = agent.request_registration(minimum_age=18, ofac=True)
```

```rust
// Rust
let session = agent.request_registration(18, true).await?;
```

**RegistrationSession type:**

| Field             | Type     | Description                                 |
| ----------------- | -------- | ------------------------------------------- |
| `sessionToken`    | `string` | Encrypted session token for polling/export  |
| `qrData`          | `object` | Self app QR configuration                   |
| `deepLink`        | `string` | Direct link to open Self app (mobile)       |
| `agentAddress`    | `string` | The agent's Ethereum address                |
| `expiresAt`       | `string` | ISO timestamp when session expires (30 min) |
| `timeRemainingMs` | `number` | Milliseconds until session expiry           |

---

#### getRegistrationStatus

Poll the status of a pending registration session.

```typescript
// TypeScript
const status: RegistrationStatus = await agent.getRegistrationStatus();
```

**RegistrationStatus type:**

| Field     | Type                                               | Description                               |
| --------- | -------------------------------------------------- | ----------------------------------------- |
| `status`  | `"pending" \| "verified" \| "expired" \| "failed"` | Current session status                    |
| `agentId` | `number \| undefined`                              | On-chain agent ID (present when verified) |

---

#### requestDeregistration

Initiate a deregistration flow. Returns a session for the human to confirm via the Self app.

```typescript
// TypeScript
const session: DeregistrationSession = await agent.requestDeregistration();
```

---

#### getAgentInfo

Look up any agent's info via the REST API (not just the calling agent).

```typescript
// TypeScript
const info: ApiAgentInfo = await agent.getAgentInfo(
  chainId: number,
  agentId: number
);
```

```python
# Python
info = agent.get_agent_info(chain_id=42220, agent_id=5)
```

```rust
// Rust
let info = agent.get_agent_info(42220, 5).await?;
```

---

#### getAgentsForHuman

List all agent IDs registered by a specific human address.

```typescript
// TypeScript
const agentIds: number[] = await agent.getAgentsForHuman(
  chainId: number,
  humanAddress: string
);
```

```python
# Python
agent_ids = agent.get_agents_for_human(chain_id=42220, address="0x...")
```

```rust
// Rust
let agent_ids = agent.get_agents_for_human(42220, "0x...").await?;
```

---

## SelfAgentVerifier (Service-Side)

The `SelfAgentVerifier` class provides server-side verification of agent-signed HTTP requests. It uses a builder pattern for configuration.

### Builder

**TypeScript:**

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("mainnet") // Select network
  .registry("0x...") // Override registry address
  .rpcUrl("https://...") // Override RPC URL
  .requireAge(18) // Require age 18+ credential
  .requireOFAC() // Require OFAC clearance
  .requireSelfProvider() // CRITICAL: require Self Protocol provider
  .sybilLimit(3) // Max agents per human
  .rateLimit({ windowMs: 60000, maxRequests: 100 }) // Per-agent rate limit
  .build();
```

**Python:**

```python
from self_agent_sdk import SelfAgentVerifier

verifier = (
    SelfAgentVerifier.create()
    .network("mainnet")
    .require_age(18)
    .require_ofac()
    .require_self_provider()
    .sybil_limit(3)
    .rate_limit(window_ms=60_000, max_requests=100)
    .build()
)
```

**Rust:**

```rust
use self_agent_sdk::SelfAgentVerifier;

let verifier = SelfAgentVerifier::builder()
    .network("mainnet")
    .require_age(18)
    .require_ofac()
    .require_self_provider()
    .sybil_limit(3)
    .rate_limit(60_000, 100)
    .build()?;
```

### Builder Methods

| Method (TS)              | Method (Python)            | Method (Rust)              | Description                          |
| ------------------------ | -------------------------- | -------------------------- | ------------------------------------ |
| `.network(name)`         | `.network(name)`           | `.network(name)`           | Set network ("mainnet" or "testnet") |
| `.registry(addr)`        | `.registry(addr)`          | `.registry(addr)`          | Override registry address            |
| `.rpcUrl(url)`           | `.rpc_url(url)`            | `.rpc_url(url)`            | Override RPC URL                     |
| `.requireAge(n)`         | `.require_age(n)`          | `.require_age(n)`          | Require minimum age (0, 18, or 21)   |
| `.requireOFAC()`         | `.require_ofac()`          | `.require_ofac()`          | Require OFAC clearance               |
| `.requireSelfProvider()` | `.require_self_provider()` | `.require_self_provider()` | Require Self Protocol provider       |
| `.sybilLimit(n)`         | `.sybil_limit(n)`          | `.sybil_limit(n)`          | Max agents per human                 |
| `.rateLimit(opts)`       | `.rate_limit(**opts)`      | `.rate_limit(w, m)`        | Per-agent rate limiting              |
| `.build()`               | `.build()`                 | `.build()`                 | Construct the verifier               |

### Methods

#### auth (Express Middleware)

Returns an Express-compatible middleware function. Available in TypeScript only.

```typescript
app.use("/api", verifier.auth());

// After verification, req.verifiedAgent is populated:
// {
//   agentId: number,
//   address: string,
//   credentials: AgentCredentials,
//   agentCount: number
// }
```

On failure, the middleware returns HTTP 401 with `{ error: string, reason: string }`.

---

#### verify

Manual verification of request headers. Available in all three languages.

```typescript
// TypeScript
const result: VerificationResult = await verifier.verify({
  address: string, // From x-self-agent-address header
  signature: string, // From x-self-agent-signature header
  timestamp: string, // From x-self-agent-timestamp header
  method: string, // HTTP method (e.g., "POST")
  path: string, // Request path (e.g., "/api/data")
  body: string, // Request body (empty string if none)
});
```

```python
# Python
result = await verifier.verify(
    address="0x...",
    signature="0x...",
    timestamp="1708704000000",
    method="POST",
    path="/api/data",
    body='{"key":"value"}'
)
```

```rust
// Rust
let result = verifier.verify(
    "0x...", // address
    "0x...", // signature
    "1708704000000", // timestamp
    "POST",
    "/api/data",
    r#"{"key":"value"}"#,
).await?;
```

---

### VerificationResult Type

```typescript
interface VerificationResult {
  valid: boolean; // Whether all checks passed
  agentId?: number; // On-chain agent ID
  address?: string; // Recovered signer address
  credentials?: AgentCredentials; // ZK-attested credentials
  agentCount?: number; // Number of agents for this human
  reason?: string; // Rejection reason (when valid = false)
}
```

Python: fields use snake_case (`agent_id`, `agent_count`).
Rust: fields use snake_case, `Option<T>` for optional fields.

---

### Proof Expiry Handling

Human proofs expire after `maxProofAge` (default: 365 days) or at passport document expiry, whichever is sooner. SDKs provide tools to detect and handle expiry.

#### Checking Proof Freshness

```typescript
// TypeScript — check via on-chain call
const info = await agent.getInfo();
console.log(info.proofExpiresAt); // unix timestamp (seconds), 0 if no proof
```

```python
# Python
info = agent.get_info()
print(info.proof_expires_at)
```

```rust
// Rust
let info = agent.get_info().await?;
println!("{}", info.proof_expires_at);
```

#### Expiry Warning Threshold

The TypeScript SDK includes a built-in 30-day warning threshold:

```typescript
import {
  isProofExpiringSoon,
  EXPIRY_WARNING_THRESHOLD_SECS,
} from "@selfxyz/agent-sdk";
// EXPIRY_WARNING_THRESHOLD_SECS = 2_592_000 (30 days)

if (isProofExpiringSoon(proofExpiresAt)) {
  console.warn("Proof expires within 30 days — prompt human to re-verify");
}
```

#### VerifyResult Expiry States

The verifier checks `isProofFresh()` on-chain and returns an error when an agent's proof has lapsed:

```typescript
const result = await verifier.verify({
  address,
  signature,
  timestamp,
  method,
  path,
  body,
});
if (!result.valid && result.error?.includes("proof has expired")) {
  // Agent must deregister and re-register to refresh
}
```

#### Refreshing a Proof

There is no in-place refresh. The agent must deregister (burn NFT, clear state) then re-register (new passport scan, new agentId, fresh `proofExpiresAt`).

```typescript
// TypeScript
await agent.requestDeregistration(); // human confirms via Self app
// ... after deregistration completes:
const session = await agent.requestRegistration({ minimumAge: 18, ofac: true });
// human scans passport again
```

```python
# Python
agent.request_deregistration()
# ... after deregistration:
session = agent.request_registration(minimum_age=18, ofac=True)
```

---

### Verification Pipeline

The verifier executes checks in this order, short-circuiting on failure:

1. **Header extraction** — Extract the 3 `x-self-agent-*` headers. Missing headers: immediate rejection.
2. **Timestamp window** — Reject if > 5 minutes old (300,000 ms).
3. **Signature recovery** — Reconstruct signed message, recover signer via ECDSA, compare to claimed address.
4. **Rate limiting** — If configured, check per-agent request count.
5. **On-chain proof** — Call `registry.isVerifiedAgent(agentKey)`.
6. **Provider check** — If `.requireSelfProvider()` is set, verify `getProofProvider(agentId)` matches Self Protocol.
7. **Credential checks** — If `.requireAge(n)` or `.requireOFAC()` is set, verify credentials.
8. **Sybil check** — If `.sybilLimit(n)` is set, check `getAgentCountForHuman(nullifier) <= n`.

---

## Registration Utilities

Helper functions for constructing `userDefinedData` payloads and handling registration cryptography.

### getRegistrationConfigIndex

Map age and OFAC requirements to a config index number.

```typescript
import { getRegistrationConfigIndex } from "@selfxyz/agent-sdk";

const index: number = getRegistrationConfigIndex({
  minimumAge: 18,
  ofac: true,
});
// Returns: 0 through 5
```

| minimumAge | ofac  | Result |
| ---------- | ----- | ------ |
| 0          | false | `0`    |
| 18         | false | `1`    |
| 21         | false | `2`    |
| 0          | true  | `3`    |
| 18         | true  | `4`    |
| 21         | true  | `5`    |

---

### computeRegistrationChallengeHash

Compute the Keccak-256 hash of a registration challenge string.

```typescript
import { computeRegistrationChallengeHash } from "@selfxyz/agent-sdk";

const hash: string = computeRegistrationChallengeHash(challenge: string);
// Returns: "0x..." (bytes32 hex string)
```

---

### signRegistrationChallenge

Sign a registration challenge with an agent's private key.

```typescript
import { signRegistrationChallenge } from "@selfxyz/agent-sdk";

const signature: string = signRegistrationChallenge(challenge: string, privateKey: string);
// Returns: "0x..." (65-byte ECDSA signature)
```

---

### buildSimpleRegisterUserDataAscii

Build the `userDefinedData` payload for verified-wallet (simple) mode.

```typescript
import { buildSimpleRegisterUserDataAscii } from "@selfxyz/agent-sdk";

const data: string = buildSimpleRegisterUserDataAscii({
  minimumAge: 18,
  ofac: true,
});
// Returns: "R" + configDigit (e.g., "R4" for age 18+ with OFAC)
```

---

### buildAdvancedRegisterUserDataAscii

Build the `userDefinedData` payload for agent-identity (advanced) mode.

```typescript
import { buildAdvancedRegisterUserDataAscii } from "@selfxyz/agent-sdk";

const data: string = buildAdvancedRegisterUserDataAscii({
  agentAddress: string,                       // Agent Ethereum address (0x-prefixed)
  signature: string | RegistrationSignatureParts, // ECDSA signature over challenge
  disclosures?: RegistrationDisclosures,      // { minimumAge?: 0|18|21, ofac?: boolean }
});
// Returns: "K" + configDigit + address(40) + r(64) + s(64) + v(2) (172 characters total)
```

---

### buildWalletFreeRegisterUserDataAscii

Build the `userDefinedData` payload for wallet-free mode.

```typescript
import { buildWalletFreeRegisterUserDataAscii } from "@selfxyz/agent-sdk";

const data: string = buildWalletFreeRegisterUserDataAscii({
  agentAddress: string,                       // Agent Ethereum address (0x-prefixed)
  guardianAddress?: string,                   // Guardian address (zero-padded if absent)
  signature: string | RegistrationSignatureParts, // ECDSA signature over challenge
  disclosures?: RegistrationDisclosures,      // { minimumAge?: 0|18|21, ofac?: boolean }
});
// Returns: "W" + configDigit + agentAddress(40) + guardianAddress(40) + r(64) + s(64) + v(2) (212 characters total)
```

---

## Agent Card Utilities

### buildAgentCard

Construct a standardized A2A agent card.

```typescript
import { buildAgentCard } from "@selfxyz/agent-sdk";

const card: A2AAgentCard = buildAgentCard({
  name: "My Agent",
  description: "An AI assistant with verified identity",
  url: "https://myagent.example.com",
  agentId: 5,
  chainId: 42220,
  registry: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
  proofProvider: "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
  credentials: { nationality: "USA", olderThan: 18, ofacClean: true },
  skills: [{ id: "chat", name: "Chat", description: "General conversation" }],
});
```

**A2AAgentCard type:**

```typescript
interface A2AAgentCard {
  a2aVersion: string; // "0.1"
  name: string;
  description: string;
  url?: string;
  selfProtocol: {
    agentId: number;
    registry: string;
    chainId: number;
    proofProvider: string;
    providerName: string;
    verificationStrength: number;
    trustModel: {
      proofType: string; // "zk-passport"
      proofStandard: string; // "groth16"
      proofProvider: string; // "self-protocol"
      onChainVerifiable: boolean;
    };
    credentials: {
      nationality: string;
      olderThan: number;
      ofacClean: boolean;
    };
  };
  skills: Array<{
    id: string;
    name: string;
    description: string;
  }>;
}
```

---

### getProviderLabel

Get a human-readable label for a proof provider address.

```typescript
import { getProviderLabel } from "@selfxyz/agent-sdk";

const label: string = getProviderLabel(
  providerAddress: string,
  chainId: number
);
// Returns: "Self Protocol" for known addresses, or "Unknown Provider (0x...)" otherwise
```

---

## Constants

### NETWORKS

```typescript
import { NETWORKS } from "@selfxyz/agent-sdk";

NETWORKS = {
  mainnet: {
    chainId: 42220,
    registry: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
    provider: "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d",
    rpcUrl: "https://forno.celo.org",
    explorerUrl: "https://celoscan.io",
  },
  testnet: {
    chainId: 11142220,
    registry: "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
    provider: "0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c",
    rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
    explorerUrl: "https://celo-sepolia.blockscout.com",
  },
};
```

### HEADERS

```typescript
import { HEADERS } from "@selfxyz/agent-sdk";

HEADERS = {
  address: "x-self-agent-address",
  signature: "x-self-agent-signature",
  timestamp: "x-self-agent-timestamp",
};
```

### DEFAULT_NETWORK

```typescript
import { DEFAULT_NETWORK } from "@selfxyz/agent-sdk";
// "testnet"
```

### Contract ABIs

```typescript
import { REGISTRY_ABI, PROVIDER_ABI } from "@selfxyz/agent-sdk";
// Full ABI arrays for ethers.js / viem / web3.js contract interaction
```

---

## Error Types

### ExpiredSessionError

Thrown when a registration or deregistration session has exceeded the 30-minute timeout.

```typescript
import { ExpiredSessionError } from "@selfxyz/agent-sdk";

try {
  const status = await agent.getRegistrationStatus();
} catch (err) {
  if (err instanceof ExpiredSessionError) {
    // Session expired — start a new registration
  }
}
```

### RegistrationError

Thrown for generic registration failures (ZK proof verification failed, contract revert, etc.).

```typescript
import { RegistrationError } from "@selfxyz/agent-sdk";

try {
  const session = await agent.requestRegistration({
    minimumAge: 18,
    ofac: true,
  });
} catch (err) {
  if (err instanceof RegistrationError) {
    console.error("Registration failed:", err.message);
  }
}
```

---

## REST API Endpoints

The SDK calls these endpoints internally. They are also available for direct use.

**Base URL:** `https://app.ai.self.xyz` (override with `SELF_AGENT_API_BASE`)

### Agent Info

| Method | Path                                    | Description                            |
| ------ | --------------------------------------- | -------------------------------------- |
| `GET`  | `/api/agent/info/{chainId}/{agentId}`   | Full agent info by ID                  |
| `GET`  | `/api/agent/agents/{chainId}/{address}` | List agent IDs for a human address     |
| `GET`  | `/api/agent/verify/{chainId}/{agentId}` | Verification status and proof provider |

### Registration

| Method | Path                                 | Description                  |
| ------ | ------------------------------------ | ---------------------------- |
| `POST` | `/api/agent/register`                | Start a registration session |
| `GET`  | `/api/agent/register/status?token=X` | Poll registration status     |
| `GET`  | `/api/agent/register/qr?token=X`     | Get QR code data             |

### Deregistration

| Method | Path                                   | Description                    |
| ------ | -------------------------------------- | ------------------------------ |
| `POST` | `/api/agent/deregister`                | Start a deregistration session |
| `GET`  | `/api/agent/deregister/status?token=X` | Poll deregistration status     |

### Agent Cards

| Method | Path                             | Description     |
| ------ | -------------------------------- | --------------- |
| `GET`  | `/api/cards/{chainId}/{agentId}` | Read agent card |

### Reputation

| Method | Path                                  | Description                           |
| ------ | ------------------------------------- | ------------------------------------- |
| `GET`  | `/api/reputation/{chainId}/{agentId}` | Reputation score and provider details |

### Chain IDs for API Paths

- Celo Mainnet: `42220`
- Celo Sepolia (testnet): `11142220`
