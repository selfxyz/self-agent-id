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
const NETWORK = (process.env.SELF_NETWORK || "mainnet") as
  | "mainnet"
  | "testnet";

// --- Verifier Setup ---

const verifier = SelfAgentVerifier.create()
  .network(NETWORK)
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider() // CRITICAL: always include in production
  .sybilLimit(3)
  .rateLimit({ windowMs: 60_000, maxRequests: 100 })
  .build();

// --- App Setup ---

const app = express();
app.use(express.json());

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
  const agent = req.verifiedAgent;
  res.json({
    agentId: agent.agentId,
    address: agent.address,
    nationality: agent.credentials.nationality,
    olderThan: agent.credentials.olderThan,
    ofacClear: agent.credentials.ofac.every(Boolean),
    agentCount: agent.agentCount,
  });
});

// Data endpoint — agent-authenticated data access
app.post("/api/data", (req: Request, res: Response) => {
  const agent = req.verifiedAgent;
  const { query } = req.body;

  res.json({
    agentId: agent.agentId,
    query,
    result: `Processed query for agent #${agent.agentId}`,
  });
});

// Age-gated endpoint — requires 21+ beyond the base 18+ check
app.post("/api/restricted", (req: Request, res: Response) => {
  const agent = req.verifiedAgent;

  if (agent.credentials.olderThan < 21) {
    res.status(403).json({
      error: "Age requirement not met",
      detail: "This endpoint requires age 21+",
      agentAge: agent.credentials.olderThan,
    });
    return;
  }

  res.json({ message: "Access granted", agentId: agent.agentId });
});

// Sybil-aware endpoint — only one agent per human can claim
app.post("/api/claim-reward", (req: Request, res: Response) => {
  const agent = req.verifiedAgent;

  if (agent.agentCount > 1) {
    res.status(403).json({
      error: "Sybil limit exceeded",
      detail: "Only one agent per human can claim rewards",
      agentCount: agent.agentCount,
    });
    return;
  }

  // Process reward claim...
  res.json({ claimed: true, agentId: agent.agentId });
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
  res.json({ data: "agent-only", agentId: req.verifiedAgent.agentId });
});
```

---

## FastAPI + Python (Full Server)

A production-ready FastAPI server with middleware verification, dependency injection, and background tasks.

```python
import os
from fastapi import FastAPI, Request, HTTPException, Depends, Header, BackgroundTasks
from fastapi.responses import JSONResponse
from self_agent_sdk import SelfAgentVerifier
from typing import Optional

# --- Configuration ---

NETWORK = os.environ.get("SELF_NETWORK", "mainnet")

# --- Verifier Setup ---

verifier = (
    SelfAgentVerifier.create()
    .network(NETWORK)
    .require_age(18)
    .require_ofac()
    .require_self_provider()  # CRITICAL: always include in production
    .sybil_limit(3)
    .rate_limit(window_ms=60_000, max_requests=100)
    .build()
)

# --- App Setup ---

app = FastAPI(title="My Agent Service", version="1.0.0")


# --- Middleware Approach ---

