# @selfxyz/agent-sdk

TypeScript SDK for [Self Agent ID](https://self-agent-id.vercel.app) — on-chain AI agent identity with proof-of-human verification.

Sign requests in TypeScript, verify in Python or Rust, or vice versa. The signing protocol is language-agnostic — all SDKs produce identical signatures.

## Install

```bash
npm install @selfxyz/agent-sdk
```

## Agent Side — Sign Requests

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey: "0x..." });

// Sign a request (returns auth headers)
const headers = await agent.signRequest(
  "POST",
  "https://api.example.com/data",
  '{"query":"test"}',
);

// Or use the built-in HTTP client (auto-signs)
const response = await agent.fetch("https://api.example.com/data", {
  method: "POST",
  body: JSON.stringify({ query: "test" }),
});

// Check on-chain status
console.log(await agent.isRegistered()); // true/false
console.log(await agent.getInfo()); // { agentId, isVerified, ... }
```

### Agent Properties

```typescript
agent.address; // Ethereum address (e.g. "0xf39F...")
agent.agentKey; // bytes32 zero-padded address for on-chain lookups
```

### Credentials

```typescript
// Fetch ZK-attested credentials (nationality, age, OFAC, etc.)
const creds = await agent.getCredentials();
// { issuingState, name, nationality, dateOfBirth, olderThan, ofac, ... }

const strength = await agent.getVerificationStrength();
// 0 = unverified, 1 = basic, 2 = standard, 3 = enhanced
```

## Service Side — Verify Requests

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = new SelfAgentVerifier(); // mainnet by default

const result = await verifier.verify({
  signature: req.headers["x-self-agent-signature"],
  timestamp: req.headers["x-self-agent-timestamp"],
  method: req.method,
  url: req.path,
  body: req.body,
});

if (result.valid) {
  console.log(`Verified agent: ${result.agentAddress}`);
  console.log(`Agent ID: ${result.agentId}`);
}
```

### VerifierBuilder

Chainable API for configuring verification requirements:

```typescript
import { VerifierBuilder } from "@selfxyz/agent-sdk";

const verifier = VerifierBuilder.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireNationality("US", "GB", "DE")
  .requireSelfProvider()
  .sybilLimit(1)
  .rateLimit({ perMinute: 60, perHour: 1000 })
  .replayProtection()
  .includeCredentials()
  .maxAge(300_000) // 5 min timestamp window
  .cacheTtl(60_000) // 1 min cache
  .build();
```

### Express Middleware

```typescript
const verifier = SelfAgentVerifier.create().requireAge(18).build();

app.post("/api/data", verifier.auth(), (req, res) => {
  const agent = req.verifiedAgent; // VerificationResult
  res.json({ agentId: agent.agentId.toString() });
});
```

### Static Factory

```typescript
// From a flat config object (useful for env-driven config)
const verifier = SelfAgentVerifier.fromConfig({
  network: "mainnet",
  requireAge: 18,
  requireOFAC: true,
  sybilLimit: 1,
});
```

## Proof Expiry & Refresh

Human proofs expire after `maxProofAge` (default: 365 days) or at passport document expiry, whichever is sooner. The expiry timestamp is set on-chain at registration.

```typescript
// Check proof freshness
const info = await agent.getInfo();
console.log(info.proofExpiresAt); // unix seconds, 0 if unregistered

// Built-in 30-day warning
import { isProofExpiringSoon } from "@selfxyz/agent-sdk";
if (isProofExpiringSoon(info.proofExpiresAt)) {
  console.warn("Proof expiring soon — prompt human to re-verify");
}
```

**Verifier-side:** The verifier returns `reason: "PROOF_EXPIRED"` when an agent's proof has lapsed. Services should return a clear error guiding the agent to re-register.

**Refreshing:** There is no in-place refresh. Deregister (burn NFT) → re-register (new passport scan, new agentId, fresh expiry):

```typescript
await agent.requestDeregistration(); // human confirms via Self app
// ... after completion:
const session = await agent.requestRegistration({ minimumAge: 18, ofac: true });
```

## A2A Agent Card

Publish machine-readable identity metadata for agent-to-agent discovery:

```typescript
// Read the on-chain agent card
const card = await agent.getAgentCard();
// { name, description, selfProtocol: { agentId, verificationStrength, trustModel, ... } }

// Set or update the agent card (writes on-chain)
const txHash = await agent.setAgentCard({
  name: "My Agent",
  description: "An AI assistant with verified identity",
  url: "https://myagent.example.com",
  skills: [{ name: "search", description: "Web search" }],
});

// Generate a data URI for embedding
const dataUri = await agent.toAgentCardDataURI();
```

## Registration Helpers

Build the `userDefinedData` strings that Self Protocol expects during registration:

