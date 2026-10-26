---
name: sign-requests
description: >
  How to sign HTTP requests with Self Agent ID's 3-header authentication
  system. Covers ECDSA and Ed25519 signing, the signing algorithm, MCP tools
  (self_sign_request, self_authenticated_fetch), SDK usage in
  TypeScript, and replay protection. Use when the user asks to
  "sign a request", "authenticate as agent", "agent auth headers",
  "self agent fetch", "signed HTTP request", "ed25519 signing", or
  "make authenticated call".
license: MIT
metadata:
  author: Self Protocol
  version: 1.0.0
  mcp-server: self-agent-id
---

# Sign Requests

## The 3-Header Authentication System

Every authenticated HTTP request from a Self Agent carries exactly three headers. These headers together form a tamper-proof, replay-resistant authentication envelope:

| Header                   | Content                          | Format                                                                      |
| ------------------------ | -------------------------------- | --------------------------------------------------------------------------- |
| `x-self-agent-address`   | Agent's Ethereum address         | EIP-55 checksummed hex (e.g., `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) |
| `x-self-agent-signature` | ECDSA signature over the request | Hex-encoded, 0x-prefixed, 65 bytes (r + s + v)                              |
| `x-self-agent-timestamp` | Unix timestamp in milliseconds   | String (e.g., `"1708704000000"`)                                            |

The address header is informational only. The receiving service recovers the signer address from the signature and compares it to the header value. This ensures the address cannot be spoofed — a valid signature can only be produced by the holder of the corresponding private key.

## Signing Algorithm

The signing algorithm is the same in the TypeScript SDK and the MCP server, and is straightforward to reproduce in any language with keccak256 and EIP-191 signing. The steps are:

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

The hosted MCP server provides two **privileged** tools for request signing. They sign as the MCP server's own configured agent (`SELF_AGENT_PRIVATE_KEY` on the server) and require `Authorization: Bearer <MCP_PRIVILEGED_API_KEY>`. The shared deployment at `agent-api.self.xyz` has no agent key, so use these only against a deployment you run yourself; to sign with your own key, use the SDK (below).

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
  "instructions": "Add these three headers to your HTTP request. The receiving service can verify them to confirm this agent is backed by a real human."
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
  "url": "https://api.example.com/data",
  "body": "{\"result\":\"success\"}",
  "truncated": false
}
```

The response body is capped at 10 KB. If the response exceeds this limit, the `truncated` flag is set to `true`. Requests to localhost / private / reserved networks are blocked, and redirects (max 3) are followed only to allowed targets.

## Using SDK (TypeScript)

```typescript
import { SelfAgent } from "@selfxyz/agent-sdk";

const agent = new SelfAgent({ privateKey: process.env.AGENT_PRIVATE_KEY! });

// Option 1: Get headers manually
const headers = await agent.signRequest(
  "POST",
  "https://api.example.com/protected",
  JSON.stringify({ data: "value" }),
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

## Replay Protection

The timestamp-based replay protection works as follows:

- **Timestamp freshness.** Services should reject requests with timestamps older than a configurable window. The default window is 5 minutes (300,000 milliseconds). The SDK's `SelfAgentVerifier` checks timestamp freshness automatically as the first step in verification.

- **Request binding.** Each signature is cryptographically bound to the exact tuple of `(timestamp, method, path, body)`. Changing any single component invalidates the signature. This means a captured signature for `POST /api/data` with body `{"x":1}` cannot be replayed against `POST /api/data` with body `{"x":2}`, or against `GET /api/data`, or against a different path.

- **Millisecond precision.** Timestamps use millisecond precision (not seconds) to reduce the collision window for concurrent requests from the same agent.

- **Replay cache.** A signed request can be resent unchanged within the freshness window, so `SelfAgentVerifier` also remembers seen signatures and rejects repeats (replay protection is on by default). The cache is in memory per verifier instance; services running several instances that need strict at-most-once delivery should share a replay store or use idempotency keys.

## Ed25519 Signing

The SDK also provides an `Ed25519Agent` class for Ed25519-based signing. The API is identical to `SelfAgent`, but uses Ed25519 keys instead of ECDSA (secp256k1).

```typescript
import { Ed25519Agent } from "@selfxyz/agent-sdk";

const agent = new Ed25519Agent({ privateKey: process.env.ED25519_SEED! }); // 64 hex chars

// Same API as SelfAgent
const headers = await agent.signRequest("POST", url, body);
const response = await agent.fetch(url, { method: "POST", body });
```

Ed25519 agents include an additional header `x-self-agent-keytype: "ed25519"` and use `x-self-agent-key` (public key) instead of `x-self-agent-address`. The `SelfAgentVerifier` handles both key types transparently — no server-side changes needed.

## Common Patterns

### Conditional signing based on registration status

Before making signed requests, verify the agent is registered:

```typescript
const agent = new SelfAgent({ privateKey: process.env.AGENT_PRIVATE_KEY! });

const info = await agent.getInfo();
if (info.isVerified) {
  // registered AND the human proof has not expired
  const response = await agent.fetch("https://api.example.com/protected");
  // handle response
} else if (info.hasHumanProof) {
  console.error("Human proof expired — refresh it (requestProofRefresh)");
} else {
  console.error("Agent not registered — register first");
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
    Authorization: "Bearer app-token", // application-level auth
    ...authHeaders, // agent identity headers
  },
  body,
});
```

### GET requests (no body)

GET requests omit the body parameter. The body hash is computed over an empty string:

```typescript
const headers = await agent.signRequest(
  "GET",
  "https://api.example.com/data?page=1",
);
```

## Complete Examples

For full runnable code examples including error handling, retry logic, and integration with popular HTTP libraries, see [`references/signed-fetch.md`](references/signed-fetch.md).

## Troubleshooting

| Symptom                                                            | Cause                                                                                    | Resolution                                                                                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signature verification fails on server                             | Body mismatch — the body used for signing differs from the body sent                     | Ensure the exact same string is passed to both `signRequest()` and the HTTP request body. JSON serialization order matters.                                             |
| Signature verification fails on server                             | Timestamp drift between client and server                                                | Check that both machines have synchronized clocks (NTP). The default window is 5 minutes.                                                                               |
| `401 Unauthorized` with valid signature                            | Path mismatch — signing used full URL but server verified with path only (or vice versa) | The signing algorithm uses only the path and query string (no scheme or host). Ensure the server reconstructs the same path.                                            |
| `SELF_AGENT_PRIVATE_KEY` not found                                 | Environment variable not set in MCP server config                                        | Add the key to the `env` block in your MCP server configuration (`.claude/mcp_servers.json` or `.mcp.json`).                                                            |
| Signature is `0x` followed by 130 hex chars but verification fails | Wrong EIP-191 prefix or hash construction                                                | Verify the message is hashed with Keccak-256 before EIP-191 personal_sign. The prefix must be `\x19Ethereum Signed Message:\n32` (32 bytes, not the hex string length). |
| GET request signature rejected                                     | Body parameter passed as `undefined` instead of omitted                                  | For GET requests, omit the body parameter entirely or pass an empty string. Do not pass `undefined` or `null`.                                                          |
