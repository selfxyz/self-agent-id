---
name: verify-agents
description: >
  This skill should be used when the user asks to "verify an agent",
  "check agent identity", "add verification", "agent verification middleware",
  "is this agent verified", "reputation score", "check proof of human",
  "validate agent freshness", or wants to verify other agents or add
  Self Agent ID verification to their API.
---

# Verify Agents

## Two Workflows

This skill covers two distinct verification workflows:

1. **Verify a specific agent** — Check whether a given agent is verified on-chain, retrieve its credentials, reputation score, and freshness status.
2. **Add verification to an API** — Integrate middleware into a service that verifies incoming HTTP requests from Self Agent ID-authenticated agents.

Both workflows rely on the same on-chain state: the `SelfAgentRegistry` contract, the `SelfReputationProvider`, and the `SelfValidationProvider`. The difference is context — one-off lookups versus continuous request authentication.

---

## CRITICAL: Provider Verification

**This is the single most important security check in the entire verification pipeline.**

Every verification flow MUST confirm that the agent's proof provider is the Self Protocol provider address — not a third-party or fake provider. Without this check, an attacker could deploy a malicious `IHumanProofProvider` contract that always returns `true`, register agents through it, and bypass all identity guarantees.

**Provider addresses:**

| Network | SelfHumanProofProvider Address |
|---|---|
| Mainnet (42220) | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` |
| Testnet (11142220) | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` |

**How to check:**

- **MCP tool:** Set `require_self_provider: true` — the tool handles the check automatically.
- **SDK:** Call `registry.getProofProvider(agentId)` and compare the returned address against the known Self Protocol provider address. The `SelfAgentVerifier` builder's `.requireSelfProvider()` method adds this check to the verification pipeline.
- **On-chain (Solidity):** `require(registry.getProofProvider(agentId) == SELF_PROVIDER_ADDRESS, "Wrong provider");`

**SDK default behavior:** The `SelfAgentVerifier` checks the proof provider by default (`requireSelfProvider` defaults to `true`). Do not disable this check unless intentionally accepting agents verified by third-party providers. To explicitly disable: pass `requireSelfProvider: false` in the verifier config. Omitting the provider check is the most common and most dangerous integration mistake.

---

## Verify a Specific Agent Using MCP

Use the `self_verify_agent` tool to perform a one-off verification of any agent.

### Input Parameters

| Parameter | Required | Type | Description |
|---|---|---|---|
| `agent_address` | Yes | `string` | Ethereum address of the agent to verify |
| `network` | No | `string` | `"mainnet"` or `"testnet"` (defaults to `"mainnet"`) |
| `require_age` | No | `0 \| 18 \| 21` | Minimum age threshold to require |
| `require_ofac` | No | `bool` | Require OFAC sanctions screening clearance |
| `require_self_provider` | No | `bool` | Require the proof provider to be Self Protocol |

### Output

```
verified           — bool: whether the agent passes all specified checks
agent_id           — uint256: the on-chain agent ID (0 if not registered)
credentials        — object: { nationality, older_than, ofac_clear }
sybil_count        — uint256: number of agents registered by this human
verification_strength — uint8: 0-100 score from the proof provider
registered_at      — uint256: block number of registration
reason             — string: explanation if verified is false (e.g., "No human proof", "Wrong provider", "Age requirement not met")
```

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

If any check fails, `verified` returns `false` and `reason` explains which check failed. Always set `require_self_provider: true` in production.

---

## Verify Incoming HTTP Requests Using MCP

Use the `self_verify_request` tool to validate an incoming HTTP request signed by a Self Agent.

### Input Parameters

| Parameter | Required | Type | Description |
|---|---|---|---|
| `agent_address` | Yes | `string` | From `x-self-agent-address` header |
| `agent_signature` | Yes | `string` | From `x-self-agent-signature` header |
| `agent_timestamp` | Yes | `string` | From `x-self-agent-timestamp` header |
| `method` | Yes | `string` | HTTP method (e.g., `"POST"`) |
| `path` | Yes | `string` | Request path (e.g., `"/api/data"`) |
| `body` | No | `string` | Request body (empty string if no body) |

### Output

```
valid              — bool: whether the request is authenticated and the agent is verified
agent_address      — string: recovered signer address
agent_id           — uint256: on-chain agent ID
agent_count        — uint256: number of agents for this human (sybil indicator)
credentials        — object: { nationality, older_than, ofac_clear }
```