@app.middleware("http")
async def verify_agent_middleware(request: Request, call_next):
    """Verify agent identity for all /api routes."""
    if request.url.path.startswith("/api"):
        address = request.headers.get("x-self-agent-address")
        signature = request.headers.get("x-self-agent-signature")
        timestamp = request.headers.get("x-self-agent-timestamp")

        if not all([address, signature, timestamp]):
            return JSONResponse(
                status_code=401,
                content={"error": "Missing Self Agent authentication headers"},
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
            return JSONResponse(
                status_code=401,
                content={"error": "Agent verification failed", "reason": result.error},
            )

        # Attach verified agent info to request state
        request.state.agent = result

    return await call_next(request)


# --- Dependency Injection Approach (alternative) ---

async def get_verified_agent(
    request: Request,
    x_self_agent_address: str = Header(...),
    x_self_agent_signature: str = Header(...),
    x_self_agent_timestamp: str = Header(...),
):
    """Dependency that verifies agent headers and returns agent info."""
    body = await request.body()
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


# --- Public Routes ---

@app.get("/health")
async def health():
    """Public health check — no agent auth required."""
    return {"status": "ok", "network": NETWORK}


@app.get("/info")
async def info():
    """Public service info."""
    return {
        "name": "My Agent Service",
        "version": "1.0.0",
        "network": NETWORK,
    }


# --- Protected Routes (using middleware) ---

@app.get("/api/profile")
async def get_profile(request: Request):
    """Return verified agent profile."""
    agent = request.state.agent
    return {
        "agent_id": agent.agent_id,
        "address": agent.address,
        "nationality": agent.credentials.nationality,
        "older_than": agent.credentials.older_than,
        "ofac_clear": all(agent.credentials.ofac),
        "agent_count": agent.agent_count,
    }


@app.post("/api/data")
async def process_data(request: Request):
    """Agent-authenticated data processing."""
    agent = request.state.agent
    body = await request.json()

    return {
        "agent_id": agent.agent_id,
        "query": body.get("query"),
        "result": f"Processed for agent #{agent.agent_id}",
    }


@app.post("/api/restricted")
async def restricted_action(request: Request):
    """Age-gated endpoint requiring 21+."""
    agent = request.state.agent

    if agent.credentials.older_than < 21:
        raise HTTPException(
            status_code=403,
            detail=f"Must be 21+ for this endpoint (agent is {agent.credentials.older_than}+)",
        )

    return {"message": "Access granted", "agent_id": agent.agent_id}


@app.post("/api/claim-reward")
async def claim_reward(request: Request):
    """Sybil-aware reward claim — one agent per human."""
    agent = request.state.agent

    if agent.agent_count > 1:
        raise HTTPException(
            status_code=403,
            detail=f"Only one agent per human (found {agent.agent_count})",
        )

    return {"claimed": True, "agent_id": agent.agent_id}


# --- Background Task Example ---

async def log_agent_activity(agent_id: int, action: str):
    """Background task to log agent activity."""
    # In production: write to database, send to analytics, etc.
    print(f"Agent #{agent_id} performed action: {action}")


@app.post("/api/action")
async def perform_action(request: Request, background_tasks: BackgroundTasks):
    """Endpoint with background task for async logging."""
    agent = request.state.agent
    body = await request.json()

    background_tasks.add_task(
        log_agent_activity,
        agent_id=agent.agent_id,
        action=body.get("action", "unknown"),
    )

    return {"status": "accepted", "agent_id": agent.agent_id}
```

---

## Axum + Rust (Full Server)

A production-ready Axum server with Tower middleware, shared state, and protected routes.

```rust
use axum::{
    extract::{Request, State},
    http::StatusCode,
    middleware::{self, Next},
    response::{IntoResponse, Json},
    routing::{get, post},
    Router,
};
use self_agent_sdk::SelfAgentVerifier;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::Arc;

// --- State ---

#[derive(Clone)]
struct AppState {
    verifier: Arc<SelfAgentVerifier>,
    network: String,
}

// --- Middleware ---

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

    // Read body for signature verification
    let body = ""; // For GET requests; POST body extraction requires additional handling

    let result = state
        .verifier
        .verify(address, signature, timestamp, method, path, body)
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
            Json(json!({"error": result.error.unwrap_or_default()})),
        ));
    }

    // Store verified agent info in request extensions
    req.extensions_mut().insert(result);

    Ok(next.run(req).await)
}

// --- Handlers ---

async fn health_handler(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({
        "status": "ok",
        "network": state.network,
    }))
}

async fn profile_handler(req: Request) -> impl IntoResponse {
    let agent = req
        .extensions()
        .get::<self_agent_sdk::VerifyResult>()
        .unwrap();

    Json(json!({
        "agent_id": agent.agent_id,
        "address": agent.address,
        "nationality": agent.credentials.nationality,
        "older_than": agent.credentials.older_than,
    }))
}

async fn data_handler(req: Request) -> impl IntoResponse {
    let agent = req
        .extensions()
        .get::<self_agent_sdk::VerifyResult>()
        .unwrap();

    Json(json!({
        "agent_id": agent.agent_id,
        "result": format!("Processed for agent #{}", agent.agent_id),
    }))
}

