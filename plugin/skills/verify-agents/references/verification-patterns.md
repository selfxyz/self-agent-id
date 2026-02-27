# Verification Patterns — Detailed Reference

This document provides complete, production-ready code patterns for verifying Self Agent ID identities across multiple frameworks, languages, and environments. Each pattern demonstrates the full verification pipeline including the critical provider check.

---

## Contract Addresses

Reference these addresses throughout all verification code:

| Contract               | Mainnet (42220)                              | Testnet (11142220)                           |
| ---------------------- | -------------------------------------------- | -------------------------------------------- |
| SelfAgentRegistry      | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| SelfHumanProofProvider | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |
| AgentGate              | `0x26e05bF632fb5bACB665ab014240EAC1413dAE35` | `0x86Af07e30Aa42367cbcA7f2B1764Be346598bbc2` |
| Hub V2                 | `0xe57F4773bd9c9d8b6Cd70431117d353298B9f5BF` | `0x16ECBA51e18a4a7e61fdC417f0d47AFEeDfbed74` |

---

## Express Middleware (TypeScript)

The most common integration pattern for Node.js services. Uses the `@selfxyz/agent-sdk` package with Express.

### Full Example

```typescript
import express from "express";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const app = express();
app.use(express.json());

// Build the verifier with all desired checks
const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider() // CRITICAL: always include in production
  .sybilLimit(3)
  .rateLimit({ windowMs: 60_000, maxRequests: 100 })
  .build();

// Protect all /api routes — unverified requests get 401
app.use("/api", verifier.auth());

// Public routes remain accessible without agent auth
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Access verified agent info in protected routes
app.get("/api/profile", (req, res) => {
  const agent = req.verifiedAgent;
  // agent: { agentId, address, credentials, agentCount }
  res.json({
    agentId: agent.agentId,
    nationality: agent.credentials.nationality,
    olderThan: agent.credentials.olderThan,
    ofacClear: agent.credentials.ofac.every(Boolean),
    agentCount: agent.agentCount,
  });
});

// Example: age-gated endpoint with additional credential checks
app.post("/api/restricted", (req, res) => {
  const agent = req.verifiedAgent;

  // Additional application-level checks beyond the verifier config
  if (agent.credentials.olderThan < 21) {
    return res.status(403).json({ error: "Must be 21+ for this endpoint" });
  }

  res.json({ message: "Access granted", agentId: agent.agentId });
});

// Example: sybil-aware endpoint
app.post("/api/claim-reward", (req, res) => {
  const agent = req.verifiedAgent;

  if (agent.agentCount > 1) {
    return res.status(403).json({
      error: "Only one agent per human can claim rewards",
      agentCount: agent.agentCount,
    });
  }

  // Process reward claim...
  res.json({ claimed: true, agentId: agent.agentId });
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
  res.json({ data: "agent-only", agentId: req.verifiedAgent.agentId });
});
```

### Error Handling

The middleware returns a 401 response with a JSON body when verification fails:

```json
{
  "error": "Agent verification failed",
  "reason": "Proof provider is not Self Protocol"
}
```

Possible rejection reasons:

- `"Missing x-self-agent-address header"`
- `"Missing x-self-agent-signature header"`
- `"Missing x-self-agent-timestamp header"`
- `"Timestamp expired (older than 300 seconds)"`
- `"Signature does not match claimed address"`
- `"Agent is not verified on-chain"`
- `"Proof provider is not Self Protocol"`
- `"Age requirement not met (requires 18+)"`
- `"OFAC screening not passed"`
- `"Sybil limit exceeded (max 3 agents per human)"`
- `"Rate limit exceeded"`

---

## FastAPI Middleware (Python)

Python integration using FastAPI and the `selfxyz-agent-sdk` package.

### Full Example

