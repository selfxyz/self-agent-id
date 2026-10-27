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
  delayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err as Error;
      console.warn(
        `Attempt ${attempt}/${maxRetries} failed: ${lastError.message}`,
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
  // Verify registration before making requests. isVerified = has a human
  // proof AND it has not expired (isRegistered() ignores expiry).
  const info = await agent.getInfo();
  if (!info.isVerified) {
    console.error(
      info.hasHumanProof
        ? "Human proof expired. Refresh it (requestProofRefresh) first."
        : "Agent is not registered. Register first using the register-agent skill.",
    );
    process.exit(1);
  }

  console.log("Agent is verified. Making signed requests...\n");

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

## curl

Manual header construction for testing and debugging. Useful for verifying that a service correctly accepts signed requests.

The `self-agent` CLI only covers registration and deregistration; it has no signing command. Generate headers with the SDK (`agent.signRequest(...)`) or construct them manually as below.

### Manual Construction (for understanding)

The following demonstrates the signing algorithm step by step. This is not a practical workflow — use the SDK instead. The pseudocode illustrates what happens internally:

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

These tools are **privileged** on the hosted MCP server: they sign as the server's own configured agent and need `Authorization: Bearer <MCP_PRIVILEGED_API_KEY>`, so they apply to a deployment you run yourself with `SELF_AGENT_PRIVATE_KEY` set.

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
  "instructions": "Add these three headers to your HTTP request. The receiving service can verify them to confirm this agent is backed by a real human."
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
  "url": "https://api.example.com/agents/5/status",
  "body": "{\"agentId\":5,\"verified\":true,\"credentials\":{\"olderThan\":18,\"nationality\":\"GBR\"}}",
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
  "url": "https://api.example.com/tasks/create",
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

| Status | Meaning                                                                             | Resolution                                                                                                                               |
| ------ | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 401    | Invalid signature, expired timestamp, unregistered or expired agent, policy failure | Check the `error` text. Retry for timestamp errors (each call signs a fresh timestamp); register or refresh the server's agent otherwise |
| 429    | Rate limited                                                                        | Wait `retryAfterMs` and retry                                                                                                            |

`SelfAgentVerifier`'s middleware answers every verification failure with 401 and rate limiting with 429; other services may choose different codes.

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
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as { rawBody?: Buffer }).rawBody = buf; // auth() verifies the exact bytes
    },
  }),
);

const verifier = SelfAgentVerifier.create().network("mainnet").build();

// verifier.auth() verifies the signature, timestamp, replay and on-chain state,
// answers 401 on failure, and sets req.agent on success
app.post("/collaborate", verifier.auth(), (req, res) => {
  console.log("Request from verified agent:", req.agent!.address);
  console.log("Agent ID:", req.agent!.agentId);

  // Process the collaboration request
  res.json({ status: "accepted", taskId: "collab-99" });
});
```

This pattern enables trustless agent-to-agent communication. Agent B can confirm that Agent A is registered on-chain and backed by a real human identity, without Agent A revealing any personal information.