async fn restricted_handler(req: Request) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    let agent = req
        .extensions()
        .get::<self_agent_sdk::VerifyResult>()
        .unwrap();

    if agent.credentials.older_than < 21 {
        return Err((
            StatusCode::FORBIDDEN,
            Json(json!({"error": "Must be 21+ for this endpoint"})),
        ));
    }

    Ok(Json(json!({"message": "Access granted", "agent_id": agent.agent_id})))
}

// --- Main ---

#[tokio::main]
async fn main() {
    let network = std::env::var("SELF_NETWORK").unwrap_or_else(|_| "mainnet".to_string());

    let verifier = SelfAgentVerifier::builder()
        .network(&network)
        .require_age(18)
        .require_ofac()
        .require_self_provider() // CRITICAL
        .sybil_limit(3)
        .rate_limit(60_000, 100)
        .build()
        .expect("Failed to build verifier");

    let state = AppState {
        verifier: Arc::new(verifier),
        network: network.clone(),
    };

    // Protected routes with agent verification middleware
    let protected = Router::new()
        .route("/api/profile", get(profile_handler))
        .route("/api/data", post(data_handler))
        .route("/api/restricted", post(restricted_handler))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            verify_agent_middleware,
        ));

    // Full app with public + protected routes
    let app = Router::new()
        .route("/health", get(health_handler))
        .merge(protected)
        .with_state(state);

    println!("Server running on port 3000 (network: {network})");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:3000").await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
```

---

## Hono + TypeScript (Edge Runtime)

Lightweight middleware for Cloudflare Workers, Deno Deploy, or Bun.

```typescript
import { Hono } from "hono";
import { SelfAgentVerifier } from "@selfxyz/agent-sdk";

type Env = {
  SELF_NETWORK: string;
};

type Variables = {
  agent: {
    agentId: number;
    address: string;
    credentials: {
      nationality: string;
      olderThan: number;
      ofac: boolean[];
    };
    agentCount: number;
  };
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// --- Verifier Setup ---

const verifier = SelfAgentVerifier.create()
  .network("mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider() // CRITICAL
  .sybilLimit(3)
  .build();

// --- Agent Auth Middleware ---

const agentAuth = async (c: any, next: any) => {
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
    agentId: agent.agentId,
    address: agent.address,
    nationality: agent.credentials.nationality,
    olderThan: agent.credentials.olderThan,
  });
});

app.post("/api/data", async (c) => {
  const agent = c.get("agent");
  const body = await c.req.json();

  return c.json({
    agentId: agent.agentId,
    query: body.query,
    result: `Processed for agent #${agent.agentId}`,
  });
});

app.post("/api/claim-reward", (c) => {
  const agent = c.get("agent");

  if (agent.agentCount > 1) {
    return c.json({ error: "Only one agent per human can claim" }, 403);
  }

  return c.json({ claimed: true, agentId: agent.agentId });
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
  const address = req.headers.get("x-self-agent-address");
  const signature = req.headers.get("x-self-agent-signature");
  const timestamp = req.headers.get("x-self-agent-timestamp");

  if (!address || !signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing Self Agent authentication headers" },
      { status: 401 },
    );
  }

  const result = await verifier.verify({
    address,
    signature,
    timestamp,
    method: "GET",
    path: "/api/profile",
    body: "",
  });

  if (!result.valid) {
    return NextResponse.json(
      { error: "Agent verification failed", reason: result.error },
      { status: 401 },
    );
  }

  return NextResponse.json({
    agentId: result.agentId,
    address: result.address,
    nationality: result.credentials?.nationality,
    olderThan: result.credentials?.olderThan,
  });
}

