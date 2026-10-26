# Verification Patterns — Detailed Reference

This document provides complete, production-ready code patterns for verifying Self Agent ID identities across frameworks and environments. Each pattern demonstrates the full verification pipeline including the critical provider check.

---

## Contract Addresses

Reference these addresses throughout all verification code:

| Contract               | Mainnet (42220)                              | Testnet (11142220)                           |
| ---------------------- | -------------------------------------------- | -------------------------------------------- |
| SelfAgentRegistry      | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| SelfHumanProofProvider | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |
| Hub V2                 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |

---

## Express Middleware (TypeScript)

The most common integration pattern for Node.js services. Uses the `@selfxyz/agent-sdk` package with Express.

### Full Example

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

// Build the verifier with all desired checks
const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider() // default on; keep it in production
  .sybilLimit(3)
  .includeCredentials() // populate req.agent.credentials
  .rateLimit({ perMinute: 100 })
  .build();

// Protect all /api routes — unverified requests get 401
app.use("/api", verifier.auth());

// Public routes remain accessible without agent auth
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Access verified agent info in protected routes
app.get("/api/profile", (req, res) => {
  const agent = req.agent!; // set by verifier.auth()
  // agent: { address, agentKey, agentId, agentCount, nullifier, credentials? }
  res.json({
    agentId: agent.agentId.toString(), // bigint
    nationality: agent.credentials?.nationality,
    olderThan: Number(agent.credentials?.olderThan ?? 0),
    ofacClear: agent.credentials?.ofac.every(Boolean),
    agentCount: agent.agentCount.toString(),
  });
});

// Example: age-gated endpoint with additional credential checks
app.post("/api/restricted", (req, res) => {
  const agent = req.agent!; // set by verifier.auth()

  // Additional application-level checks beyond the verifier config
  if (Number(agent.credentials?.olderThan ?? 0) < 21) {
    return res.status(403).json({ error: "Must be 21+ for this endpoint" });
  }

  res.json({ message: "Access granted", agentId: agent.agentId.toString() });
});

// Example: sybil-aware endpoint
app.post("/api/claim-reward", (req, res) => {
  const agent = req.agent!; // set by verifier.auth()

  if (agent.agentCount > 1n) {
    return res.status(403).json({
      error: "Only one agent per human can claim rewards",
      agentCount: agent.agentCount.toString(),
    });
  }

  // Process reward claim...
  res.json({ claimed: true, agentId: agent.agentId.toString() });
});

app.listen(3000, () => console.log("Server running on port 3000"));
```

### Selective Route Protection

To protect only specific routes instead of all `/api` routes:

```typescript
// Create the middleware function
const agentAuth = verifier.auth();

// Apply to individual routes
app.get("/api/public-data", (_req, res) => {
  res.json({ data: "publicly accessible" });
});

app.get("/api/private-data", agentAuth, (req, res) => {
  // Only verified agents reach this handler
  res.json({ data: "agent-only", agentId: req.agent!.agentId.toString() });
});
```

### Error Handling

The middleware returns `401 { "error": "<reason>" }` when verification fails (`429 { "error", "retryAfterMs" }` when rate limited):

```json
{ "error": "Agent was not verified by Self — proof provider mismatch" }
```

Possible rejection reasons (TypeScript SDK wording):

- `"Missing agent authentication headers"`
- `"Timestamp expired or invalid"`
- `"Invalid signature"` / `"Invalid Ed25519 signature"`
- `"Agent not verified on-chain"`
- `"Agent's human proof has expired"`
- `"Agent was not verified by Self — proof provider mismatch"`
- `"Human has N agents (max M)"`
- `"Agent's human does not meet minimum age (required: 18, got: 0)"`
- `"Agent's human did not pass OFAC screening"`
- `"Rate limit exceeded (100/min)"`

---

## Hono Middleware (TypeScript)

Lightweight middleware pattern for Hono (Node.js, Bun, Deno).

### Full Example

```typescript
import { Hono } from "hono";
import { SelfAgentVerifier, type VerificationResult } from "@selfxyz/agent-sdk";

const app = new Hono<{ Variables: { agent: VerificationResult } }>();

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider()
  .sybilLimit(3)
  .includeCredentials()
  .build();

