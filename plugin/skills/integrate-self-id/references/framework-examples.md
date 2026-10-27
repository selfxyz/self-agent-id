# Framework Integration Examples

Complete, runnable integration examples for Self Agent ID across multiple frameworks and languages. Each example includes all imports, setup, middleware, routes, and error handling.

---

## Express + TypeScript (Full Server)

A production-ready Express server with `SelfAgentVerifier` middleware, protected routes, public routes, and error handling.

```typescript
import express, { Request, Response, NextFunction } from "express";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

// --- Configuration ---

const PORT = process.env.PORT || 3000;
const NETWORK = process.env.NETWORK === "testnet" ? "testnet" : "mainnet";

// --- Verifier Setup ---

const verifier = SelfAgentVerifier.create()
  .network(NETWORK)
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider() // on by default; keep it in production
  .sybilLimit(3)
  .includeCredentials() // populate req.agent.credentials
  .rateLimit({ perMinute: 100 })
  .build();

// --- App Setup ---

const app = express();
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: Buffer }).rawBody = buf; // auth() verifies the exact bytes
    },
  }),
);

// --- Public Routes (no agent auth) ---

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", network: NETWORK });
});

app.get("/info", (_req: Request, res: Response) => {
  res.json({
    name: "My Agent Service",
    version: "1.0.0",
    network: NETWORK,
    verification: {
      requireAge: 18,
      requireOFAC: true,
      requireSelfProvider: true,
      sybilLimit: 3,
    },
  });
});

// --- Agent-Protected Routes ---

// Apply verifier middleware to all /api routes
app.use("/api", verifier.auth());

// Basic profile — return the verified agent's identity
app.get("/api/profile", (req: Request, res: Response) => {
  const agent = req.agent!; // set by verifier.auth()
  res.json({
    agentId: agent.agentId.toString(), // bigint
    address: agent.address,
    nationality: agent.credentials?.nationality,
    olderThan: Number(agent.credentials?.olderThan ?? 0),
    ofacClear: agent.credentials?.ofac.every(Boolean),
    agentCount: agent.agentCount.toString(),
  });
});

// Data endpoint — agent-authenticated data access
app.post("/api/data", (req: Request, res: Response) => {
  const agent = req.agent!; // set by verifier.auth()
  const { query } = req.body;

  res.json({
    agentId: agent.agentId.toString(),
    query,
    result: `Processed query for agent #${agent.agentId}`,
  });
});

// Age-gated endpoint — requires 21+ beyond the base 18+ check
app.post("/api/restricted", (req: Request, res: Response) => {
  const agent = req.agent!; // set by verifier.auth()

  const olderThan = Number(agent.credentials?.olderThan ?? 0);
  if (olderThan < 21) {
    res.status(403).json({
      error: "Age requirement not met",
      detail: "This endpoint requires age 21+",
      agentAge: olderThan,
    });
    return;
  }

  res.json({ message: "Access granted", agentId: agent.agentId.toString() });
});

// Sybil-aware endpoint — only one agent per human can claim
app.post("/api/claim-reward", (req: Request, res: Response) => {
  const agent = req.agent!; // set by verifier.auth()

  if (agent.agentCount > 1n) {
    res.status(403).json({
      error: "Sybil limit exceeded",
      detail: "Only one agent per human can claim rewards",
      agentCount: agent.agentCount.toString(),
    });
    return;
  }

  // Process reward claim...
  res.json({ claimed: true, agentId: agent.agentId.toString() });
});

// --- Error Handling ---

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// --- Start ---

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (network: ${NETWORK})`);
});
```

### Selective Route Protection

To protect only specific routes instead of all `/api` routes:

```typescript
const agentAuth = verifier.auth();

// Public API route — no auth
app.get("/api/public", (_req, res) => {
  res.json({ data: "publicly accessible" });
});

// Protected API route — requires agent auth
app.get("/api/private", agentAuth, (req, res) => {
  res.json({ data: "agent-only", agentId: req.agent!.agentId.toString() });
});
```

---

## Hono + TypeScript (Edge Runtime)