export async function POST(req: NextRequest) {
  const address = req.headers.get("x-self-agent-address");
  const signature = req.headers.get("x-self-agent-signature");
  const timestamp = req.headers.get("x-self-agent-timestamp");

  if (!address || !signature || !timestamp) {
    return NextResponse.json(
      { error: "Missing Self Agent authentication headers" },
      { status: 401 },
    );
  }

  const body = await req.text();

  const result = await verifier.verify({
    address,
    signature,
    timestamp,
    method: "POST",
    path: "/api/profile",
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
    agentId: result.agentId,
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
  .network(process.env.SELF_NETWORK || "mainnet")
  .requireAge(18)
  .requireOFAC()
  .requireSelfProvider()
  .sybilLimit(3)
  .build();

export async function verifyAgent(
  req: NextRequest,
  method: string,
  path: string,
): Promise<{ result: VerificationResult } | { error: NextResponse }> {
  const address = req.headers.get("x-self-agent-address");
  const signature = req.headers.get("x-self-agent-signature");
  const timestamp = req.headers.get("x-self-agent-timestamp");

  if (!address || !signature || !timestamp) {
    return {
      error: NextResponse.json(
        { error: "Missing Self Agent authentication headers" },
        { status: 401 },
      ),
    };
  }

  const body = method === "GET" ? "" : await req.text();

  const result = await verifier.verify({
    address,
    signature,
    timestamp,
    method,
    path,
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
  const auth = await verifyAgent(req, "GET", "/api/data");
  if ("error" in auth) return auth.error;

  return NextResponse.json({
    agentId: auth.result.agentId,
    data: "protected content",
  });
}
```

---

## LangChain Agent (Python)

An AI agent that registers itself on startup, signs all outbound API calls, and can verify other agents.

```python
import os
from langchain.agents import AgentExecutor, create_openai_tools_agent
from langchain_openai import ChatOpenAI
from langchain.tools import tool
from self_agent_sdk import SelfAgent, SelfAgentVerifier

# --- Agent Setup ---

agent_sdk = SelfAgent(
    private_key=os.environ["AGENT_PRIVATE_KEY"],
    network=os.environ.get("SELF_NETWORK", "mainnet"),
)

verifier = (
    SelfAgentVerifier.create()
    .network(os.environ.get("SELF_NETWORK", "mainnet"))
    .require_self_provider()
    .build()
)


# --- Self-Registration on Startup ---

async def ensure_registered():
    """Register the agent if not already registered."""
    info = agent_sdk.get_info()
    if info.registered:
        print(f"Agent already registered: ID #{info.agent_id}")
        return

    print("Agent not registered. Starting registration flow...")
    session = agent_sdk.request_registration(minimum_age=18, ofac=True)
    print(f"Scan this QR code with the Self app: {session.qr_url}")

    # Poll for completion
    import time
    while True:
        status = agent_sdk.get_registration_status()
        if status.status == "verified":
            print(f"Registration complete! Agent ID: #{status.agent_id}")
            return
        elif status.status in ("expired", "failed"):
            raise RuntimeError(f"Registration {status.status}")
        time.sleep(5)


# --- LangChain Tools ---

@tool
def authenticated_api_call(url: str, method: str = "GET", body: str = "") -> str:
    """Make an authenticated API call as a verified Self Agent.
    Signs the request with the agent's identity headers.
    """
    response = agent_sdk.fetch(url, method=method, body=body if body else None)
    return f"Status: {response.status_code}\nBody: {response.text[:2000]}"


@tool
def verify_other_agent(agent_address: str) -> str:
    """Verify whether another agent has a valid Self Agent ID.
    Returns verification status, credentials, and reputation.
    """
    # Use the SDK to look up the agent
    info = agent_sdk.get_agent_info(
        chain_id=42220 if os.environ.get("SELF_NETWORK") == "mainnet" else 11142220,
        agent_id=0,  # Will be resolved from address
    )

    if not info.registered:
        return f"Agent {agent_address} is NOT registered."

    return (
        f"Agent {agent_address} is VERIFIED.\n"
        f"Agent ID: #{info.agent_id}\n"
        f"Nationality: {info.credentials.nationality}\n"
        f"Age: {info.credentials.older_than}+\n"
        f"OFAC Clear: {all(info.credentials.ofac)}\n"
        f"Provider: {info.proof_provider}"
    )


@tool
def get_my_identity() -> str:
    """Get this agent's own Self Agent ID identity and credentials."""
    info = agent_sdk.get_info()
    if not info.registered:
        return "This agent is not yet registered."

    return (
        f"Agent ID: #{info.agent_id}\n"
        f"Address: {info.address}\n"
        f"Registered: {info.registered}\n"
        f"Nationality: {info.credentials.nationality}\n"
        f"Age: {info.credentials.older_than}+\n"
        f"OFAC Clear: {all(info.credentials.ofac)}"
    )


# --- Agent Executor ---

llm = ChatOpenAI(model="gpt-4o", temperature=0)

tools = [authenticated_api_call, verify_other_agent, get_my_identity]

# Build and run the agent
# (Prompt template and agent creation omitted for brevity —
#  use standard LangChain agent patterns)
```

---

## Solidity Contract (Full AgentGate)

A complete Solidity contract that uses the registry, reputation provider, and validation provider to gate access.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC8004ProofOfHuman} from "./interfaces/IERC8004ProofOfHuman.sol";

// --- Interfaces ---

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
    function getAgentKey(uint256 agentId) external view returns (bytes32);
    function getAgentCredentials(uint256 agentId) external view returns (AgentCredentials memory);
    function getHumanNullifier(uint256 agentId) external view returns (uint256);
    function getAgentCountForHuman(uint256 nullifier) external view returns (uint256);
    function sameHuman(uint256 agentIdA, uint256 agentIdB) external view returns (bool);
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

// --- AgentGate Contract ---

contract AgentGate {
    ISelfAgentRegistry public immutable registry;
    ISelfReputationProvider public immutable reputation;
    ISelfValidationProvider public immutable validation;
    address public immutable selfProvider;

    uint8 public minReputation;
    uint256 public minAge;
    bool public requireOFACCheck;
    uint256 public maxAgentsPerHuman;

    address public owner;

    // --- Errors ---

    error NotVerifiedAgent();
    error WrongProvider(address actual, address expected);
    error InsufficientReputation(uint8 score, uint8 required);
    error ProofExpired();
    error AgeRequirementNotMet(uint256 agentAge, uint256 required);
    error OFACCheckFailed();
    error SybilLimitExceeded(uint256 agentCount, uint256 maxAllowed);
    error OnlyOwner();

    // --- Events ---

    event AgentAction(uint256 indexed agentId, string action);
    event ConfigUpdated(uint8 minReputation, uint256 minAge, bool requireOFAC, uint256 maxAgents);

    // --- Modifiers ---

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyVerifiedAgent(uint256 agentId) {
        // 1. Check human proof exists
        bytes32 agentKey = registry.getAgentKey(agentId);
        if (!registry.isVerifiedAgent(agentKey)) revert NotVerifiedAgent();

        // 2. CRITICAL: Check provider is Self Protocol
        address provider = registry.getProofProvider(agentId);
        if (provider != selfProvider) revert WrongProvider(provider, selfProvider);

        // 3. Check reputation meets minimum threshold
        if (minReputation > 0) {
            uint8 score = reputation.getReputationScore(agentId);
            if (score < minReputation) revert InsufficientReputation(score, minReputation);
        }

        // 4. Check proof freshness
        if (!validation.isValidAgent(agentId)) revert ProofExpired();

        // 5. Check credential requirements
        ISelfAgentRegistry.AgentCredentials memory creds = registry.getAgentCredentials(agentId);
        if (creds.olderThan < minAge) revert AgeRequirementNotMet(creds.olderThan, minAge);
        if (requireOFACCheck) {
            if (!creds.ofac[0] || !creds.ofac[1] || !creds.ofac[2]) revert OFACCheckFailed();
        }

        // 6. Sybil check
        if (maxAgentsPerHuman > 0) {
            uint256 nullifier = registry.getHumanNullifier(agentId);
            uint256 count = registry.getAgentCountForHuman(nullifier);
            if (count > maxAgentsPerHuman) revert SybilLimitExceeded(count, maxAgentsPerHuman);
        }

        _;
    }

    // --- Constructor ---

    constructor(
        address _registry,
        address _reputation,
        address _validation,
        address _selfProvider,
        uint8 _minReputation,
        uint256 _minAge,
        bool _requireOFAC,
        uint256 _maxAgentsPerHuman
    ) {
        registry = ISelfAgentRegistry(_registry);
        reputation = ISelfReputationProvider(_reputation);
        validation = ISelfValidationProvider(_validation);
        selfProvider = _selfProvider;
        minReputation = _minReputation;
        minAge = _minAge;
        requireOFACCheck = _requireOFAC;
        maxAgentsPerHuman = _maxAgentsPerHuman;
        owner = msg.sender;
    }

    // --- Protected Functions ---

    function protectedAction(uint256 agentId) external onlyVerifiedAgent(agentId) {
        emit AgentAction(agentId, "protectedAction");
        // Application logic here...
    }

    // --- Admin Functions ---

    function updateConfig(
        uint8 _minReputation,
        uint256 _minAge,
        bool _requireOFAC,
        uint256 _maxAgentsPerHuman
    ) external onlyOwner {
        minReputation = _minReputation;
        minAge = _minAge;
        requireOFACCheck = _requireOFAC;
        maxAgentsPerHuman = _maxAgentsPerHuman;
        emit ConfigUpdated(_minReputation, _minAge, _requireOFAC, _maxAgentsPerHuman);
    }

    // --- View Helpers ---

    function addressToAgentKey(address agentAddress) public pure returns (bytes32) {
        return bytes32(uint256(uint160(agentAddress)));
    }

    function agentKeyToAddress(bytes32 agentKey) public pure returns (address) {
        return address(uint160(uint256(agentKey)));
    }

    function verifyByAddress(address agentAddress) external view returns (
        bool verified,
        uint256 agentId,
        uint8 reputationScore,
        bool isFresh
    ) {
        bytes32 agentKey = addressToAgentKey(agentAddress);

        if (!registry.isVerifiedAgent(agentKey)) {
            return (false, 0, 0, false);
        }

        agentId = registry.getAgentId(agentKey);
        address provider = registry.getProofProvider(agentId);

        if (provider != selfProvider) {
            return (false, agentId, 0, false);
        }

        reputationScore = reputation.getReputationScore(agentId);
        isFresh = validation.isValidAgent(agentId);
        verified = true;
    }
}
```

### Deployment with Foundry

```bash
# Compile (requires cancun EVM for Hub V2 PUSH0 opcode)
forge build --evm-version cancun

# Deploy to Celo Mainnet
forge script script/DeployAgentGate.s.sol \
  --rpc-url https://forno.celo.org \
  --broadcast \
  --evm-version cancun

# Verify on Blockscout (no API key needed)
forge verify-contract \
  --chain-id 42220 \
  --verifier blockscout \
  --verifier-url "https://explorer.celo.org/api" \
  <DEPLOYED_ADDRESS> \
  src/AgentGate.sol:AgentGate
```

### Constructor Arguments for Deployment

**Mainnet (Celo, chain 42220):**

| Parameter       | Value                                        |
| --------------- | -------------------------------------------- |
| `_registry`     | `0xaC3DF9ABf80d0F5c020C06B04Cced27763355944` |
| `_reputation`   | (deployed alongside registry)                |
| `_validation`   | (deployed alongside registry)                |
| `_selfProvider` | `0x4b036aFD959B457A208F676cf44Ea3ef73Ea3E3d` |

**Testnet (Celo Sepolia, chain 11142220):**

| Parameter       | Value                                        |
| --------------- | -------------------------------------------- |
| `_registry`     | `0x043DaCac8b0771DD5b444bCC88f2f8BBDBEdd379` |
| `_reputation`   | (deployed alongside registry)                |
| `_validation`   | (deployed alongside registry)                |
| `_selfProvider` | `0x5E61c3051Bf4115F90AacEAE6212bc419f8aBB6c` |

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

- `401 Unauthorized` — Missing headers, invalid signature, unverified agent, wrong provider
- `403 Forbidden` — Credential check failed (age, OFAC, sybil limit)
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

For browser-based agents making cross-origin requests, ensure the 3 Self Agent headers are allowed:

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
    ],
  }),
);
```

```python
# FastAPI
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(
    CORSMiddleware,
    allow_headers=[
        "Content-Type",
        "x-self-agent-address",
        "x-self-agent-signature",
        "x-self-agent-timestamp",
    ],
)
```
