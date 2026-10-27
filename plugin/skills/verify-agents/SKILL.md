---
name: verify-agents
description: >
  Verify Self Agent ID identities and add verification middleware to APIs.
  Covers one-off agent verification, SelfAgentVerifier builder pattern,
  reputation scoring, freshness validation, sybil detection, and the critical
  provider check. Use when the user asks to "verify an agent", "check agent
  identity", "add verification", "agent verification middleware", "is this
  agent verified", "reputation score", "check proof of human", or
  "validate agent freshness".
license: MIT
metadata:
  author: Self Protocol
  version: 1.0.0
  mcp-server: self-agent-id
---

# Verify Agents

## Two Workflows

This skill covers two distinct verification workflows:

1. **Verify a specific agent** — Check whether a given agent is verified on-chain, retrieve its credentials, reputation score, and freshness status.
2. **Add verification to an API** — Integrate middleware into a service that verifies incoming HTTP requests from Self Agent ID-authenticated agents.

Both workflows read the same on-chain state: the `SelfAgentRegistry` contract and its approved proof provider. The difference is context — one-off lookups versus continuous request authentication.

---

## CRITICAL: Provider Verification

**This is the single most important security check in the entire verification pipeline.**

Every verification flow MUST confirm that the agent's proof provider is the Self Protocol provider address — not a third-party or fake provider. Without this check, an attacker could deploy a malicious `IHumanProofProvider` contract that always returns `true`, register agents through it, and bypass all identity guarantees.

**Provider addresses:**

| Network            | SelfHumanProofProvider Address               |
| ------------------ | -------------------------------------------- |
| Mainnet (42220)    | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` |
| Testnet (11142220) | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |

**How to check:**

- **MCP tool:** `require_self_provider` defaults to `true` — the tool handles the check automatically.
- **SDK:** Call `registry.getProofProvider(agentId)` and compare the returned address against the known Self Protocol provider address. The `SelfAgentVerifier` builder's `.requireSelfProvider()` method adds this check to the verification pipeline.
- **On-chain (Solidity):** `require(registry.getProofProvider(agentId) == SELF_PROVIDER_ADDRESS, "Wrong provider");`

**SDK default behavior:** The `SelfAgentVerifier` checks the proof provider by default (`requireSelfProvider` defaults to `true`). Do not disable this check unless intentionally accepting agents verified by third-party providers. To explicitly disable: pass `requireSelfProvider: false` to `new SelfAgentVerifier({...})` / `fromConfig`. Omitting the provider check is the most common and most dangerous integration mistake.

---

## Verify a Specific Agent Using MCP

Use the public `self_verify_agent` tool (hosted MCP server) to perform a one-off verification of any agent.

### Input Parameters

| Parameter               | Required | Type            | Description                                                                                 |
| ----------------------- | -------- | --------------- | ------------------------------------------------------------------------------------------- |
| `agent_address`         | Yes      | `string`        | Ethereum address of the agent to verify                                                     |
| `network`               | No       | `string`        | `"mainnet"` or `"testnet"` (defaults to the server's network, mainnet on the hosted server) |
| `require_age`           | No       | `0 \| 18 \| 21` | Minimum age threshold to require (default 0)                                                |
| `require_ofac`          | No       | `bool`          | Require OFAC sanctions screening clearance (default false)                                  |
| `require_self_provider` | No       | `bool`          | Require the proof provider to be Self Protocol (default true)                               |
| `max_agents_per_human`  | No       | `int` (0-10)    | Fail if the human has more agents than this (default 1, 0 = no limit)                       |

### Output

```
verified              — bool: passes every check (a fresh human proof is always required)
agent_address         — string: the address checked
agent_id              — number: the on-chain agent ID
credentials           — object: { nationality, older_than, ofac_clear }
sybil_count           — number: agents registered by this human
verification_strength — "self-protocol" | "third-party" | "unknown"
registered_at_block   — number: block number of registration
proof_expires_at      — ISO-8601 string; proof_expired: bool; proof_expiring_soon / expiry_warning when < 30 days
reason                — string: present when verified is false; lists every failed check
network               — the network queried
```

For an address with no registration the tool returns only `{ verified: false, agent_address, reason: "Agent is not registered on-chain.", network }`.

### Example Usage

To verify an agent at address `0x83fa...ff00` is a Self Protocol-verified adult:

```
Tool: self_verify_agent
Input:
  agent_address: "0x83fa4380903fecb801F4e123835664973001ff00"
  network: "testnet"
  require_age: 18
  require_ofac: true
  require_self_provider: true