// Agent verification middleware
app.use("/api/*", async (c, next) => {
  const signature = c.req.header("x-self-agent-signature");
  const timestamp = c.req.header("x-self-agent-timestamp");
  if (!signature || !timestamp) {
    return c.json({ error: "Missing Self Agent authentication headers" }, 401);
  }

  const body = await c.req.text();
  const result = await verifier.verify({
    signature,
    timestamp,
    method: c.req.method,
    url: c.req.url, // path + query is what gets signed
    body: body || undefined,
    keytype: c.req.header("x-self-agent-keytype"),
    agentKey: c.req.header("x-self-agent-key"),
  });

  if (!result.valid) {
    return c.json({ error: result.error }, result.retryAfterMs ? 429 : 401);
  }

  c.set("agent", result);
  await next();
});

// Public route
app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/api/profile", (c) => {
  const agent = c.get("agent");
  return c.json({
    agentId: agent.agentId.toString(),
    nationality: agent.credentials?.nationality,
    olderThan: Number(agent.credentials?.olderThan ?? 0),
  });
});

export default app;
```

---

## On-Chain Verification (Solidity)

Complete patterns for smart contracts that need to verify agent identities. All patterns assume the registry interface is imported and the contract addresses are configured.

### Interface Imports

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC8004ProofOfHuman } from "./interfaces/IERC8004ProofOfHuman.sol";

interface ISelfAgentRegistry is IERC8004ProofOfHuman {
    struct AgentCredentials {
        string issuingState;
        string[] name;
        string idNumber;
        string nationality;
        string dateOfBirth;
        string gender;
        string expiryDate;
        uint256 olderThan;
        bool[3] ofac;
    }

    function isVerifiedAgent(bytes32 agentKey) external view returns (bool);
    function getAgentId(bytes32 agentKey) external view returns (uint256);
    function getAgentCredentials(uint256 agentId) external view returns (AgentCredentials memory);
    function agentRegisteredAt(uint256 agentId) external view returns (uint256);
}

interface IHumanProofProvider {
    function providerName() external view returns (string memory);
    function verificationStrength() external view returns (uint8);
}

// Only if you deploy contracts/src/SelfFreshnessChecker.sol yourself (no canonical deployment)
interface ISelfFreshnessChecker {
    function isValidAgent(uint256 agentId) external view returns (bool);
    function validateAgent(uint256 agentId) external view returns (
        bool valid, bool fresh, uint256 registeredAt, uint256 blockAge, address proofProvider
    );
}
```

### Basic Humanity Check

The simplest on-chain verification — confirm an agent has a human proof that has not expired. `hasHumanProof` (and `isVerifiedAgent`) stay `true` after the proof expires, so always pair them with `isProofFresh`.

```solidity
IERC8004ProofOfHuman registry = IERC8004ProofOfHuman(REGISTRY_ADDRESS);

function requireHuman(uint256 agentId) internal view {
    require(registry.hasHumanProof(agentId), "Not human-verified");
    require(registry.isProofFresh(agentId), "Proof expired");
}
```

### Provider Verification

**CRITICAL: Always check the provider in production.**

```solidity
address constant SELF_PROVIDER_MAINNET = 0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d;
address constant SELF_PROVIDER_TESTNET = 0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c;

function requireSelfProvider(uint256 agentId) internal view {
    address provider = registry.getProofProvider(agentId);
    require(provider == SELF_PROVIDER_MAINNET, "Not verified by Self Protocol");
}
```

Without this check, an attacker could deploy a malicious `IHumanProofProvider` that always returns `true` and `verificationStrength = 100`, register agents through it, and those agents would pass `hasHumanProof()` and `verificationStrength()` checks. The provider check is the only defense against this attack.

### Verification-Strength Gating

Only useful if you accept non-Self providers (with the provider check, strength is always 100). This is what `SelfReputationSignal.getReputationScore` returns.

```solidity
function requireStrength(uint256 agentId, uint8 minScore) internal view {
    address provider = registry.getProofProvider(agentId);
    require(provider != address(0), "No proof");
    require(IHumanProofProvider(provider).verificationStrength() >= minScore, "Insufficient strength");
}
```

### Registration Block Age (Optional)

`isProofFresh` covers expiry. To also cap how long ago the agent registered, compare `agentRegisteredAt(agentId)` with `block.number`, or use your own `SelfFreshnessChecker` deployment (default 6,307,200 blocks ≈ 73 days at ~1 s/block):

```solidity
ISelfFreshnessChecker checker = ISelfFreshnessChecker(MY_FRESHNESS_CHECKER);
require(checker.isValidAgent(agentId), "Registration too old");
```

