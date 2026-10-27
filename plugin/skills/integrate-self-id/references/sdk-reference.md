# SDK Reference

Complete API reference for the Self Agent ID TypeScript SDK (`@selfxyz/agent-sdk`), the only SDK. From other languages, call the REST API directly (see [REST API Endpoints](#rest-api-endpoints)).

---

## Packages

| Language   | Package              | Install                          |
| ---------- | -------------------- | -------------------------------- |
| TypeScript | `@selfxyz/agent-sdk` | `npm install @selfxyz/agent-sdk` |

---

## SelfAgent Class (Agent-Side)

The `SelfAgent` class is the primary agent-side client. It manages identity, signs HTTP requests, and interacts with the registry.

### Constructor

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent(config: SelfAgentConfig);
```

### SelfAgentConfig

| Field             | Type                     | Default         | Description                                                        |
| ----------------- | ------------------------ | --------------- | ------------------------------------------------------------------ |
| `privateKey`      | `string`                 | —               | Hex private key (with or without 0x). Required unless `signer`.    |
| `signer`          | `ethers.Signer`          | —               | TypeScript only: use a wallet signer instead of a raw key.         |
| `network`         | `"mainnet" \| "testnet"` | `"mainnet"`     | Network selection. Sets chain ID, RPC URL, and contract addresses. |
| `registryAddress` | `string`                 | Network default | Override the registry contract address.                            |
| `rpcUrl`          | `string`                 | Network default | Override the JSON-RPC endpoint.                                    |

The REST helpers (`requestRegistration`, `getAgentInfo`, …) take an `apiBase` option instead; the default is `SELF_AGENT_API_BASE` or `https://agent-api.self.xyz`.

### Methods

#### isRegistered

Check whether the agent has a human proof on-chain (it may have expired).

```typescript
// TypeScript
const registered: boolean = await agent.isRegistered();
```

Returns `true` if the agent key has a human proof recorded in the registry (`isVerifiedAgent`). Returns `false` if unregistered or deregistered. It does **not** check proof freshness — use `getInfo().isVerified` (`hasHumanProof && isProofFresh`) for that.

---

#### getInfo

Retrieve the full agent identity record from the on-chain registry.

```typescript
// TypeScript
const info: AgentInfo = await agent.getInfo();
```

**AgentInfo type**:

| Field             | Type             | Description                                                      |
| ----------------- | ---------------- | ---------------------------------------------------------------- |
| `address`         | `string`         | Agent's Ethereum address                                         |
| `agentKey`        | `string`         | bytes32 registry key                                             |
| `agentId`         | `bigint`         | On-chain token ID (`0n` if unregistered)                         |
| `isVerified`      | `boolean`        | `hasHumanProof && isProofFresh` — the only meaning of "verified" |
| `hasHumanProof`   | `boolean`        | A human proof was recorded (it may have expired)                 |
| `isProofFresh`    | `boolean`        | The proof has not expired                                        |
| `proofExpiresAt`  | `bigint`         | Unix seconds when the proof expires (0 if unset)                 |
| `daysUntilExpiry` | `number \| null` | Days until expiry (`null` if no expiry is set)                   |
| `isExpiringSoon`  | `boolean`        | Expires within 30 days                                           |
| `nullifier`       | `bigint`         | Human nullifier (for sybil checks)                               |
| `agentCount`      | `bigint`         | Number of agents registered by the same human                    |
| `siblingAgentIds` | `bigint[]`       | Token IDs of all agents registered by the same human             |

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

---

#### getCredentials

Retrieve the agent's ZK-attested credentials from on-chain storage.

```typescript
// TypeScript
const creds = await agent.getCredentials(); // registry struct, or undefined if unregistered
```

**AgentCredentials** (the registry's `getAgentCredentials` struct):

| Field          | Type         | Description                                              |
| -------------- | ------------ | -------------------------------------------------------- |
| `issuingState` | `string`     | Passport issuing state (alpha-3, if disclosed)           |
| `name`         | `string[]`   | Full name components (if disclosed)                      |
| `idNumber`     | `string`     | Document number (if disclosed)                           |
| `nationality`  | `string`     | ISO 3166-1 alpha-3 (e.g., "USA", "GBR"), if disclosed    |
| `dateOfBirth`  | `string`     | Date of birth (if disclosed)                             |
| `gender`       | `string`     | Gender (if disclosed)                                    |
| `expiryDate`   | `string`     | Passport expiry (if disclosed)                           |
| `olderThan`    | `number`     | Verified age threshold (0, 18, or 21)                    |
| `ofac`         | `boolean[3]` | Individual OFAC list results [SDN, nonSDN, consolidated] |

---

#### getVerificationStrength

Query the proof provider's verification strength score.

```typescript
// TypeScript
const strength: number = await agent.getVerificationStrength();
// Self Protocol always returns 100
```

Returns 0-100. Self Protocol agents always score 100 (passport NFC + biometric).

---

#### getAgentCard / setAgentCard

Read or write the agent's A2A (Agent-to-Agent) metadata card stored on-chain. `setAgentCard` builds the card (including the `selfProtocol` block read from the registry), writes it with `updateAgentMetadata`, and returns the transaction hash — the agent key pays gas. It throws before sending unless the agent key owns the agent NFT (only wallet-free agents do); for linked, privy and smartwallet agents call `updateAgentMetadata` from the human's wallet with a card from `buildAgentCard()`.

```typescript
// TypeScript
const card = await agent.getAgentCard(); // undefined if none set
const txHash = await agent.setAgentCard({
  name: "My Agent",
  description: "Does useful things",
  url: "https://myagent.example.com",
  skills: [{ id: "data-analysis", name: "Data analysis" }],
});
```

---

#### requestRegistration

Initiate a registration through the REST API. It is a standalone function (also available as the static `SelfAgent.requestRegistration`) — no agent instance is needed. Returns a session with a QR code URL for the human to scan with the Self app.

```typescript
// TypeScript
import { requestRegistration } from "@selfxyz/agent-sdk";

const session = await requestRegistration({
  mode: "linked", // linked | wallet-free | ed25519 | ed25519-linked | privy | smartwallet
  network: "testnet", // default "mainnet"
  disclosures: { minimumAge: 18, ofac: true },
  humanAddress: "0x...", // linked, ed25519-linked, privy, smartwallet
  // ed25519Pubkey / ed25519Signature for the ed25519 modes
  // apiBase: default SELF_AGENT_API_BASE or https://agent-api.self.xyz
});
```

**RegistrationSession**:

| Field / method             | Type                          | Description                                                                                |
| -------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------ |
| `sessionToken`             | `string`                      | Encrypted session token (rotated by every status poll)                                     |
| `stage`                    | `string`                      | `"qr-ready"` initially                                                                     |
| `scanUrl`                  | `string`                      | URL of a PNG QR code to show the human                                                     |
| `deepLink`                 | `string`                      | Direct link to open the Self app (mobile)                                                  |
| `agentAddress`             | `string`                      | The agent's Ethereum address                                                               |
| `expiresAt`                | `string`                      | ISO timestamp when the session expires (30 min)                                            |
| `timeRemainingMs`          | `number`                      | Milliseconds until session expiry                                                          |
| `humanInstructions`        | `string[]`                    | Steps to show the human                                                                    |
| `waitForCompletion(opts?)` | `Promise<RegistrationResult>` | Polls status (Bearer) until `completed`; returns `{ agentId, agentAddress, credentials? }` |
| `exportKey()`              | `Promise<string>`             | Exports the server-generated private key (not for ed25519 modes)                           |

`waitForCompletion` throws `ExpiredSessionError` when the session expires and an `Error` on timeout (call it again to resume). The key export window is 30 minutes after completion.

---

#### requestDeregistration

Initiate deregistration of this agent. Returns a session for the human to confirm via the Self app.

```typescript
// TypeScript
const session = await agent.requestDeregistration({
  disclosures: { minimumAge: 18, ofac: true }, // optional; match the original registration
});
console.log(session.scanUrl);
await session.waitForCompletion();
```

Ed25519 agents cannot be deregistered through the API (400); the guardian calls `guardianRevoke(agentId)` on-chain.

---

#### requestProofRefresh

Refresh an expiring proof in place (same agentId). See [Refreshing a Proof](#refreshing-a-proof).

---

#### getAgentInfo

Look up any agent's info via the REST API (`GET /api/agent/info/{chainId}/{agentId}`). Static; no private key needed.

```typescript
// TypeScript
const info: ApiAgentInfo = await SelfAgent.getAgentInfo(5, {
  network: "mainnet",
});
```

A nonexistent or burned agent is a 404 (`RegistrationError` with `status` 404).

---

#### getAgentsForHuman

List the agents linked to a human address (`GET /api/agent/agents/{chainId}/{address}`). Static.

```typescript
// TypeScript
const { agents, totalCount } = await SelfAgent.getAgentsForHuman("0x...", {
  network: "mainnet",
});
```

---

## SelfAgentVerifier (Service-Side)

The `SelfAgentVerifier` class provides server-side verification of agent-signed HTTP requests. It uses a builder pattern for configuration.

### Builder

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("mainnet") // Select network
  .registry("0x...") // Override registry address
  .rpc("https://...") // Override RPC URL
  .requireAge(18) // Require age 18+ credential
  .requireOFAC() // Require OFAC clearance
  .requireSelfProvider() // Require Self Protocol provider (default: on)
  .sybilLimit(3) // Max agents per human (default 1, 0 = unlimited)
  .rateLimit({ perMinute: 10, perHour: 100 }) // Per-agent rate limit
  .build();
```

### Builder Methods

| Method                             | Description                          |
| ---------------------------------- | ------------------------------------ |
| `.network(name)`                   | Set network ("mainnet" or "testnet") |
| `.registry(addr)`                  | Override registry address            |
| `.rpc(url)`                        | Override RPC URL                     |
| `.requireAge(n)`                   | Require minimum age (18 or 21)       |
| `.requireOFAC()`                   | Require OFAC clearance               |
| `.requireNationality(...c)`        | Allowed alpha-3 nationality codes    |
| `.requireSelfProvider()`           | Require Self Protocol provider       |
| `.sybilLimit(n)`                   | Max agents per human (0 = unlimited) |
| `.rateLimit({perMinute, perHour})` | Per-agent rate limiting              |
| `.replayProtection(on?)`           | Replay detection (default on)        |
| `.includeCredentials()`            | Include credentials in the result    |
| `.maxAge(ms)`                      | Max timestamp age (default 5 min)    |
| `.cacheTtl(ms)`                    | On-chain cache TTL (default 1 min)   |
| `.build()`                         | Construct the verifier               |

### Methods

#### auth (Express Middleware)

Returns an Express-compatible middleware function.

```typescript
app.use("/api", verifier.auth());

// After verification, req.agent is populated:
// { address, agentKey, agentId, agentCount, nullifier, credentials? }
```

On failure, the middleware responds `401 { error }` (or `429 { error, retryAfterMs }` when rate limited).

The signature covers the exact body bytes, so `auth()` needs the raw body: set `req.rawBody` (e.g. `express.json({ verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } })`) or use `express.text()` / `express.raw()`. A parsed body is never re-serialised; a request with a body but no raw body gets a 500. `req.agent` is typed as `VerifiedAgent` (optional on `Request`).

---

#### verify

Manual verification of a signed request. The signer is recovered from the signature (ECDSA), so the address header is informational.

```typescript
// TypeScript
const result: VerificationResult = await verifier.verify({
  signature, // x-self-agent-signature
  timestamp, // x-self-agent-timestamp
  method: "POST",
  url: "/api/data", // path + query (a full URL also works)
  body, // raw request body, if any
  // Ed25519 agents: keytype: "ed25519", agentKey: <x-self-agent-key>
});
```

---

### VerificationResult Type

```typescript
interface VerificationResult {
  valid: boolean; // Whether all checks passed
  agentAddress: string; // Recovered signer address
  agentKey: string; // bytes32 registry key
  agentId: bigint; // On-chain agent ID
  agentCount: bigint; // Number of agents for this human
  nullifier: bigint; // Human nullifier
  credentials?: AgentCredentials; // With includeCredentials()
  error?: string; // Rejection reason (when valid = false)
  retryAfterMs?: number; // When rate limited
  proofExpiresAt?: Date;
  daysUntilExpiry?: number;
  isExpiringSoon?: boolean;
}
```

---

### Proof Expiry Handling

Human proofs expire after `maxProofAge` (default: 365 days) or at passport document expiry, whichever is sooner. The SDK provides tools to detect and handle expiry.

#### Checking Proof Freshness

```typescript
// TypeScript — check via on-chain call
const info = await agent.getInfo();
console.log(info.proofExpiresAt); // unix timestamp (seconds), 0 if no proof
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
  signature,
  timestamp,
  method,
  url,
  body,
});
if (!result.valid && result.error === "Agent's human proof has expired") {
  // Ask the human to refresh the proof (requestProofRefresh)
}
```

#### Refreshing a Proof

Refresh renews `proofExpiresAt` in place — the agentId stays the same. The human scans their passport again via the Self app.

```typescript
// TypeScript
import { requestProofRefresh } from "@selfxyz/agent-sdk";

const session = await requestProofRefresh({ agentId: 5, network: "mainnet" });
console.log(session.scanUrl); // show to the human
const { proofExpiresAt } = await session.waitForCompletion(); // Date | undefined (only if the server reported it)
```

`disclosures` default to the agent's on-chain config. Agent ids whose 32-byte big-endian form contains a byte `>= 0x80` (e.g. 128–255) cannot be refreshed (API returns 422) — deregister and re-register those agents instead.

---

### Verification Pipeline

The verifier executes checks in this order, short-circuiting on failure:

1. **Header extraction** — Extract the `x-self-agent-*` headers. Missing headers: immediate rejection.
2. **Timestamp window** — Reject if > 5 minutes old (300,000 ms).
3. **Signature recovery** — Reconstruct the signed message and recover the signer (ECDSA) or check the Ed25519 signature.
4. **Replay check** — Reject a signature + timestamp seen before (default on).
5. **On-chain proof** — `registry.isVerifiedAgent(agentKey)` (human proof present).
6. **Freshness** — Reject if `isProofFresh(agentId)` is false.
7. **Provider check** — `getProofProvider(agentId)` must match Self Protocol (default on).
8. **Sybil check** — `getAgentCountForHuman(nullifier) <= maxAgentsPerHuman` (default 1).
9. **Credential checks** — Age, OFAC, nationality if required.
10. **Rate limiting** — If configured, per-agent request count.

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

Compute the registration challenge hash: `keccak256(abi.encodePacked("self-agent-id:register:", humanIdentifier, chainId, registryAddress, nonce))`.

```typescript
import { computeRegistrationChallengeHash } from "@selfxyz/agent-sdk";

const hash: string = computeRegistrationChallengeHash({
  humanIdentifier: "0x...", // human wallet (or the agent address for wallet-free)
  chainId: 11142220,
  registryAddress: "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
  nonce: 0,
});
// Returns: "0x..." (bytes32 hex string)
```

---

### signRegistrationChallenge

Sign a registration challenge (EIP-191 over the challenge hash) with an agent's private key.

```typescript
import { signRegistrationChallenge } from "@selfxyz/agent-sdk";

const signed = await signRegistrationChallenge(agentPrivateKey, {
  humanIdentifier,
  chainId,
  registryAddress,
  nonce: 0,
});
// Returns: { messageHash, signature, r, s, v, agentAddress }
```

---

### buildSimpleRegisterUserDataAscii

Build the `userDefinedData` payload for the simple `R` action (the human wallet is the agent key; not offered as an API mode).

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

Build the `userDefinedData` payload for the advanced `K` action (used by the `linked`, `privy` and `smartwallet` modes).

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

Build an ERC-8004 / A2A card from on-chain state plus your fields (what `setAgentCard` writes).

```typescript
import {
  buildAgentCard,
  typedRegistry,
  typedProvider,
} from "@selfxyz/agent-sdk";

const card = await buildAgentCard(
  5, // agentId
  registry, // TypedRegistryContract (connected to an RPC)
  provider, // TypedProviderContract for the agent's proof provider
  {
    name: "My Agent", // required
    description: "An AI assistant with verified identity",
    url: "https://myagent.example.com",
    skills: [{ id: "chat", name: "Chat", description: "General conversation" }],
    // also: image, services, version, agentProvider, capabilities, securitySchemes, ...
  },
);
```

The result is an `A2AAgentCard` (alias of `ERC8004AgentDocument`): `type`, `name`, `description`, `image`, `services[]`, optional A2A fields, `skills[]`, and `selfProtocol: { agentId, registry, chainId, proofProvider, providerName, verificationStrength, trustModel: { proofType, sybilResistant, ofacScreened, minimumAgeVerified }, credentials? }`.

---

### getProviderLabel / getStrengthColor

Map a verification strength (0-100) to a label or UI colour.

```typescript
import { getProviderLabel, getStrengthColor } from "@selfxyz/agent-sdk";

getProviderLabel(100); // "passport"  (≥80 "kyc", ≥60 "govt_id", ≥40 "liveness", else "unknown")
getStrengthColor(100); // "green"     (≥60 "blue", ≥40 "amber", else "gray")
```

---

## Constants

```typescript
import {
  NETWORKS,
  CHAIN_IDS,
  DEFAULT_NETWORK,
  HEADERS,
  REGISTRY_ABI,
  PROVIDER_ABI,
} from "@selfxyz/agent-sdk";

NETWORKS = {
  mainnet: {
    registryAddress: "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944",
    rpcUrl: "https://forno.celo.org",
  },
  testnet: {
    registryAddress: "0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379",
    rpcUrl: "https://forno.celo-sepolia.celo-testnet.org",
  },
};
CHAIN_IDS = { mainnet: 42220, testnet: 11142220 };
DEFAULT_NETWORK = "mainnet";
HEADERS = {
  ADDRESS: "x-self-agent-address",
  SIGNATURE: "x-self-agent-signature",
  TIMESTAMP: "x-self-agent-timestamp",
  KEYTYPE: "x-self-agent-keytype",
  KEY: "x-self-agent-key",
};
// REGISTRY_ABI / PROVIDER_ABI: human-readable ABI fragments for ethers
```

Provider addresses are not in the SDK constants: mainnet `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d`, testnet `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` (the verifier reads `selfProofProvider()` from the registry).

---

## Error Types

### ExpiredSessionError

Thrown when a registration or deregistration session has exceeded the 30-minute timeout.

```typescript
import { ExpiredSessionError } from "@selfxyz/agent-sdk";

try {
  await session.waitForCompletion();
} catch (err) {
  if (err instanceof ExpiredSessionError) {
    // Session expired — start a new registration
  }
}
```

### RegistrationError

Thrown when a REST API call fails. `status` carries the HTTP status (e.g. 400 bad input, 404 agent not found, 409 export before completion, 429 rate limited).

```typescript
import { RegistrationError, requestRegistration } from "@selfxyz/agent-sdk";

try {
  const session = await requestRegistration({
    mode: "wallet-free",
    disclosures: { minimumAge: 18, ofac: true },
  });
} catch (err) {
  if (err instanceof RegistrationError) {
    console.error("Registration failed:", err.status, err.message);
  }
}
```

---

## REST API Endpoints

The SDK calls these endpoints internally. They are also available for direct use.

**Base URL:** `https://agent-api.self.xyz` (override with `SELF_AGENT_API_BASE`)

Session tokens are sent only as `Authorization: Bearer <sessionToken>` (never in the query string). Every status response returns a rotated `sessionToken`; use the newest one.

### Agent Info

| Method | Path                                                   | Description                                         |
| ------ | ------------------------------------------------------ | --------------------------------------------------- |
| `GET`  | `/api/agent/info/{chainId}/{agentId}`                  | Full agent info by ID (404 if nonexistent / burned) |
| `GET`  | `/api/agent/agents/{chainId}/{address}`                | Agents linked to a human address                    |
| `GET`  | `/api/agent/verify/{chainId}/{agentId}`                | Verification status, provider, sybil count          |
| `GET`  | `/api/agent/agents-by-nullifier/{chainId}/{nullifier}` | Agents backed by the same human                     |

### Registration

| Method | Path                                    | Description                                        |
| ------ | --------------------------------------- | -------------------------------------------------- |
| `POST` | `/api/agent/register`                   | Start a registration session                       |
| `GET`  | `/api/agent/register/status`            | Poll registration status (Bearer)                  |
| `GET`  | `/api/agent/register/qr`                | QR data, deep link and `scanUrl` (Bearer)          |
| `POST` | `/api/agent/register/export`            | Export the generated key after completion (Bearer) |
| `POST` | `/api/agent/register/ed25519-challenge` | Challenge for the Ed25519 modes                    |
| `GET`  | `/api/agent/register/ed25519-check`     | Is an Ed25519 pubkey registered                    |

### Deregistration and Refresh

| Method | Path                           | Description                         |
| ------ | ------------------------------ | ----------------------------------- |
| `POST` | `/api/agent/deregister`        | Start a deregistration session      |
| `GET`  | `/api/agent/deregister/status` | Poll deregistration status (Bearer) |
| `POST` | `/api/agent/refresh`           | Start an in-place proof refresh     |
| `GET`  | `/api/agent/refresh/status`    | Poll refresh status (Bearer)        |

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

Any other chain ID is rejected with 400.