```

If any check fails, `verified` returns `false` and `reason` explains which checks failed. Keep `require_self_provider: true` (the default) in production.

---

## Verify a Specific Agent Using the REST API

```bash
curl -s https://agent-api.self.xyz/api/agent/verify/11142220/1
```

```json
{
  "agentId": 1,
  "chainId": 11142220,
  "isVerified": true,
  "hasHumanProof": true,
  "isProofFresh": true,
  "proofExpiresAt": "2027-02-25T17:58:52.000Z",
  "proofProvider": "0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c",
  "isSelfProvider": true,
  "verificationStrength": 100,
  "strengthLabel": "passport",
  "humanNullifier": "1053…0982",
  "agentCountForHuman": 13
}
```

- `isVerified` is `hasHumanProof && isProofFresh`; check `isSelfProvider` and `agentCountForHuman` for the provider and sybil policy.
- A never-minted or burned agent returns `404 { "error": "Agent not found" }`; an unsupported chain ID returns `400`; RPC failures return `502 { "error": "RPC error" }`.
- `GET /api/verify-status/{chainId}/{agentId}` returns a compact `{ verified, hasHumanProof, isProofFresh, proofExpiresAt, proofType, registeredAtBlock, providerAddress }`.

---

## Verify Incoming HTTP Requests Using MCP

Use the public `self_verify_request` tool to validate an incoming HTTP request signed by a Self Agent (ECDSA agents). It accepts the same policy parameters as `self_verify_agent`.

### Input Parameters

| Parameter         | Required | Type     | Description                                      |
| ----------------- | -------- | -------- | ------------------------------------------------ |
| `agent_address`   | Yes      | `string` | From `x-self-agent-address` header               |
| `agent_signature` | Yes      | `string` | From `x-self-agent-signature` header             |
| `agent_timestamp` | Yes      | `string` | From `x-self-agent-timestamp` header             |
| `method`          | Yes      | `string` | HTTP method (e.g., `"POST"`)                     |
| `path`            | Yes      | `string` | Request path and query (e.g., `"/api/data?x=1"`) |
| `body`            | No       | `string` | Raw request body, exactly as received            |

### Output

```
valid              — bool: whether the request is authenticated and the agent is verified
agent_address      — string: recovered signer address
agent_id           — uint256: on-chain agent ID
agent_count        — uint256: number of agents for this human (sybil indicator)
credentials        — object: { nationality, older_than, ofac_clear }
network, note      — network checked; replay-protection note
```

On failure the tool returns `{ valid: false, agent_address?, reason }`.

### Verification Pipeline

The tool performs these checks in sequence:

1. **Timestamp validation** — Reject if the timestamp is older than 5 minutes (replay protection).
2. **Signature recovery** — Reconstruct the signed message by concatenating `timestamp + METHOD + path + keccak256(body)`, hash with Keccak-256, recover the signer via EIP-191 ECDSA, and compare to the claimed `agent_address`.
3. **On-chain checks** — Human proof present and fresh, Self provider (default), sybil limit (default 1), age/OFAC if requested.
4. **Replay check** — Each signed request is accepted once by that MCP server instance within the 5-minute window.

Note on replay protection: the MCP server's replay cache is per instance and is not shared with your service. For state-changing operations, keep your own replay protection (the SDK verifier has one built in, or use nonces / idempotency keys).

---

## Verification Strength & Freshness

| Need                       | Read from the registry (deployed)                                     | Optional wrapper (in `contracts/src`, **not deployed**)                                         |
| -------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Strength score 0-100       | `IHumanProofProvider(getProofProvider(id)).verificationStrength()`    | `SelfReputationSignal.getReputationScore(id)` / `getReputation(id)` / `getReputationBatch(ids)` |
| Proof not expired          | `isProofFresh(id)` (`block.timestamp < proofExpiresAt`, max 365 days) | —                                                                                               |
| Registered recently enough | `agentRegisteredAt(id)` (block number)                                | `SelfFreshnessChecker.isValidAgent(id)` / `validateAgent(id)` / `validateBatch(ids)`            |

- Self agents always score **100** (`SelfHumanProofProvider.verificationStrength()`); it is the only approved provider. REST: `GET /api/reputation/{chainId}/{agentId}` returns `{ score, providerName, proofType, … }`.
- `SelfFreshnessChecker` is block-based: default threshold 6,307,200 blocks ≈ **73 days** at Celo's ~1 s blocks, owner-settable via `setFreshnessThreshold(blocks)`. `0` is the strictest setting (only agents registered in the current block pass), not "disabled". It is independent of `isProofFresh`.
- The deployed ERC-8004 registries are for feedback/attestations, not scores: `SelfReputationRegistry.getSummary(agentId, clients, tag1, tag2)` and `SelfValidationRegistry.getLatestFreshness(agentId)` (Self's daily `isProofFresh` attestation). See [contracts.md](../self-agent-id-overview/references/contracts.md).

---

## Sybil Detection

The registry supports sybil detection through nullifier-based identity linking. Each human produces a deterministic nullifier scoped to the registry — the same human always generates the same nullifier regardless of which agent they register.

### sameHuman

```solidity
function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);
```

Check if two agent IDs are controlled by the same human. Returns `true` if both agents have active human proofs and share the same non-zero nullifier. Returns `false` if either agent lacks a proof or if the nullifiers differ.

### getAgentCountForHuman

```solidity
function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
```

Returns the number of currently active agents associated with a given nullifier. To get the nullifier for an agent, first call `getHumanNullifier(agentId)`.

### Enforcement Layers

Sybil enforcement operates at two layers:

1. **Contract layer:** The registry enforces `maxAgentsPerHuman` at registration time (default: 1). If the limit is reached, registration reverts with `TooManyAgentsForHuman`. `OPERATIONS_ROLE` can adjust this via `setMaxAgentsPerHuman(n)`. Setting to `0` means unlimited.

2. **Application layer:** The SDK's `SelfAgentVerifier` provides a `sybilLimit(n)` configuration that rejects requests from agents whose human has more than `n` active agents. This is independent of the contract-level limit and can be more restrictive. Default is `1`.

The contract-level limit restricts how many agents a human can register. The application-level limit restricts how many of those agents a single service will accept. Both are important — the contract prevents mass registration, while the application prevents a single human from overwhelming a specific service with multiple agents.

---

## Using SDK — SelfAgentVerifier Builder

The `SelfAgentVerifier` class provides a builder pattern for configuring verification rules. It is the primary tool for server-side verification in TypeScript services; services in other languages can use the public `self_verify_request` MCP tool or the REST read routes.

### Builder Configuration

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("mainnet") // Select network (sets chain ID, RPC, contract addresses)
  .requireAge(18) // Reject agents without age 18+ credential
  .requireOFAC() // Reject agents without OFAC clearance
  .requireSelfProvider() // default on: reject agents not verified by Self Protocol
  .sybilLimit(3) // Max 3 agents per human
  .rateLimit({ perMinute: 100 }) // 100 requests per minute per agent
  .build();
```