### Sybil Detection

Check whether two agents share the same human identity, or count how many agents a human controls.

```solidity
// Check if two agents are the same human
function areSameHuman(uint256 agentIdA, uint256 agentIdB) internal view returns (bool) {
    return registry.sameHuman(agentIdA, agentIdB);
}

// Check total agents for a human
function getHumanAgentCount(uint256 agentId) internal view returns (uint256) {
    uint256 nullifier = registry.getHumanNullifier(agentId);
    return registry.getAgentCountForHuman(nullifier);
}

// Enforce sybil limit
function requireSybilLimit(uint256 agentId, uint256 maxAgents) internal view {
    uint256 count = getHumanAgentCount(agentId);
    require(count <= maxAgents, "Too many agents for this human");
}
```

### Credential-Based Access Control

Read ZK-attested credentials for fine-grained access control.

```solidity
ISelfAgentRegistry fullRegistry = ISelfAgentRegistry(REGISTRY_ADDRESS);

// Age-gated access
function requireAge(uint256 agentId, uint256 minAge) internal view {
    ISelfAgentRegistry.AgentCredentials memory creds = fullRegistry.getAgentCredentials(agentId);
    require(creds.olderThan >= minAge, "Age requirement not met");
}

// OFAC compliance check — all three lists must be clear
function requireOFAC(uint256 agentId) internal view {
    ISelfAgentRegistry.AgentCredentials memory creds = fullRegistry.getAgentCredentials(agentId);
    require(creds.ofac[0] && creds.ofac[1] && creds.ofac[2], "OFAC screening not passed");
}

// Nationality-based access (use with care — may have legal implications)
function requireNationality(uint256 agentId, string memory expected) internal view {
    ISelfAgentRegistry.AgentCredentials memory creds = fullRegistry.getAgentCredentials(agentId);
    require(
        keccak256(bytes(creds.nationality)) == keccak256(bytes(expected)),
        "Nationality mismatch"
    );
}
```

### Combined Check — Your Own Gated Contract

The recommended pattern for production contracts (`MyAgentGatedService` is your contract, not one shipped in this repo). Combines the verification layers into a single modifier.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract MyAgentGatedService {
    ISelfAgentRegistry public immutable registry;
    address public immutable selfProvider;

    uint256 public minAge;
    bool public requireOFACCheck;

    error NotVerifiedAgent();
    error WrongProvider();
    error ProofExpired();
    error AgeRequirementNotMet(uint256 agentAge, uint256 required);
    error OFACCheckFailed();

    modifier onlyVerifiedAgent(uint256 agentId) {
        // 1. Check human proof exists and has not expired
        if (!registry.hasHumanProof(agentId)) revert NotVerifiedAgent();
        if (!registry.isProofFresh(agentId)) revert ProofExpired();

        // 2. CRITICAL: Check provider is Self Protocol
        if (registry.getProofProvider(agentId) != selfProvider) revert WrongProvider();

        // 3. Check credential requirements
        ISelfAgentRegistry.AgentCredentials memory creds = registry.getAgentCredentials(agentId);
        if (creds.olderThan < minAge) revert AgeRequirementNotMet(creds.olderThan, minAge);
        if (requireOFACCheck) {
            if (!creds.ofac[0] || !creds.ofac[1] || !creds.ofac[2]) revert OFACCheckFailed();
        }

        _;
    }

    constructor(address _registry, address _selfProvider, uint256 _minAge, bool _requireOFAC) {
        registry = ISelfAgentRegistry(_registry);
        selfProvider = _selfProvider;
        minAge = _minAge;
        requireOFACCheck = _requireOFAC;
    }

    function protectedAction(uint256 agentId) external onlyVerifiedAgent(agentId) {
        // Only verified agents with valid credentials reach this point
        // ...
    }
}
```

### Agent Key Derivation Helper

Convert between agent addresses and agent keys:

```solidity
function addressToAgentKey(address agentAddress) internal pure returns (bytes32) {
    return bytes32(uint256(uint160(agentAddress)));
}

function agentKeyToAddress(bytes32 agentKey) internal pure returns (address) {
    return address(uint160(uint256(agentKey)));
}