### Verification Pipeline

The tool performs these checks in sequence:

1. **Timestamp validation** — Reject if the timestamp is older than 5 minutes (replay protection).
2. **Signature recovery** — Reconstruct the signed message by concatenating `timestamp + METHOD + path + keccak256(body)`, hash with Keccak-256, recover the signer via EIP-191 ECDSA, and compare to the claimed `agent_address`.
3. **On-chain proof check** — Derive the agent key from the address and call `registry.isVerifiedAgent(agentKey)`.
4. **Provider check** — Verify `registry.getProofProvider(agentId)` matches Self Protocol's provider address.
5. **Credential retrieval** — Fetch ZK-attested credentials from the registry.

Note on replay protection: the 5-minute timestamp window means a signed request can be replayed within that window. For state-changing operations, implement additional replay protection (e.g., nonces, idempotency keys) at the application layer. The timestamp window is a trade-off between clock skew tolerance and replay risk.

---

## Reputation Scoring (SelfReputationProvider)

The `SelfReputationProvider` contract provides standardized reputation scores for agents based on the verification strength of their proof provider.

### getReputationScore

```solidity
function getReputationScore(uint256 agentId) external view returns (uint8);
```

Returns a score from 0 to 100. The score is derived directly from the proof provider's `verificationStrength()` value.

**Score tiers:**

| Score | Meaning | Provider Type |
|---|---|---|
| 0 | No human proof or unverified agent | None / unknown |
| 40 | Video liveness check | Video verification provider |
| 60 | Government ID without NFC chip (e.g., Aadhaar scan) | Document-based provider |
| 100 | Passport NFC chip + biometric verification | Self Protocol |

Self Protocol agents always score **100** because the `SelfHumanProofProvider` reports `verificationStrength() = 100`.

### getReputation

```solidity
function getReputation(uint256 agentId) external view returns (
    uint8 score,
    string memory providerName,
    bool hasProof,
    uint256 registeredAtBlock
);
```

Returns full reputation details:
- `score` — The 0-100 reputation score
- `providerName` — The provider's self-reported name (e.g., `"self"`)
- `hasProof` — Whether the agent has an active human proof
- `registeredAtBlock` — The block number at which the agent was registered

### getReputationBatch

```solidity
function getReputationBatch(uint256[] calldata agentIds) external view returns (uint8[] memory);
```

Batch query for multiple agents. Returns an array of scores in the same order as the input IDs. Use this for leaderboards, dashboards, or any UI that displays multiple agents.

---

## Freshness Validation (SelfValidationProvider)

The `SelfValidationProvider` contract checks whether an agent's proof is still considered "fresh" — that is, whether enough time has passed since registration that re-verification might be warranted.

### isValidAgent

```solidity
function isValidAgent(uint256 agentId) external view returns (bool);
```

Quick boolean check. Returns `true` only if the agent has a valid human proof AND the proof is still within the freshness threshold. Returns `false` if the agent is unregistered, has no proof, or the proof has expired.

### validateAgent

```solidity
function validateAgent(uint256 agentId) external view returns (
    bool valid,
    bool fresh,
    uint256 registeredAt,
    uint256 blockAge,
    address proofProvider
);
```

Full validation details:
- `valid` — Whether the agent has a human proof at all
- `fresh` — Whether the proof is within the freshness window
- `registeredAt` — Block number of registration
- `blockAge` — Number of blocks since registration
- `proofProvider` — Address of the proof provider that verified this agent

### Freshness Threshold

- **Default:** 6,307,200 blocks (~1 year on Celo at 5 seconds per block)
- **Configuration:** The contract owner can call `setFreshnessThreshold(blocks)` to adjust
- **Disabling:** Setting the threshold to `0` disables freshness checking entirely (all valid agents are considered fresh)

Freshness is a policy decision. A financial service might set a 30-day threshold requiring frequent re-verification. A social platform might accept the default 1-year window. A development environment might disable it entirely.

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

1. **Contract layer:** The registry enforces `maxAgentsPerHuman` at registration time (default: 1). If the limit is reached, registration reverts with `TooManyAgentsForHuman`. The owner can adjust this via `setMaxAgentsPerHuman(n)`. Setting to `0` means unlimited.