Lightweight middleware for Cloudflare Workers, Deno Deploy, or Bun.

```typescript
import { Hono } from "hono";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

import type { VerificationResult } from "@selfxyz/agent-sdk";

type Variables = { agent: VerificationResult };

const app = new Hono<{ Variables: Variables }>();

// --- Verifier Setup ---

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider()
  .sybilLimit(3)
  .includeCredentials()
  .build();

// --- Agent Auth Middleware ---

const agentAuth = async (c: any, next: any) => {
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
    url: c.req.url, // full URL; path + query is what gets signed
    body: body || undefined,
  });

  if (!result.valid) {
    return c.json(
      { error: "Agent verification failed", reason: result.error },
      401,
    );
  }

  c.set("agent", result);
  await next();
};

// --- Public Routes ---

app.get("/health", (c) => c.json({ status: "ok" }));

app.get("/info", (c) =>
  c.json({
    name: "Edge Agent Service",
    runtime: "Cloudflare Workers",
  }),
);

// --- Protected Routes ---

app.use("/api/*", agentAuth);

app.get("/api/profile", (c) => {
  const agent = c.get("agent");
  return c.json({
    agentId: agent.agentId.toString(),
    address: agent.agentAddress,
    nationality: agent.credentials?.nationality,
    olderThan: Number(agent.credentials?.olderThan ?? 0),
  });
});

app.post("/api/data", async (c) => {
  const agent = c.get("agent");
  const body = await c.req.json();

  return c.json({
    agentId: agent.agentId.toString(),
    query: body.query,
    result: `Processed for agent #${agent.agentId}`,
  });
});

app.post("/api/claim-reward", (c) => {
  const agent = c.get("agent");

  if (agent.agentCount > 1n) {
    return c.json({ error: "Only one agent per human can claim" }, 403);
  }

  return c.json({ claimed: true, agentId: agent.agentId.toString() });
});

export default app;
```

---

## Next.js API Routes

Integration with Next.js App Router route handlers (TypeScript).

### Route Handler with Manual Verification

```typescript
// app/api/profile/route.ts
import { NextRequest, NextResponse } from "next/server";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider()
  .sybilLimit(3)
  .build();

export async function GET(req: NextRequest) {
  const signature = req.headers.get("x-self-agent-signature");
  const timestamp = req.headers.get("x-self-agent-timestamp");

  if (!signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing Self Agent authentication headers" },
      { status: 401 },
    );
  }

  const result = await verifier.verify({
    signature,
    timestamp,
    method: "GET",
    url: req.url,
  });

  if (!result.valid) {
    return NextResponse.json(
      { error: "Agent verification failed", reason: result.error },
      { status: 401 },
    );
  }

  return NextResponse.json({
    agentId: result.agentId.toString(),
    address: result.agentAddress,
    nationality: result.credentials?.nationality,
    olderThan: Number(result.credentials?.olderThan ?? 0),
  });
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get("x-self-agent-signature");
  const timestamp = req.headers.get("x-self-agent-timestamp");

  if (!signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing Self Agent authentication headers" },
      { status: 401 },
    );
  }

  const body = await req.text();

  const result = await verifier.verify({
    signature,
    timestamp,
    method: "POST",
    url: req.url,
    body,
  });

  if (!result.valid) {
    return NextResponse.json(
      { error: "Agent verification failed", reason: result.error },
      { status: 401 },
    );
  }

  const data = JSON.parse(body);

  return NextResponse.json({
    agentId: result.agentId.toString(),
    processed: true,
    query: data.query,
  });
}
```

### Reusable Verification Helper

Extract common verification logic into a helper:

```typescript
// lib/agent-auth.ts
import { NextRequest, NextResponse } from "next/server";
import { SelfAgentVerifier, VerificationResult } from "@selfxyz/agent-sdk";