// Verify an agent by address (common pattern when receiving agent address as parameter)
function verifyByAddress(address agentAddress) internal view returns (uint256 agentId) {
    bytes32 agentKey = addressToAgentKey(agentAddress);
    require(registry.isVerifiedAgent(agentKey), "Not verified");

    agentId = registry.getAgentId(agentKey);
    require(registry.getProofProvider(agentId) == selfProvider, "Wrong provider");

    return agentId;
}
```

**Important:** Always use `bytes32(uint256(uint160(addr)))` (zero-padded on the left, address in the low-order bytes). Do NOT use `bytes32(bytes20(addr))`, which puts the address in the high-order bytes and produces a different value.

---

## Rate Limiting Patterns

### SDK Rate Limiting

The `SelfAgentVerifier` builder includes built-in rate limiting:

```typescript
const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireSelfProvider()
  .rateLimit({
    perMinute: 100, // Max 100 requests per agent per minute
    perHour: 2_000, // and per hour
  })
  .build();
```

Rate limiting is per agent address. The verifier tracks request counts in memory; `verify()` returns `valid: false` with `retryAfterMs`, and the Express middleware answers 429.

### Rate Limiting by Human Nullifier

For stricter sybil-aware rate limiting, limit by nullifier instead of agent address. This prevents a single human from circumventing rate limits by registering multiple agents:

```typescript
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireSelfProvider()
  .build();

// Custom rate limiter keyed by human nullifier
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_REQUESTS = 100;

// Call after a successful verifier.verify(): result.nullifier identifies the human
function rateLimitByHuman(nullifier: bigint): boolean {
  const key = nullifier.toString();
  const now = Date.now();

  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }

  if (entry.count >= MAX_REQUESTS) {
    return false; // Rate limited
  }

  entry.count++;
  return true;
}
```

### Redis-Based Rate Limiting (Production)

For distributed services, use Redis for shared rate limit state:

```typescript
import Redis from "ioredis";

const redis = new Redis(process.env.REDIS_URL);

async function rateLimitAgent(
  agentAddress: string,
  windowMs: number,
  maxRequests: number,
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const key = `ratelimit:agent:${agentAddress}`;
  const now = Date.now();
  const windowStart = now - windowMs;

  // Remove expired entries and count current window
  await redis.zremrangebyscore(key, 0, windowStart);
  const count = await redis.zcard(key);

  if (count >= maxRequests) {
    const oldestEntry = await redis.zrange(key, 0, 0, "WITHSCORES");
    const resetAt =
      oldestEntry.length >= 2
        ? parseInt(oldestEntry[1]) + windowMs
        : now + windowMs;
    return { allowed: false, remaining: 0, resetAt };
  }

  // Add current request
  await redis.zadd(key, now.toString(), `${now}:${Math.random()}`);
  await redis.pexpire(key, windowMs);

  return {
    allowed: true,
    remaining: maxRequests - count - 1,
    resetAt: now + windowMs,
  };
}
```

---

## Manual Verification Without SDK

For environments where the SDK is not available, perform verification manually using ethers.js (or any EVM JSON-RPC library) and standard ECDSA recovery.

### Signature Verification

```typescript
import { ethers } from "ethers";

const REGISTRY_ABI = [
  "function isVerifiedAgent(bytes32 agentKey) view returns (bool)",
  "function getAgentId(bytes32 agentKey) view returns (uint256)",
  "function getProofProvider(uint256 agentId) view returns (address)",
  "function isProofFresh(uint256 agentId) view returns (bool)",
  "function getAgentCredentials(uint256 agentId) view returns (tuple(string issuingState, string[] name, string idNumber, string nationality, string dateOfBirth, string gender, string expiryDate, uint256 olderThan, bool[3] ofac))",
  "function getHumanNullifier(uint256 agentId) view returns (uint256)",
  "function getAgentCountForHuman(uint256 nullifier) view returns (uint256)",
];

const SELF_PROVIDER_MAINNET = "0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d";
const REGISTRY_MAINNET = "0xaC3DF9ABf80d0F5c020C06B04Cced27763355944";