2. **Application layer:** The SDK's `SelfAgentVerifier` provides a `sybilLimit(n)` configuration that rejects requests from agents whose human has more than `n` active agents. This is independent of the contract-level limit and can be more restrictive. Default is `1`.

The contract-level limit restricts how many agents a human can register. The application-level limit restricts how many of those agents a single service will accept. Both are important — the contract prevents mass registration, while the application prevents a single human from overwhelming a specific service with multiple agents.

---

## Using SDK — SelfAgentVerifier Builder

The `SelfAgentVerifier` class provides a builder pattern for configuring verification rules. It is the primary tool for server-side verification in TypeScript, Python, and Rust applications.

### Builder Configuration

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("mainnet")                              // Select network (sets chain ID, RPC, contract addresses)
  .requireAge(18)                                   // Reject agents without age 18+ credential
  .requireOFAC()                                    // Reject agents without OFAC clearance
  .requireSelfProvider()                            // CRITICAL: reject agents not verified by Self Protocol
  .sybilLimit(3)                                    // Max 3 agents per human
  .rateLimit({ windowMs: 60000, maxRequests: 100 }) // 100 requests per minute per agent
  .build();
```

### As Express Middleware

```typescript
// Protect all routes under /api
app.use("/api", verifier.auth());

// The middleware sets req.verifiedAgent on successful verification
app.get("/api/profile", (req, res) => {
  const agent = req.verifiedAgent;
  // { agentId, address, credentials, agentCount }
  res.json({ agentId: agent.agentId, nationality: agent.credentials.nationality });
});
```

### Manual Verification

```typescript
const result = await verifier.verify({
  address: req.headers["x-self-agent-address"],
  signature: req.headers["x-self-agent-signature"],
  timestamp: req.headers["x-self-agent-timestamp"],
  method: req.method,
  path: req.path,
  body: JSON.stringify(req.body),
});

if (result.valid) {
  // result.agentId — on-chain agent ID
  // result.credentials — { nationality, olderThan, ofac }
  // result.agentCount — number of agents for this human
} else {
  // result.error — reason for rejection
}
```

### Verification Pipeline

The verifier executes checks in this order:

1. **Header extraction** — Extract `x-self-agent-address`, `x-self-agent-signature`, `x-self-agent-timestamp` from the request. Missing headers result in immediate rejection.
2. **Timestamp window** — Reject if the timestamp is more than 5 minutes old (configurable).
3. **Signature recovery** — Reconstruct the signed message, recover the signer via ECDSA, compare to the claimed address.
4. **Rate limiting** — If configured, check per-agent request rate.
5. **On-chain proof** — Call `registry.isVerifiedAgent(agentKey)`.
6. **Provider check** — If `.requireSelfProvider()` is set, verify `getProofProvider(agentId)` matches Self Protocol.
7. **Credential checks** — If `.requireAge(n)` or `.requireOFAC()` is set, read `getAgentCredentials(agentId)` and verify.
8. **Sybil check** — If `.sybilLimit(n)` is set, check `getAgentCountForHuman(nullifier) <= n`.

Each check short-circuits on failure, returning `{ valid: false, error: "..." }`.

### Python and Rust Equivalents

The same API surface exists in Python and Rust:

**Python:**
```python
from self_agent_sdk import SelfAgentVerifier

verifier = (SelfAgentVerifier.create()
    .network("mainnet")
    .require_age(18)
    .require_ofac()
    .require_self_provider()
    .sybil_limit(3)
    .build())
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
    .build()?;
```

---

## Contract Addresses for Verification

| Contract | Mainnet (42220) | Testnet (11142220) |
|---|---|---|
| SelfAgentRegistry | `0x62E37d0f6c5f67784b8828B3dF68BCDbB2e55095` | `0x42CEA1b318557aDE212bED74FC3C7f06Ec52bd5b` |
| SelfHumanProofProvider | `0x0B43f87aE9F2AE2a50b3698573B614fc6643A084` | `0x69Da18CF4Ac27121FD99cEB06e38c3DC78F363f4` |
| SelfReputationProvider | Deployed alongside registry | Deployed alongside registry |
| SelfValidationProvider | Deployed alongside registry | Deployed alongside registry |

---

## Reference Documentation

For complete code examples across multiple frameworks (Express, FastAPI, Axum, Hono) and Solidity integration patterns, see [`references/verification-patterns.md`](references/verification-patterns.md).