const verifier = SelfAgentVerifier.create()
  .network(process.env.NETWORK === "testnet" ? "testnet" : "mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider()
  .sybilLimit(3)
  .build();

export async function verifyAgent(
  req: NextRequest,
): Promise<{ result: VerificationResult } | { error: NextResponse }> {
  const method = req.method;
  const path = req.nextUrl.pathname + req.nextUrl.search;
  const signature = req.headers.get("x-self-agent-signature");
  const timestamp = req.headers.get("x-self-agent-timestamp");

  if (!signature || !timestamp) {
    return {
      error: NextResponse.json(
        { error: "Missing Self Agent authentication headers" },
        { status: 401 },
      ),
    };
  }

  const body = method === "GET" ? undefined : await req.text();

  const result = await verifier.verify({
    signature,
    timestamp,
    method,
    url: path,
    body,
  });

  if (!result.valid) {
    return {
      error: NextResponse.json(
        { error: "Agent verification failed", reason: result.error },
        { status: 401 },
      ),
    };
  }

  return { result };
}
```

Usage in route handlers:

```typescript
// app/api/data/route.ts
import { NextRequest, NextResponse } from "next/server";
import { verifyAgent } from "@/lib/agent-auth";

export async function GET(req: NextRequest) {
  const auth = await verifyAgent(req);
  if ("error" in auth) return auth.error;

  return NextResponse.json({
    agentId: auth.result.agentId.toString(),
    data: "protected content",
  });
}
```

---

## Solidity Contract (Your Own Gated Service)

A complete contract you write and deploy yourself to gate access on registry state. `MyAgentGatedService` is illustrative — it is not a contract in this repo.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// --- Minimal registry interface (functions exist on SelfAgentRegistry) ---

interface ISelfAgentRegistry {
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

    function hasHumanProof(uint256 agentId) external view returns (bool);
    function isProofFresh(uint256 agentId) external view returns (bool);
    function getProofProvider(uint256 agentId) external view returns (address);
    function isVerifiedAgent(bytes32 agentKey) external view returns (bool);
    function getAgentId(bytes32 agentKey) external view returns (uint256);
    function getAgentCredentials(uint256 agentId) external view returns (AgentCredentials memory);
    function getHumanNullifier(uint256 agentId) external view returns (uint256);
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
}

contract MyAgentGatedService {
    ISelfAgentRegistry public immutable registry;
    address public immutable selfProvider;

    uint256 public minAge;
    bool public requireOFACCheck;
    uint256 public maxAgentsPerHuman;

    address public owner;

    // --- Errors ---

    error NotVerifiedAgent();
    error ProofExpired();
    error WrongProvider(address actual, address expected);
    error AgeRequirementNotMet(uint256 agentAge, uint256 required);
    error OFACCheckFailed();
    error SybilLimitExceeded(uint256 agentCount, uint256 maxAllowed);
    error OnlyOwner();

    // --- Events ---

    event AgentAction(uint256 indexed agentId, string action);
    event ConfigUpdated(uint256 minAge, bool requireOFAC, uint256 maxAgents);

    // --- Modifiers ---

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyVerifiedAgent(uint256 agentId) {
        // 1. Human proof exists and has not expired
        if (!registry.hasHumanProof(agentId)) revert NotVerifiedAgent();
        if (!registry.isProofFresh(agentId)) revert ProofExpired();

        // 2. CRITICAL: provider is Self Protocol
        address provider = registry.getProofProvider(agentId);
        if (provider != selfProvider) revert WrongProvider(provider, selfProvider);

        // 3. Credential requirements
        ISelfAgentRegistry.AgentCredentials memory creds = registry.getAgentCredentials(agentId);
        if (creds.olderThan < minAge) revert AgeRequirementNotMet(creds.olderThan, minAge);
        if (requireOFACCheck) {
            if (!creds.ofac[0] || !creds.ofac[1] || !creds.ofac[2]) revert OFACCheckFailed();
        }

        // 4. Sybil check
        if (maxAgentsPerHuman > 0) {
            uint256 count = registry.getAgentCountForHuman(registry.getHumanNullifier(agentId));
            if (count > maxAgentsPerHuman) revert SybilLimitExceeded(count, maxAgentsPerHuman);
        }

        _;
    }

    constructor(
        address _registry,
        address _selfProvider,
        uint256 _minAge,
        bool _requireOFAC,
        uint256 _maxAgentsPerHuman
    ) {
        registry = ISelfAgentRegistry(_registry);
        selfProvider = _selfProvider;
        minAge = _minAge;
        requireOFACCheck = _requireOFAC;
        maxAgentsPerHuman = _maxAgentsPerHuman;
        owner = msg.sender;
    }

    function protectedAction(uint256 agentId) external onlyVerifiedAgent(agentId) {
        emit AgentAction(agentId, "protectedAction");
        // Application logic here...
    }

    function updateConfig(uint256 _minAge, bool _requireOFAC, uint256 _maxAgentsPerHuman) external onlyOwner {
        minAge = _minAge;
        requireOFACCheck = _requireOFAC;
        maxAgentsPerHuman = _maxAgentsPerHuman;
        emit ConfigUpdated(_minAge, _requireOFAC, _maxAgentsPerHuman);
    }

    /// @notice Resolve an agent address; verified = fresh Self proof
    function verifyByAddress(address agentAddress) external view returns (bool verified, uint256 agentId) {
        bytes32 agentKey = bytes32(uint256(uint160(agentAddress)));
        if (!registry.isVerifiedAgent(agentKey)) return (false, 0);
        agentId = registry.getAgentId(agentKey);
        verified = registry.isProofFresh(agentId) && registry.getProofProvider(agentId) == selfProvider;
    }
}
```

### Deployment with Foundry

From your own Foundry project (paths below are yours):

```bash
forge build

# Deploy to Celo Mainnet
forge create src/MyAgentGatedService.sol:MyAgentGatedService \
  --rpc-url https://forno.celo.org \
  --private-key $PRIVATE_KEY \
  --broadcast \
  --constructor-args <REGISTRY> <SELF_PROVIDER> 18 true 1

# Verify on Blockscout (no API key needed)
forge verify-contract \
  --chain-id 42220 \
  --verifier blockscout \
  --verifier-url "https://explorer.celo.org/api" \
  <DEPLOYED_ADDRESS> \
  src/MyAgentGatedService.sol:MyAgentGatedService
```

### Constructor Addresses

| Parameter       | Mainnet (42220)                              | Testnet (11142220)                           |
| --------------- | -------------------------------------------- | -------------------------------------------- |
| `_registry`     | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| `_selfProvider` | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |

---

## Common Patterns Across All Frameworks

### Error Response Format

All frameworks should return consistent error responses for verification failures:

```json
{
  "error": "Agent verification failed",
  "reason": "Proof provider is not Self Protocol"
}
```

Standard HTTP status codes:

- `401 Unauthorized` — Missing headers, invalid signature, unverified or expired agent, wrong provider. The SDK middlewares also use 401 for failed age / OFAC / sybil checks.
- `403 Forbidden` — Your own route-level policy checks (e.g. a stricter age gate inside a handler)
- `429 Too Many Requests` — Rate limit exceeded
- `503 Service Unavailable` — RPC or chain connectivity issues

### RPC Error Handling

Wrap all on-chain calls in error handling. The Celo RPC can occasionally be slow or unavailable:

```typescript
// TypeScript
try {
  const result = await verifier.verify(/* ... */);
  // handle result
} catch (err) {
  if (err.message.includes("TIMEOUT") || err.message.includes("ECONNREFUSED")) {
    return res.status(503).json({
      error: "Verification service temporarily unavailable",
      detail: "On-chain verification could not be completed. Try again.",
    });
  }
  throw err;
}
```

### CORS Configuration

For browser-based agents making cross-origin requests, ensure the Self Agent headers are allowed (`x-self-agent-key` and `x-self-agent-keytype` are sent by Ed25519 agents):

```typescript
// Express
import cors from "cors";
app.use(
  cors({
    allowedHeaders: [
      "Content-Type",
      "x-self-agent-address",
      "x-self-agent-signature",
      "x-self-agent-timestamp",
      "x-self-agent-key",
      "x-self-agent-keytype",
    ],
  }),
);
```
