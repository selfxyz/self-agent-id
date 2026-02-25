# Signed Fetch Examples

Complete runnable examples for signing HTTP requests with Self Agent ID authentication headers. Each example sends a signed POST request to a protected API endpoint, then handles the response.

## TypeScript (Express Client)

A full client that sends signed requests to a protected API, with error handling and retry logic.

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

// ─── Configuration ──────────────────────────────────────────────────────────

const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
if (!AGENT_PRIVATE_KEY) {
  throw new Error("AGENT_PRIVATE_KEY environment variable is required");
}

const API_BASE = "https://api.example.com";

// ─── Agent Initialization ───────────────────────────────────────────────────

const agent = new SelfAgent({
  privateKey: AGENT_PRIVATE_KEY,
  network: "mainnet", // or "testnet" for Celo Sepolia
});

console.log("Agent address:", agent.address);
console.log("Agent key:", agent.agentKey);

// ─── Signed GET Request ─────────────────────────────────────────────────────

async function fetchProtectedData(page: number = 1): Promise<unknown> {
  const url = `${API_BASE}/api/data?page=${page}`;

  const response = await agent.fetch(url, { method: "GET" });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GET ${url} failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ─── Signed POST Request ────────────────────────────────────────────────────

async function submitData(payload: Record<string, unknown>): Promise<unknown> {
  const url = `${API_BASE}/api/submit`;
  const body = JSON.stringify(payload);

  const response = await agent.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`POST ${url} failed (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ─── Manual Header Attachment ───────────────────────────────────────────────
// Use signRequest() when integrating with a non-fetch HTTP client or when
// needing to inspect headers before sending.

async function manualSignExample(): Promise<void> {
  const url = `${API_BASE}/api/action`;
  const body = JSON.stringify({ action: "execute", target: "process-42" });

  // Generate the 3 auth headers
  const authHeaders = await agent.signRequest("POST", url, body);

  console.log("Auth headers generated:");
  console.log("  Address:", authHeaders["x-self-agent-address"]);
  console.log("  Signature:", authHeaders["x-self-agent-signature"]);
  console.log("  Timestamp:", authHeaders["x-self-agent-timestamp"]);

  // Attach to a standard fetch call
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    body,
  });

  console.log("Response:", response.status, await response.text());
}

// ─── Retry Wrapper ──────────────────────────────────────────────────────────
// Agent signatures are unique per timestamp, so retries generate fresh
// signatures automatically.

async function fetchWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      console.warn(
        `Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`
      );

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }

  throw lastError;
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Verify registration before making requests
  const registered = await agent.isRegistered();
  if (!registered) {
    console.error("Agent is not registered. Register first using the register-agent skill.");
    process.exit(1);
  }

  console.log("Agent is registered. Making signed requests...\n");

  // Signed GET with retry
  const data = await fetchWithRetry(() => fetchProtectedData(1));
  console.log("Fetched data:", data);

  // Signed POST
  const result = await submitData({ query: "test", limit: 10 });
  console.log("Submit result:", result);

  // Manual header attachment
  await manualSignExample();
}

main().catch(console.error);
```

## Python (requests / httpx)

The same flow using the Python SDK with httpx (the SDK's built-in HTTP client).

```python
import os
import sys
import time
from self_agent_sdk import SelfAgent

# ─── Configuration ──────────────────────────────────────────────────────────

AGENT_PRIVATE_KEY = os.environ.get("AGENT_PRIVATE_KEY")
if not AGENT_PRIVATE_KEY:
    print("Error: AGENT_PRIVATE_KEY environment variable is required")
    sys.exit(1)

API_BASE = "https://api.example.com"

# ─── Agent Initialization ───────────────────────────────────────────────────

agent = SelfAgent(
    private_key=AGENT_PRIVATE_KEY,
    network="mainnet",  # or "testnet" for Celo Sepolia
)

print(f"Agent address: {agent.address}")

# ─── Signed GET Request ─────────────────────────────────────────────────────

def fetch_protected_data(page: int = 1) -> dict:
    """Fetch data from a protected endpoint with agent auth."""
    url = f"{API_BASE}/api/data?page={page}"

    response = agent.fetch(url, method="GET")
    response.raise_for_status()
    return response.json()


# ─── Signed POST Request ────────────────────────────────────────────────────

def submit_data(payload: dict) -> dict:
    """Submit data to a protected endpoint with agent auth."""
    import json
    url = f"{API_BASE}/api/submit"
    body = json.dumps(payload)

    response = agent.fetch(url, method="POST", body=body)
    response.raise_for_status()
    return response.json()


# ─── Manual Header Attachment ────────────────────────────────────────────────
# Use sign_request() when integrating with the standard requests library
# or any other HTTP client.

def manual_sign_example() -> None:
    """Demonstrate manual header attachment with the requests library."""
    import json
    import requests  # standard requests library

    url = f"{API_BASE}/api/action"
    body = json.dumps({"action": "execute", "target": "process-42"})

    # Generate the 3 auth headers
    auth_headers = agent.sign_request(method="POST", url=url, body=body)

    print("Auth headers generated:")
    print(f"  Address: {auth_headers['x-self-agent-address']}")
    print(f"  Signature: {auth_headers['x-self-agent-signature']}")
    print(f"  Timestamp: {auth_headers['x-self-agent-timestamp']}")

    # Attach to a standard requests call
    response = requests.post(
        url,
        headers={
            "Content-Type": "application/json",
            **auth_headers,
        },
        data=body,
    )

    print(f"Response: {response.status_code} {response.text}")


# ─── Retry Wrapper ──────────────────────────────────────────────────────────

def fetch_with_retry(fn, max_retries: int = 3, delay_s: float = 1.0):
    """Retry a function with exponential backoff. Each retry generates
    a fresh signature because the timestamp changes."""
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            return fn()
        except Exception as e:
            last_error = e
            print(f"Attempt {attempt}/{max_retries} failed: {e}")
            if attempt < max_retries:
                time.sleep(delay_s * attempt)

    raise last_error


# ─── Main ────────────────────────────────────────────────────────────────────

def main() -> None:
    # Verify registration before making requests
    if not agent.is_registered():
        print("Agent is not registered. Register first.")
        sys.exit(1)

    print("Agent is registered. Making signed requests...\n")

    # Signed GET with retry
    data = fetch_with_retry(lambda: fetch_protected_data(1))
    print(f"Fetched data: {data}")

    # Signed POST
    result = submit_data({"query": "test", "limit": 10})
    print(f"Submit result: {result}")

    # Manual header attachment
    manual_sign_example()


if __name__ == "__main__":
    main()
```

## Rust (reqwest)

The same flow in Rust using the self-agent-sdk crate.

```rust
use self_agent_sdk::{SelfAgent, SelfAgentConfig};
use reqwest::Method;
use serde_json::json;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // ─── Configuration ──────────────────────────────────────────────────

    let private_key = std::env::var("AGENT_PRIVATE_KEY")
        .expect("AGENT_PRIVATE_KEY environment variable is required");

    let api_base = "https://api.example.com";

    // ─── Agent Initialization ───────────────────────────────────────────

    let agent = SelfAgent::new(SelfAgentConfig {
        private_key,
        network: None,           // defaults to mainnet
        registry_address: None,
        rpc_url: None,
    })?;

    println!("Agent address: {:#x}", agent.address());

    // ─── Verify Registration ────────────────────────────────────────────

    if !agent.is_registered().await? {
        eprintln!("Agent is not registered. Register first.");
        std::process::exit(1);
    }

    println!("Agent is registered. Making signed requests...\n");

    // ─── Signed GET Request ─────────────────────────────────────────────

    let url = format!("{api_base}/api/data?page=1");
    let response = agent.fetch(&url, None, None).await?;
    println!("GET /api/data: {} {}", response.status(), response.text().await?);

    // ─── Signed POST Request ────────────────────────────────────────────

    let url = format!("{api_base}/api/submit");
    let body = json!({"query": "test", "limit": 10}).to_string();
    let response = agent.fetch(
        &url,
        Some(Method::POST),
        Some(body.clone()),
    ).await?;
    println!("POST /api/submit: {} {}", response.status(), response.text().await?);

    // ─── Manual Header Attachment ───────────────────────────────────────

    let url = format!("{api_base}/api/action");
    let body = json!({"action": "execute", "target": "process-42"}).to_string();

    let auth_headers = agent.sign_request("POST", &url, Some(&body)).await?;

    println!("Auth headers generated:");
    for (k, v) in &auth_headers {
        println!("  {k}: {v}");
    }

    // Attach to a reqwest request
    let client = reqwest::Client::new();
    let mut request = client.post(&url)
        .header("content-type", "application/json")
        .body(body);
    for (k, v) in &auth_headers {
        request = request.header(k.as_str(), v.as_str());
    }
    let response = request.send().await?;
    println!("Response: {} {}", response.status(), response.text().await?);

    Ok(())
}
```

## curl

Manual header construction for testing and debugging. Useful for verifying that a service correctly accepts signed requests.

### Using the CLI Tool

The `self-agent` CLI can generate headers directly:

```bash
# Generate signed headers for a POST request
self-agent sign \
  --method POST \
  --url https://api.example.com/data \
  --body '{"key":"value"}'

# Output:
# x-self-agent-address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
# x-self-agent-signature: 0x...
# x-self-agent-timestamp: 1708704000000

# Pipe directly into curl
eval $(self-agent sign \
  --method POST \
  --url https://api.example.com/data \
  --body '{"key":"value"}' \
  --format curl-headers)

curl -X POST https://api.example.com/data \
  -H "Content-Type: application/json" \
  $SELF_AGENT_HEADERS \
  -d '{"key":"value"}'
```

### Manual Construction (for understanding)

The following demonstrates the signing algorithm step by step. This is not a practical workflow — use the SDK or CLI instead. The pseudocode illustrates what happens internally:

```bash
# Step 1: Set variables
PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
AGENT_ADDRESS="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
TIMESTAMP=$(date +%s%3N)  # milliseconds since epoch
METHOD="POST"
URL="https://api.example.com/data"
BODY='{"key":"value"}'

# Step 2: Compute body hash (keccak256 of UTF-8 body)
# bodyHash = keccak256('{"key":"value"}')
# Use cast (Foundry) for keccak256:
BODY_HASH=$(cast keccak "$(printf '%s' "$BODY")")

# Step 3: Canonicalize URL -> path only
PATH_QUERY="/data"

# Step 4: Build signing message
# message = keccak256(timestamp + "POST" + "/data" + bodyHash)
CONCAT="${TIMESTAMP}${METHOD}${PATH_QUERY}${BODY_HASH}"
MESSAGE=$(cast keccak "$(printf '%s' "$CONCAT")")

# Step 5: Sign with EIP-191 personal_sign
# cast wallet sign performs personal_sign over raw bytes
SIGNATURE=$(cast wallet sign --private-key "$PRIVATE_KEY" "$MESSAGE")

# Step 6: Send the request
curl -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-self-agent-address: $AGENT_ADDRESS" \
  -H "x-self-agent-signature: $SIGNATURE" \
  -H "x-self-agent-timestamp: $TIMESTAMP" \
  -d "$BODY"
```

Note: The `cast` commands above use Foundry's cast CLI. The `cast keccak` command computes Keccak-256 of a UTF-8 string, and `cast wallet sign` performs EIP-191 personal message signing. Install Foundry with `curl -L https://foundry.paradigm.xyz | bash && foundryup`.

## MCP Tool Examples

### self_sign_request

Generate headers to attach to a request manually.

**Example input:**
```json
{
  "method": "POST",
  "url": "https://api.example.com/agents/verify",
  "body": "{\"agentId\":5,\"action\":\"check\"}"
}
```

**Example output:**
```json
{
  "headers": {
    "x-self-agent-address": "0x83fa4380903fecb801F4e123835664973001ff00",
    "x-self-agent-signature": "0x1a2b3c4d5e6f...65-byte-hex-signature",
    "x-self-agent-timestamp": "1708704000000"
  },
  "agent_address": "0x83fa4380903fecb801F4e123835664973001ff00",
  "instructions": "Attach all 3 headers to your HTTP request. The signature is valid for approximately 5 minutes from the timestamp."
}
```

**Usage in a Claude Code session:**
```
User: Sign a POST request to https://api.example.com/agents/verify
      with body {"agentId": 5, "action": "check"}

Claude: [calls self_sign_request tool]
  → Returns headers. Attach these to the request:

  x-self-agent-address: 0x83fa...ff00
  x-self-agent-signature: 0x1a2b...
  x-self-agent-timestamp: 1708704000000
```

### self_authenticated_fetch

Have the MCP server send the signed request directly.

**Example input (GET):**
```json
{
  "method": "GET",
  "url": "https://api.example.com/agents/5/status"
}
```

**Example output:**
```json
{
  "status": 200,
  "body": "{\"agentId\":5,\"registered\":true,\"verified\":true,\"credentials\":{\"olderThan\":18,\"nationality\":\"GBR\"}}",
  "truncated": false
}
```

**Example input (POST with body):**
```json
{
  "method": "POST",
  "url": "https://api.example.com/tasks/create",
  "body": "{\"title\":\"Analyze dataset\",\"priority\":\"high\"}",
  "content_type": "application/json"
}
```

**Example output:**
```json
{
  "status": 201,
  "body": "{\"taskId\":\"task-42\",\"status\":\"created\",\"assignedAgent\":\"0x83fa4380903fecb801F4e123835664973001ff00\"}",
  "truncated": false
}
```

**Usage in a Claude Code session:**
```
User: Call the protected endpoint at https://api.example.com/tasks/create
      to create a new task with title "Analyze dataset"

Claude: [calls self_authenticated_fetch tool]
  → Status: 201 Created
  → Task created: task-42, assigned to agent 0x83fa...ff00
```

### Error Handling with MCP Tools

Common error responses from protected APIs:

| Status | Meaning | Resolution |
|---|---|---|
| 401 | Signature invalid or missing headers | Verify `SELF_AGENT_PRIVATE_KEY` is set correctly in the MCP server environment |
| 403 | Agent not registered or not verified | Register the agent first using the `self_register_agent` tool |
| 408 | Timestamp expired (outside 5-minute window) | Retry — the tool generates a fresh timestamp on each call |
| 429 | Rate limited | Wait and retry after the backoff period |

## Agent-to-Agent Communication

When two agents communicate, both sign their requests. The receiving agent verifies the sender's signature before processing:

```typescript
import { SelfAgent, SelfAgentVerifier } from "@selfxyz/agent-sdk";

// ─── Agent A: Send a signed request to Agent B ─────────────────────────────

const agentA = new SelfAgent({ privateKey: process.env.AGENT_A_KEY! });

const response = await agentA.fetch("https://agent-b.example.com/collaborate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    task: "analyze-data",
    dataset: "sales-2024-q4",
  }),
});

// ─── Agent B: Verify the incoming request ───────────────────────────────────

// In Agent B's Express server:
import express from "express";

const app = express();
app.use(express.json());

const verifier = new SelfAgentVerifier({
  network: "mainnet",
});

app.post("/collaborate", async (req, res) => {
  const result = await verifier.verify(req);

  if (!result.valid) {
    return res.status(401).json({ error: result.error });
  }

  console.log("Request from verified agent:", result.agentAddress);
  console.log("Agent ID:", result.agentId);

  // Process the collaboration request
  res.json({ status: "accepted", taskId: "collab-99" });
});
```

This pattern enables trustless agent-to-agent communication. Agent B can confirm that Agent A is registered on-chain and backed by a real human identity, without Agent A revealing any personal information.
