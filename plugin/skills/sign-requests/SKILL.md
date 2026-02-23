---
name: sign-requests
description: >
  This skill should be used when the user asks to "sign a request",
  "authenticate as agent", "agent auth headers", "self agent fetch",
  "signed HTTP request", "make authenticated call", or needs to send
  HTTP requests with Self Agent ID authentication headers.
---

# Sign Requests

## The 3-Header Authentication System

Every authenticated HTTP request from a Self Agent carries exactly three headers. These headers together form a tamper-proof, replay-resistant authentication envelope:

| Header | Content | Format |
|---|---|---|
| `x-self-agent-address` | Agent's Ethereum address | EIP-55 checksummed hex (e.g., `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) |
| `x-self-agent-signature` | ECDSA signature over the request | Hex-encoded, 0x-prefixed, 65 bytes (r + s + v) |
| `x-self-agent-timestamp` | Unix timestamp in milliseconds | String (e.g., `"1708704000000"`) |

The address header is informational only. The receiving service recovers the signer address from the signature and compares it to the header value. This ensures the address cannot be spoofed — a valid signature can only be produced by the holder of the corresponding private key.

## Signing Algorithm

The signing algorithm is identical across all three SDKs (TypeScript, Python, Rust) and the MCP server. The steps are:

1. **Compute the body hash.** Take the request body as a UTF-8 string. If there is no body (e.g., GET requests), use an empty string. Hash it with Keccak-256. The result is a hex string with `0x` prefix.
   ```
   bodyHash = keccak256(body || "")
   ```

2. **Canonicalize the URL.** Extract only the path and query string from the full URL. The scheme and host are stripped. Examples:
   - `https://api.example.com/api/data?page=1` becomes `/api/data?page=1`
   - `/api/data` stays as `/api/data`
   - `https://example.com/` becomes `/`

3. **Build the signing message.** Concatenate four components as a single UTF-8 string, then hash with Keccak-256:
   ```
   message = keccak256(timestamp + method.toUpperCase() + pathWithQuery + bodyHash)
   ```
   Where `timestamp` is the millisecond Unix timestamp as a string, `method` is uppercase (GET, POST, PUT, DELETE), `pathWithQuery` is the canonicalized URL from step 2, and `bodyHash` is the hex string from step 1 (including the `0x` prefix).

4. **Sign with EIP-191 personal_sign.** Apply EIP-191 personal message signing over the raw 32-byte hash from step 3. This prepends the standard `\x19Ethereum Signed Message:\n32` prefix before signing with the agent's ECDSA private key.

5. **Assemble headers.** Return the three headers: the agent's checksummed address, the hex-encoded signature, and the timestamp string.

### Worked Example

For a POST request to `https://api.example.com/data` with body `{"key":"value"}`:

```
timestamp     = "1708704000000"
method        = "POST"
pathWithQuery = "/data"
bodyHash      = keccak256('{"key":"value"}')  // 0x...64 hex chars
concat        = "1708704000000POST/data0x..."
message       = keccak256(concat)              // 32 bytes
signature     = personal_sign(message, privateKey)
```

## Using MCP Tools

The MCP server provides two tools for request signing. Both require `SELF_AGENT_PRIVATE_KEY` to be configured as an environment variable in the MCP server.

### self_sign_request

Generate authentication headers to attach manually.

**Input:**
- `method` (required): HTTP method — `GET`, `POST`, `PUT`, or `DELETE`
- `url` (required): Full URL including scheme and host (e.g., `https://api.example.com/data?page=1`)
- `body` (optional): Request body as a JSON string

**Output:**
```json
{
  "headers": {
    "x-self-agent-address": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    "x-self-agent-signature": "0x...",
    "x-self-agent-timestamp": "1708704000000"
  },
  "instructions": "Attach these headers to your HTTP request."
}
```

Use this tool when building a request manually or when needing to inspect the headers before sending. Attach all three headers to the outbound request exactly as returned.

### self_authenticated_fetch

Have the MCP server perform the full signed HTTP request.

**Input:**
- `method` (required): HTTP method — `GET`, `POST`, `PUT`, or `DELETE`
- `url` (required): Full URL
- `body` (optional): Request body as a JSON string
- `content_type` (optional): Content-Type header, defaults to `application/json`

**Output:**
```json
{
  "status": 200,
  "body": "{\"result\":\"success\"}",
  "truncated": false
}
```

The response body is capped at 10 KB. If the response exceeds this limit, the `truncated` flag is set to `true`. Use this tool for simple request-response flows where inspecting headers is not necessary.

## Using SDK (TypeScript)

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey: process.env.AGENT_PRIVATE_KEY! });

// Option 1: Get headers manually
const headers = await agent.signRequest(
  "POST",
  "https://api.example.com/protected",
  JSON.stringify({ data: "value" })
);
// headers = {
//   "x-self-agent-address": "0x...",
//   "x-self-agent-signature": "0x...",
//   "x-self-agent-timestamp": "1708704000000"
// }

// Attach to any HTTP client
const response = await fetch("https://api.example.com/protected", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ...headers,
  },
  body: JSON.stringify({ data: "value" }),
});