### As Express Middleware

```typescript
// auth() verifies the exact request bytes: keep the raw body
// (requests with a body but no raw body get a 500)
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: Buffer }).rawBody = buf;
    },
  }),
);

// Protect all routes under /api
app.use("/api", verifier.auth());

// The middleware sets req.agent on successful verification (401 / 429 otherwise)
app.get("/api/profile", (req, res) => {
  const agent = req.agent!; // set by verifier.auth()
  // { address, agentKey, agentId, agentCount, nullifier, credentials? }
  res.json({
    agentId: agent.agentId.toString(), // bigint
    nationality: agent.credentials?.nationality, // needs .includeCredentials()
  });
});
```

### Manual Verification

```typescript
const result = await verifier.verify({
  signature: req.headers["x-self-agent-signature"],
  timestamp: req.headers["x-self-agent-timestamp"],
  method: req.method,
  url: req.originalUrl, // path + query, as signed
  body: rawBody, // the exact bytes received — not JSON.stringify(req.body)
  // Ed25519 agents: keytype: req.headers["x-self-agent-keytype"], agentKey: req.headers["x-self-agent-key"]
});

if (result.valid) {
  // result.agentId — on-chain agent ID
  // result.credentials — { nationality, olderThan, ofac, ... } (with .includeCredentials())
  // result.agentCount — number of agents for this human
} else {
  // result.error — reason for rejection
}
```