```python
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from self_agent_sdk import SelfAgentVerifier

app = FastAPI()

# Build the verifier
verifier = (
    SelfAgentVerifier.create()
    .network("mainnet")
    .require_age(18)
    .require_ofac()
    .require_self_provider()  # CRITICAL: always include in production
    .sybil_limit(3)
    .rate_limit(window_ms=60_000, max_requests=100)
    .build()
)


@app.middleware("http")
async def verify_agent(request: Request, call_next):
    """Verify agent identity for all /api routes."""
    if request.url.path.startswith("/api"):
        address = request.headers.get("x-self-agent-address")
        signature = request.headers.get("x-self-agent-signature")
        timestamp = request.headers.get("x-self-agent-timestamp")

        if not all([address, signature, timestamp]):
            raise HTTPException(
                status_code=401,
                detail="Missing Self Agent authentication headers",
            )

        body = await request.body()

        result = await verifier.verify(
            address=address,
            signature=signature,
            timestamp=timestamp,
            method=request.method,
            path=request.url.path,
            body=body.decode("utf-8") if body else "",
        )

        if not result.valid:
            raise HTTPException(status_code=401, detail=result.error)

        # Attach verified agent info to request state
        request.state.agent = result

    return await call_next(request)


@app.get("/health")
async def health():
    """Public health check — no agent auth required."""
    return {"status": "ok"}


@app.get("/api/profile")
async def get_profile(request: Request):
    """Return verified agent profile."""
    agent = request.state.agent
    return {
        "agent_id": agent.agent_id,
        "nationality": agent.credentials.nationality,
        "older_than": agent.credentials.older_than,
        "ofac_clear": all(agent.credentials.ofac),
        "agent_count": agent.agent_count,
    }


@app.post("/api/restricted")
async def restricted_action(request: Request):
    """Age-gated endpoint requiring 21+."""
    agent = request.state.agent

    if agent.credentials.older_than < 21:
        raise HTTPException(status_code=403, detail="Must be 21+ for this endpoint")

    return {"message": "Access granted", "agent_id": agent.agent_id}
```

### Dependency Injection Pattern

An alternative to middleware — use FastAPI's dependency injection for per-route control:

```python
from fastapi import Depends, Header


async def get_verified_agent(
    x_self_agent_address: str = Header(...),
    x_self_agent_signature: str = Header(...),
    x_self_agent_timestamp: str = Header(...),
    request: Request = None,
):
    body = await request.body() if request else b""
    result = await verifier.verify(
        address=x_self_agent_address,
        signature=x_self_agent_signature,
        timestamp=x_self_agent_timestamp,
        method=request.method,
        path=request.url.path,
        body=body.decode("utf-8") if body else "",
    )
    if not result.valid:
        raise HTTPException(status_code=401, detail=result.error)
    return result


@app.get("/api/data")
async def get_data(agent=Depends(get_verified_agent)):
    return {"agent_id": agent.agent_id, "data": "protected"}
```

---

## Axum Middleware (Rust)

Rust integration using Axum with Tower layers and the `self-agent-sdk` crate.

### Full Example

```rust
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Json},
    routing::get,
    Router,
};
use self_agent_sdk::SelfAgentVerifier;
use serde_json::json;
use std::sync::Arc;

#[derive(Clone)]
struct AppState {
    verifier: Arc<SelfAgentVerifier>,
}

async fn verify_agent_middleware(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let headers = req.headers();

    let address = headers
        .get("x-self-agent-address")
        .and_then(|v| v.to_str().ok())
        .ok_or((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Missing x-self-agent-address header"})),
        ))?;

    let signature = headers
        .get("x-self-agent-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Missing x-self-agent-signature header"})),
        ))?;

    let timestamp = headers
        .get("x-self-agent-timestamp")
        .and_then(|v| v.to_str().ok())
        .ok_or((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": "Missing x-self-agent-timestamp header"})),
        ))?;

    let method = req.method().as_str();
    let path = req.uri().path();

    let result = state
        .verifier
        .verify(address, signature, timestamp, method, path, "")
        .await
        .map_err(|e| {
            (
                StatusCode::UNAUTHORIZED,
                Json(json!({"error": e.to_string()})),
            )
        })?;

    if !result.valid {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error": result.error})),
        ));
    }

    // Store verified agent info in request extensions
    req.extensions_mut().insert(result);

    Ok(next.run(req).await)
}

async fn profile_handler(req: Request) -> impl IntoResponse {
    let agent = req
        .extensions()
        .get::<self_agent_sdk::VerifyResult>()
        .unwrap();

    Json(json!({
        "agent_id": agent.agent_id,
        "nationality": agent.credentials.nationality,
    }))
}

#[tokio::main]
async fn main() {
    let verifier = SelfAgentVerifier::builder()
        .network("mainnet")
        .require_age(18)
        .require_ofac()
        .require_self_provider() // CRITICAL
        .sybil_limit(3)
        .build()
        .expect("Failed to build verifier");

    let state = AppState {
        verifier: Arc::new(verifier),
    };

    let protected = Router::new()
        .route("/api/profile", get(profile_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            verify_agent_middleware,
        ));

    let app = Router::new()
        .route("/health", get(|| async { Json(json!({"status": "ok"})) }))
        .merge(protected)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

---

## Hono Middleware (TypeScript)

Lightweight middleware pattern for Hono (Cloudflare Workers, Deno, Bun, Node.js).

### Full Example

```typescript
import { Hono } from "hono";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const app = new Hono();

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider()
  .sybilLimit(3)
  .build();