// Option 2: Signed fetch (recommended)
// Wraps global fetch() and auto-attaches all 3 headers.
const res = await agent.fetch("https://api.example.com/protected", {
  method: "POST",
  body: JSON.stringify({ data: "value" }),
});

console.log(res.status, await res.json());
```

The `signRequest()` method accepts the HTTP method as a string, the full URL (or just the path), and optionally the body as a string. It returns a plain object with the three header key-value pairs. The `fetch()` method is a drop-in wrapper around the global `fetch()` that automatically signs each request before sending.

## Python SDK

```python
import os
from self_agent_sdk import SelfAgent

agent = SelfAgent(private_key=os.environ["AGENT_PRIVATE_KEY"])

# Option 1: Get headers manually
headers = agent.sign_request(
    method="POST",
    url="https://api.example.com/protected",
    body='{"data":"value"}'
)
# headers = {
#     "x-self-agent-address": "0x...",
#     "x-self-agent-signature": "0x...",
#     "x-self-agent-timestamp": "1708704000000"
# }

# Use with any HTTP library (requests, httpx, aiohttp)
import httpx
response = httpx.post(
    "https://api.example.com/protected",
    headers={**headers, "Content-Type": "application/json"},
    content='{"data":"value"}'
)

# Option 2: Signed fetch (recommended)
# Uses httpx internally, auto-attaches all 3 headers.
response = agent.fetch(
    "https://api.example.com/protected",
    method="POST",
    body='{"data":"value"}'
)

print(response.status_code, response.json())
```

The Python SDK's `sign_request()` returns a `dict[str, str]`. The `fetch()` method returns an `httpx.Response` with the authentication headers already attached.

## Rust SDK

```rust
use self_agent_sdk::{SelfAgent, SelfAgentConfig};
use reqwest::Method;

let agent = SelfAgent::new(SelfAgentConfig {
    private_key: std::env::var("AGENT_PRIVATE_KEY").unwrap(),
    network: None,       // defaults to mainnet
    registry_address: None,
    rpc_url: None,
})?;

// Option 1: Get headers manually
let headers = agent.sign_request(
    "POST",
    "https://api.example.com/protected",
    Some(r#"{"data":"value"}"#),
).await?;
// headers: HashMap<String, String> with the 3 auth headers

// Use with reqwest or any HTTP client
let client = reqwest::Client::new();
let mut request = client.post("https://api.example.com/protected")
    .header("content-type", "application/json")
    .body(r#"{"data":"value"}"#.to_string());
for (k, v) in &headers {
    request = request.header(k.as_str(), v.as_str());
}
let response = request.send().await?;

// Option 2: Signed fetch (recommended)
let response = agent.fetch(
    "https://api.example.com/protected",
    Some(Method::POST),
    Some(r#"{"data":"value"}"#.to_string()),
).await?;

println!("{} {}", response.status(), response.text().await?);
```

The Rust SDK's `sign_request()` returns a `HashMap<String, String>`. The `fetch()` method returns a `reqwest::Response` with headers already attached.

## Replay Protection

The timestamp-based replay protection works as follows:

- **Timestamp freshness.** Services should reject requests with timestamps older than a configurable window. The default window is 5 minutes (300,000 milliseconds). The SDK's `SelfAgentVerifier` checks timestamp freshness automatically as the first step in verification.

- **Request binding.** Each signature is cryptographically bound to the exact tuple of `(timestamp, method, path, body)`. Changing any single component invalidates the signature. This means a captured signature for `POST /api/data` with body `{"x":1}` cannot be replayed against `POST /api/data` with body `{"x":2}`, or against `GET /api/data`, or against a different path.

- **Millisecond precision.** Timestamps use millisecond precision (not seconds) to reduce the collision window for concurrent requests from the same agent.

- **No nonce required.** The combination of millisecond timestamps and per-request body binding makes explicit nonce tracking unnecessary for most use cases. For high-security scenarios requiring strict at-most-once delivery, services can additionally track seen `(address, timestamp, signature)` tuples within the freshness window.

## Common Patterns

### Conditional signing based on registration status

Before making signed requests, verify the agent is registered:

```typescript
const agent = new SelfAgent({ privateKey: process.env.AGENT_PRIVATE_KEY! });

if (await agent.isRegistered()) {
  const response = await agent.fetch("https://api.example.com/protected");
  // handle response
} else {
  console.error("Agent not registered — register first before making signed requests");
}
```

### Attaching additional headers

Merge the auth headers with application-specific headers:

```typescript
const authHeaders = await agent.signRequest("POST", url, body);
const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer app-token",  // application-level auth
    ...authHeaders,                        // agent identity headers
  },
  body,
});
```

### GET requests (no body)

GET requests omit the body parameter. The body hash is computed over an empty string:

```typescript
const headers = await agent.signRequest("GET", "https://api.example.com/data?page=1");
```

```python
headers = agent.sign_request("GET", "https://api.example.com/data?page=1")
```

## Complete Examples

For full runnable code examples including error handling, retry logic, and integration with popular HTTP libraries, see [`examples/signed-fetch.md`](examples/signed-fetch.md).