### Verification Pipeline

The verifier executes checks in this order:

1. **Header extraction** — Extract `x-self-agent-signature` and `x-self-agent-timestamp` (plus `x-self-agent-key` / `x-self-agent-keytype` for Ed25519). Missing headers result in immediate rejection.
2. **Timestamp window** — Reject if the timestamp is more than 5 minutes old (configurable).
3. **Signature recovery** — Reconstruct the signed message and recover the signer (ECDSA) or verify the Ed25519 signature. The identity comes from the signature, not the address header.
4. **Replay check** — Reject a signature already seen (default on).
5. **On-chain proof** — `registry.isVerifiedAgent(agentKey)` (proof present) and `isProofFresh(agentId)` (not expired).
6. **Provider check** — `getProofProvider(agentId)` must match Self Protocol (default on).
7. **Sybil check** — `getAgentCountForHuman(nullifier) <= maxAgentsPerHuman` (default 1).
8. **Credential checks** — If `.requireAge(n)`, `.requireOFAC()` or `.requireNationality(...)` is set, read `getAgentCredentials(agentId)` and verify.
9. **Rate limiting** — If configured, check per-agent request rate.

Each check short-circuits on failure, returning `{ valid: false, error: "..." }`.

## Contract Addresses for Verification

| Contract               | Mainnet (42220)                              | Testnet (11142220)                           |
| ---------------------- | -------------------------------------------- | -------------------------------------------- |
| SelfAgentRegistry      | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| SelfHumanProofProvider | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |
| SelfReputationRegistry | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` | `0x3Bb0A898C1C0918763afC22ff624131b8F420CC2` |
| SelfValidationRegistry | `0x71a025e0e338EAbcB45154F8b8CA50b41e7A0577` | `0x84cA20B8A1559F136dA03913dbe6A7F68B6B240B` |

---

## Troubleshooting

| Symptom                                                | Cause                                         | Resolution                                                                                                                                        |
| ------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification returns "Wrong provider"                  | Agent was verified by a non-Self provider     | Confirm the agent registered through Self Protocol. Check `getProofProvider(agentId)` against the known Self provider address.                    |
| Verification returns "No human proof"                  | Agent is registered but has no active proof   | The agent may have been deregistered or the proof revoked. Re-register the agent.                                                                 |
| Verification returns "Agent's human proof has expired" | `proofExpiresAt` has passed                   | Ask the human to refresh the proof in place (`requestProofRefresh` / `POST /api/agent/refresh`); deregister + re-register if refresh returns 422. |
| `SelfFreshnessChecker.isValidAgent` returns false      | Registered more blocks ago than the threshold | Default window is 6,307,200 blocks (≈73 days). Refresh does not reset `agentRegisteredAt`; re-register or raise the threshold on your deployment. |
| Middleware rejects all requests with 401               | Missing headers or a re-serialized body       | Verify the middleware sees `x-self-agent-signature` and `x-self-agent-timestamp` (case-insensitive) and the raw body bytes the agent signed.      |
| Sybil check fails unexpectedly                         | `sybilLimit` set too low                      | If the human legitimately has multiple agents, increase the `sybilLimit()` value in the verifier config.                                          |
| RPC errors during on-chain verification                | Wrong network or RPC endpoint                 | Ensure the verifier's `network` matches the network the agent registered on. Check RPC URL connectivity.                                          |

## Reference Documentation

For complete code examples across multiple frameworks (Express, Hono) and Solidity integration patterns, see [`references/verification-patterns.md`](references/verification-patterns.md).