// Agent verification middleware
const agentAuth = async (c, next) => {
  const address = c.req.header("x-self-agent-address");
  const signature = c.req.header("x-self-agent-signature");
  const timestamp = c.req.header("x-self-agent-timestamp");

  if (!address || !signature || !timestamp) {
    return c.json({ error: "Missing Self Agent authentication headers" }, 401);
  }

  const body = await c.req.text();

  const result = await verifier.verify({
    address,
    signature,
    timestamp,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    body: body || "",
  });

  if (!result.valid) {
    return c.json({ error: result.error }, 401);
  }

  // Store agent info in context
  c.set("agent", result);
  await next();
};

// Public route
app.get("/health", (c) => c.json({ status: "ok" }));

// Protected routes
app.use("/api/*", agentAuth);

app.get("/api/profile", (c) => {
  const agent = c.get("agent");
  return c.json({
    agentId: agent.agentId,
    nationality: agent.credentials.nationality,
    olderThan: agent.credentials.olderThan,
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

interface ISelfReputationProvider {
    function getReputationScore(uint256 agentId) external view returns (uint8);
    function getReputation(uint256 agentId) external view returns (
        uint8 score, string memory providerName, bool hasProof, uint256 registeredAtBlock
    );
    function getReputationBatch(uint256[] calldata agentIds) external view returns (uint8[] memory);
}

interface ISelfValidationProvider {
    function isValidAgent(uint256 agentId) external view returns (bool);
    function validateAgent(uint256 agentId) external view returns (
        bool valid, bool fresh, uint256 registeredAt, uint256 blockAge, address proofProvider
    );
}
```

### Basic Humanity Check

The simplest on-chain verification — confirm an agent has a human proof.

```solidity
IERC8004ProofOfHuman registry = IERC8004ProofOfHuman(REGISTRY_ADDRESS);

function requireHuman(uint256 agentId) internal view {
    require(registry.hasHumanProof(agentId), "Not human-verified");
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

Without this check, an attacker could deploy a malicious `IHumanProofProvider` that always returns `true` and `verificationStrength = 100`, register agents through it, and those agents would pass `hasHumanProof()` and `getReputationScore()` checks. The provider check is the only defense against this attack.

### Reputation Gating

Gate access based on the proof provider's verification strength.

```solidity
ISelfReputationProvider reputation = ISelfReputationProvider(REPUTATION_ADDRESS);

function requireReputation(uint256 agentId, uint8 minScore) internal view {
    uint8 score = reputation.getReputationScore(agentId);
    require(score >= minScore, "Insufficient reputation score");
}

// Usage: require reputation >= 80 (rejects video-liveness providers)
requireReputation(agentId, 80);
```

### Freshness Validation

Ensure the agent's proof has not expired.

```solidity
ISelfValidationProvider validation = ISelfValidationProvider(VALIDATION_ADDRESS);

function requireFresh(uint256 agentId) internal view {
    require(validation.isValidAgent(agentId), "Proof expired or invalid");
}

// For more details:
function checkFreshness(uint256 agentId) internal view returns (bool valid, uint256 blockAge) {
    (bool _valid, bool fresh, , uint256 _blockAge, ) = validation.validateAgent(agentId);
    return (_valid && fresh, _blockAge);
}
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

### Combined Check — AgentGate Pattern

The recommended pattern for production contracts. Combines all verification layers into a single modifier.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract AgentGatedService {
    ISelfAgentRegistry public immutable registry;
    ISelfReputationProvider public immutable reputation;
    ISelfValidationProvider public immutable validation;
    address public immutable selfProvider;

    uint8 public minReputation;
    uint256 public minAge;
    bool public requireOFACCheck;

    error NotVerifiedAgent();
    error WrongProvider();
    error InsufficientReputation(uint8 score, uint8 required);
    error ProofExpired();
    error AgeRequirementNotMet(uint256 agentAge, uint256 required);
    error OFACCheckFailed();

    modifier onlyVerifiedAgent(uint256 agentId) {
        // 1. Check human proof exists
        if (!registry.hasHumanProof(agentId)) revert NotVerifiedAgent();

        // 2. CRITICAL: Check provider is Self Protocol
        if (registry.getProofProvider(agentId) != selfProvider) revert WrongProvider();

        // 3. Check reputation meets minimum threshold
        uint8 score = reputation.getReputationScore(agentId);
        if (score < minReputation) revert InsufficientReputation(score, minReputation);

        // 4. Check proof freshness
        if (!validation.isValidAgent(agentId)) revert ProofExpired();

        // 5. Check credential requirements
        ISelfAgentRegistry.AgentCredentials memory creds = registry.getAgentCredentials(agentId);
        if (creds.olderThan < minAge) revert AgeRequirementNotMet(creds.olderThan, minAge);
        if (requireOFACCheck) {
            if (!creds.ofac[0] || !creds.ofac[1] || !creds.ofac[2]) revert OFACCheckFailed();
        }

        _;
    }

    constructor(
        address _registry,
        address _reputation,
        address _validation,
        address _selfProvider,
        uint8 _minReputation,
        uint256 _minAge,
        bool _requireOFAC
    ) {
        registry = ISelfAgentRegistry(_registry);
        reputation = ISelfReputationProvider(_reputation);
        validation = ISelfValidationProvider(_validation);
        selfProvider = _selfProvider;
        minReputation = _minReputation;
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

**Important:** Always use `bytes32(uint256(uint160(addr)))` for the conversion (address in low-order bytes). Do NOT use `bytes32(bytes20(addr))` which left-pads and produces a different value. The registry uses the right-padded form consistently.

---

## Rate Limiting Patterns

### SDK Rate Limiting

The `SelfAgentVerifier` builder includes built-in rate limiting:

```typescript
const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireSelfProvider()
  .rateLimit({
    windowMs: 60_000, // 1-minute window
    maxRequests: 100, // Max 100 requests per agent per window
  })
  .build();
```

Rate limiting is per agent address by default. The verifier tracks request counts in memory and rejects excess requests with a 429 status.

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

async function rateLimitByHuman(agentId: number): Promise<boolean> {
  // Get the human nullifier for this agent
  const nullifier = await verifier.getHumanNullifier(agentId);
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
): Promise<{ valid: boolean; agentId?: number; error?: string }> {
  // 1. Check timestamp freshness (5-minute window, timestamps are milliseconds)
  const now = Date.now();
  const ts = parseInt(headers.timestamp);
  if (isNaN(ts) || Math.abs(now - ts) > 300_000) {
    return { valid: false, error: "Timestamp expired or invalid" };
  }

  // 2. Reconstruct the signed message (concatenation, no separators)
  const bodyHash = ethers.keccak256(ethers.toUtf8Bytes(body || ""));
  const message = headers.timestamp + method.toUpperCase() + path + bodyHash;
  const messageHash = ethers.keccak256(ethers.toUtf8Bytes(message));

  // 3. Recover signer from signature
  const recoveredAddress = ethers.recoverAddress(
    messageHash,
    headers.signature,
  );

  if (recoveredAddress.toLowerCase() !== headers.address.toLowerCase()) {
    return { valid: false, error: "Signature does not match claimed address" };
  }

  // 4. Check on-chain state
  const provider = new ethers.JsonRpcProvider("https://forno.celo.org");
  const registry = new ethers.Contract(
    REGISTRY_MAINNET,
    REGISTRY_ABI,
    provider,
  );

  const agentKey = ethers.zeroPadValue(headers.address, 32);
  const isVerified = await registry.isVerifiedAgent(agentKey);

  if (!isVerified) {
    return { valid: false, error: "Agent not verified on-chain" };
  }

  const agentId = await registry.getAgentId(agentKey);
  const proofProvider = await registry.getProofProvider(agentId);

  // CRITICAL: Check provider
  if (proofProvider.toLowerCase() !== SELF_PROVIDER_MAINNET.toLowerCase()) {
    return { valid: false, error: "Proof provider is not Self Protocol" };
  }

  return { valid: true, agentId: Number(agentId) };
}
```

---

## Verification Checklist

A summary of all checks to consider when building a verification integration. Not all checks are required for every use case — select based on the security requirements of the service.

| #   | Check                            | Required                 | How                                                   |
| --- | -------------------------------- | ------------------------ | ----------------------------------------------------- |
| 1   | Timestamp freshness              | Yes                      | Reject if > 5 minutes old                             |
| 2   | Signature validity               | Yes                      | ECDSA recover, compare to claimed address             |
| 3   | On-chain proof exists            | Yes                      | `registry.isVerifiedAgent(agentKey)`                  |
| 4   | Provider is Self Protocol        | **Strongly recommended** | `registry.getProofProvider(agentId) == SELF_PROVIDER` |
| 5   | Reputation score meets threshold | Optional                 | `reputation.getReputationScore(agentId) >= N`         |
| 6   | Proof is fresh                   | Optional                 | `validation.isValidAgent(agentId)`                    |
| 7   | Age credential meets minimum     | Optional                 | `credentials.olderThan >= N`                          |
| 8   | OFAC screening passed            | Optional                 | `credentials.ofac[0] && ofac[1] && ofac[2]`           |
| 9   | Sybil limit not exceeded         | Optional                 | `getAgentCountForHuman(nullifier) <= N`               |
| 10  | Rate limit not exceeded          | Optional                 | Per-agent or per-nullifier rate tracking              |

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