```typescript
import {
  getRegistrationConfigIndex,
  computeRegistrationChallengeHash,
  signRegistrationChallenge,
  buildSimpleRegisterUserDataAscii,
  buildSimpleDeregisterUserDataAscii,
  buildAdvancedRegisterUserDataAscii,
  buildAdvancedDeregisterUserDataAscii,
  buildWalletFreeRegisterUserDataAscii,
} from "@selfxyz/agent-sdk";

// Config index maps disclosure flags to one of 6 on-chain configs
getRegistrationConfigIndex({ minimumAge: 18, ofac: true }); // 4

// Simple mode (self-custody) — human IS the agent
buildSimpleRegisterUserDataAscii({ minimumAge: 18 }); // "R1"
buildSimpleDeregisterUserDataAscii({ minimumAge: 18 }); // "D1"

// Advanced mode (linked) — agent has own keypair
const signed = await signRegistrationChallenge("0xagentPrivKey", {
  humanIdentifier: "0xhumanAddr",
  chainId: 11142220,
  registryAddress: "0x29d94...",
});

buildAdvancedRegisterUserDataAscii({
  agentAddress: signed.agentAddress,
  signature: signed, // or { r, s, v }
  disclosures: { minimumAge: 18, ofac: true },
}); // "K4{addr}{r}{s}{v}"

// Wallet-free mode — agent acts as guardian
buildWalletFreeRegisterUserDataAscii({
  agentAddress: "0xagent",
  guardianAddress: "0xguardian",
  signature: signed,
  disclosures: { minimumAge: 18 },
}); // "W1{agent}{guardian}{r}{s}{v}"
```

## REST Registration API

Programmatic registration without the CLI:

Set `SELF_AGENT_API_BASE` to override the default hosted API base.

```typescript
import { requestRegistration, requestDeregistration } from "@selfxyz/agent-sdk";

// Start a registration session
const session = await requestRegistration({
  mode: "linked",
  network: "mainnet",
  disclosures: { minimumAge: 18, ofac: true },
  agentName: "My Agent",
});

console.log(session.deepLink); // URL for the human to open
console.log(session.humanInstructions); // Steps for the human

// Wait for completion (polls on-chain)
const result = await session.waitForCompletion({ timeoutMs: 300_000 });
console.log(result.agentId); // On-chain agent ID
console.log(result.agentAddress); // Agent's address

// Export the generated private key
const privateKey = await session.exportKey();

// Deregister
const deregSession = await requestDeregistration({
  network: "mainnet",
  agentAddress: "0x...",
  agentPrivateKey: "0x...",
});
await deregSession.waitForCompletion();
```

## CLI

Interactive registration via the command line:

```bash
# Register an agent (linked mode)
npx self-agent register init --mode linked --human-address 0x... --network testnet
npx self-agent register open --session .self/session.json
npx self-agent register wait --session .self/session.json

# Deregister
npx self-agent deregister init --mode linked --human-address 0x... --agent-address 0x... --network testnet
npx self-agent deregister open --session .self/session.json
npx self-agent deregister wait --session .self/session.json

# Export private key (requires --unsafe flag)
npx self-agent register export --session .self/session.json --unsafe --print-private-key
```

**Registration modes:**

| Mode             | Description                               | `userDefinedData`                 |
| ---------------- | ----------------------------------------- | --------------------------------- |
| `self-custody`   | Human address = agent address             | `R{cfg}`                          |
| `linked`         | Agent has own keypair, signed challenge   | `K{cfg}{addr}{r}{s}{v}`           |
| `wallet-free`    | Agent as guardian, no human wallet needed | `W{cfg}{addr}{guardian}{r}{s}{v}` |
| `ed25519`        | Ed25519 wallet-free agent                 | `W{cfg}{addr}{guardian}{r}{s}{v}` |
| `ed25519-linked` | Ed25519 agent linked to human wallet      | `K{cfg}{addr}{r}{s}{v}`           |
| `smartwallet`    | ZeroDev Kernel + passkeys                 | Smart wallet template             |

## Configuration

```typescript
// Testnet
const agent = new SelfAgent({ privateKey: "0x...", network: "testnet" });
const verifier = new SelfAgentVerifier({ network: "testnet" });

// Custom overrides
const verifier = new SelfAgentVerifier({
  registryAddress: "0x...",
  rpcUrl: "https://...",
  maxAgentsPerHuman: 5,
  requireSelfProvider: true,
  includeCredentials: true,
});
```

## Security Chain

The verifier implements an 11-step security chain:

1. **Timestamp freshness** — reject stale requests (default: 5 min window)
2. **Signature recovery** — derive agent address from ECDSA signature
3. **Agent key derivation** — `zeroPad(address, 32)` for on-chain lookup
4. **On-chain verification** — `isVerifiedAgent(agentKey)` confirms human backing
5. **Provider check** — ensures proof came from Self Protocol, not a third party
6. **Sybil resistance** — limits agents per human (default: 1)
7. **Replay protection** — reject duplicate `(signature, timestamp)` pairs
8. **Credential validation** — verify ZK-attested credentials if configured
9. **Age verification** — enforce minimum age from passport proof
10. **OFAC screening** — verify agent passed sanctions screening
11. **Rate limiting** — per-agent request throttling

## Cross-Language Compatibility

This SDK is 100% compatible with the Rust SDK (`self-agent-sdk`) and Python SDK (`selfxyz-agent-sdk`). All three produce byte-identical signatures and `userDefinedData` payloads for the same inputs.

## Networks

| Network                | Registry                                     | Chain ID |
| ---------------------- | -------------------------------------------- | -------- |
| Mainnet (Celo)         | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | 42220    |
| Testnet (Celo Sepolia) | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` | 11142220 |

## License

Business Source License 1.1 (`BUSL-1.1`). See [../LICENSE](../LICENSE).