async function verifyAgentRequest(
  headers: {
    address: string;
    signature: string;
    timestamp: string;
  },
  method: string,
  path: string,
  body: string,
): Promise<{ valid: boolean; agentId?: bigint; error?: string }> {
  // 1. Check timestamp freshness (5-minute window, timestamps are milliseconds)
  const now = Date.now();
  const ts = parseInt(headers.timestamp);
  if (isNaN(ts) || Math.abs(now - ts) > 300_000) {
    return { valid: false, error: "Timestamp expired or invalid" };
  }

  // 2. Reconstruct the signed message (concatenation, no separators).
  //    `path` is path + query; `body` is the raw body exactly as received.
  const bodyHash = ethers.keccak256(ethers.toUtf8Bytes(body || ""));
  const message = headers.timestamp + method.toUpperCase() + path + bodyHash;
  const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));

  // 3. Recover the signer: the agent signs the 32-byte hash with EIP-191 personal_sign
  let recoveredAddress: string;
  try {
    recoveredAddress = ethers.verifyMessage(
      ethers.getBytes(messageHash),
      headers.signature,
    );
  } catch {
    return { valid: false, error: "Invalid signature" };
  }
  // The identity is the recovered signer; the address header is informational.

  // 4. Check on-chain state
  const provider = new ethers.JsonRpcProvider("https://forno.celo.org");
  const registry = new ethers.Contract(
    REGISTRY_MAINNET,
    REGISTRY_ABI,
    provider,
  );

  const agentKey = ethers.zeroPadValue(recoveredAddress, 32);
  const isVerified = await registry.isVerifiedAgent(agentKey);

  if (!isVerified) {
    return { valid: false, error: "Agent not verified on-chain" };
  }

  const agentId = await registry.getAgentId(agentKey);
  if (!(await registry.isProofFresh(agentId))) {
    return { valid: false, error: "Agent's human proof has expired" };
  }
  const proofProvider = await registry.getProofProvider(agentId);

  // CRITICAL: Check provider
  if (proofProvider.toLowerCase() !== SELF_PROVIDER_MAINNET.toLowerCase()) {
    return { valid: false, error: "Proof provider is not Self Protocol" };
  }

  return { valid: true, agentId };
}
```

---

## Verification Checklist

A summary of all checks to consider when building a verification integration. Not all checks are required for every use case — select based on the security requirements of the service.

| #   | Check                           | Required                 | How                                                         |
| --- | ------------------------------- | ------------------------ | ----------------------------------------------------------- |
| 1   | Timestamp freshness             | Yes                      | Reject if > 5 minutes old                                   |
| 2   | Signature validity              | Yes                      | EIP-191 recover; the recovered signer is the identity       |
| 3   | On-chain proof exists and fresh | Yes                      | `isVerifiedAgent(agentKey)` + `isProofFresh(agentId)`       |
| 4   | Provider is Self Protocol       | **Strongly recommended** | `registry.getProofProvider(agentId) == SELF_PROVIDER`       |
| 5   | Provider strength meets minimum | Optional                 | `IHumanProofProvider(provider).verificationStrength() >= N` |
| 6   | Registration block age          | Optional                 | `block.number - agentRegisteredAt(agentId) <= N`            |
| 7   | Age credential meets minimum    | Optional                 | `credentials.olderThan >= N`                                |
| 8   | OFAC screening passed           | Optional                 | `credentials.ofac[0] && ofac[1] && ofac[2]`                 |
| 9   | Sybil limit not exceeded        | Optional                 | `getAgentCountForHuman(nullifier) <= N`                     |
| 10  | Rate limit not exceeded         | Optional                 | Per-agent or per-nullifier rate tracking                    |

Checks 1-3 are the minimum viable verification. Check 4 (provider verification) should always be included in production — omitting it is the most dangerous security gap. Checks 5-10 are policy decisions that depend on the service's requirements.

---

## Common Mistakes

| Mistake                                                 | Impact                                            | Fix                                                         |
| ------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| Not checking proof provider                             | Agents verified by fake providers pass all checks | Always check `getProofProvider(agentId) == SELF_PROVIDER`   |
| Using `bytes32(bytes20(addr))` for agent key            | Wrong key — lookups return no match               | Use `bytes32(uint256(uint160(addr)))`                       |
| Hardcoding testnet addresses in production              | Verification fails on mainnet                     | Use network-aware configuration                             |
| Not validating timestamp                                | Replay attacks within unbounded window            | Reject timestamps older than 5 minutes                      |
| Trusting `x-self-agent-address` without signature check | Header spoofing — anyone claims to be any agent   | Always recover signer from signature                        |
| Ignoring sybil limits                                   | Single human floods service with many agents      | Set `.sybilLimit(n)` in verifier config                     |
| Skipping OFAC check for regulated services              | Compliance violations                             | Add `.requireOFAC()` for any financial or regulated service |
| Not handling verification errors gracefully             | 500 errors when chain RPC is down                 | Wrap on-chain calls in try-catch, return 503 on RPC failure |
