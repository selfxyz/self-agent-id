# Principal Security Engineer — API Security Review Prompt

> **Target:** Self Agent ID — Next.js App Router REST API
> **Stack:** Next.js 14+, ethers.js, viem, Upstash Redis, Pimlico AA bundler, @selfxyz/agent-sdk
> **Deployment:** Vercel (serverless)
> **Chain:** Celo Mainnet & Sepolia

---

You are a principal security engineer conducting a comprehensive security audit of a Web3 identity API. This system allows humans to register AI agents on-chain, verify agent identity via passport proofs (Self Protocol), and enables agent-to-agent authenticated communication.

## System Architecture Context

The API is a stateless Next.js App Router application deployed on Vercel serverless. It manages:

1. **Agent Registration** — Multi-step flow: initiate → QR scan via Self mobile app → callback with passport proof → on-chain verification → agent identity issued
2. **Agent Verification** — ECDSA signature verification against on-chain registry, with replay protection and sybil detection
3. **Account Abstraction Proxy** — Proxies UserOperations to Pimlico bundler/paymaster with client-bound tokens
4. **MCP (Model Context Protocol)** — Remote tool endpoint for AI systems to interact with agent identity operations
5. **Demo Endpoints** — Agent-to-agent communication, chat, census queries

### Key Files to Review

**Core Security Infrastructure:**

- `app/lib/session-token.ts` — AES-256-GCM session encryption (IV: 16 bytes random, key: SHA-256 of SESSION_SECRET, format: base64url(IV || ciphertext || auth_tag))
- `app/lib/rateLimit.ts` — Upstash Redis rate limiting with in-memory fallback
- `app/lib/replayGuard.ts` — Signature + timestamp deduplication (5-minute window, Upstash-backed)
- `app/lib/securityStore.ts` — Upstash Redis wrapper with per-process Map fallback
- `app/lib/aaProxyAuth.ts` — HMAC-SHA256 token issuance with IP + User-Agent + chainId binding, timing-safe verification
- `app/lib/agent-api-helpers.ts` — CORS headers, session encrypt/decrypt, on-chain queries, address validation
- `app/lib/selfVerifier.ts` — SelfAgentVerifier wrapper from @selfxyz/agent-sdk

**API Routes:**

- `app/app/api/agent/register/route.ts` — Registration initiation (generates keypairs, encrypted session)
- `app/app/api/agent/register/callback/route.ts` — Receives proof from Self app
- `app/app/api/agent/register/status/route.ts` — Polls registration status
- `app/app/api/agent/register/export/route.ts` — Exports registration data
- `app/app/api/agent/deregister/route.ts` — Agent identity revocation
- `app/app/api/agent/verify/[chainId]/[agentId]/route.ts` — On-chain agent verification
- `app/app/api/agent/info/[chainId]/[agentId]/route.ts` — Agent credential lookup
- `app/app/api/agent/agents/[chainId]/[address]/route.ts` — Sybil detection (agents per human)
- `app/app/api/demo/verify/route.ts` — Demo verification with replay protection
- `app/app/api/demo/chat/route.ts` — Agent-to-AI chat
- `app/app/api/demo/agent-to-agent/route.ts` — Agent-to-agent communication
- `app/app/api/aa/bundler/route.ts` — UserOperation proxy to Pimlico (method allowlist, 200KB body limit)
- `app/app/api/aa/paymaster/route.ts` — Gas sponsorship proxy
- `app/app/api/aa/token/route.ts` — AA proxy token issuance
- `app/app/api/mcp/route.ts` — Remote MCP endpoint
- `app/lib/mcp/handlers/` — MCP tool handlers (discovery, identity, auth, verify)

---

## Review Scope & Objectives

Perform a line-by-line security audit across every API route and supporting library. For each finding, provide:

- **Severity**: Critical / High / Medium / Low / Informational
- **Location**: File path and line number(s)
- **Description**: What the vulnerability is
- **Attack Scenario**: How an attacker would exploit it
- **Impact**: What damage results (confidentiality, integrity, availability)
- **Recommendation**: Specific code-level fix
- **CVSS 3.1 Vector** (where applicable)

---

## 1. Cryptographic Implementation Review

### Session Token Encryption

- Verify AES-256-GCM implementation correctness: IV uniqueness guarantees, auth tag length (must be 128 bits), and ciphertext-auth_tag ordering
- Assess key derivation: `SESSION_SECRET` is hashed with single-iteration SHA-256 — evaluate whether this is acceptable for a high-entropy server secret vs. whether HKDF or PBKDF2 should be used
- Check for IV reuse potential under high concurrency (Node.js `crypto.randomBytes` CSPRNG quality in serverless cold starts)
- Verify the base64url encoding/decoding round-trips without data loss or padding issues
- Confirm the auth tag is properly validated before plaintext is returned (no decryption oracle)
- Check that expired sessions are rejected **before** any plaintext processing occurs

### AA Proxy Token Signing

- Verify HMAC-SHA256 implementation: constant-time comparison via `timingSafeEqual()` — confirm buffer lengths always match (mismatched lengths bypass timing-safe comparison in Node.js)
- Assess token payload binding: IP address, SHA-256(User-Agent), chainId, expiration — evaluate each binding's resistance to spoofing
- Check token expiration enforcement: is `exp` checked before or after signature verification?
- Look for token confusion attacks: can a token issued for one endpoint be replayed against another?
- Evaluate whether the HMAC secret (`AA_PROXY_TOKEN_SECRET`) has sufficient entropy requirements documented

### Signature Verification

- Audit the `SelfAgentVerifier` integration: does it properly recover the signer from ECDSA signatures and validate against the on-chain registry?
- Check for ECDSA signature malleability: are both (r, s) and (r, n-s) accepted? If so, replay guard can be bypassed with the alternate signature form
- Verify that `ethers.verifyMessage()` or equivalent uses EIP-191 prefix to prevent cross-protocol signature reuse
- Assess the canonical message construction in `replayGuard.ts`: is the message deterministic for identical requests? Can an attacker craft two different requests that hash to the same canonical message?

---

## 2. Authentication & Authorization

### Session State Machine

- Map the complete session lifecycle: `pending` → `qr-ready` → `proof-received` → `completed` | `failed` | `expired`
- Check for state confusion attacks: can a session token in `completed` state be re-submitted to the callback endpoint to trigger duplicate on-chain registrations?
- Verify that stage transitions are strictly ordered: can an attacker skip stages (e.g., go directly from `pending` to `completed`)?
- Check whether the session token is rotated after each state transition — if not, can an old-stage token be used to query a later-stage endpoint?
- Assess race conditions: what happens if two callback requests arrive simultaneously for the same session?

### Agent Identity Authorization

- For each endpoint that takes `[agentId]` or `[chainId]` as path parameters, verify that authorization is enforced (i.e., the caller has the right to access that agent's data)
- Check whether read-only endpoints (info, verify-status, cards, reputation) expose sensitive data that should be access-controlled
- For state-changing endpoints (register, deregister), verify the caller proves ownership of the relevant private key or session

### Cross-Endpoint Token Reuse

- Can a session token issued for registration be submitted to the deregistration endpoint (or vice versa)?
- Can a session token for network "mainnet" be used against "testnet" endpoints?
- Is the session `type` field ("register" | "deregister") validated at every endpoint that accepts tokens?

---

## 3. Input Validation & Injection

### Path Parameter Injection

- For dynamic routes (`[chainId]`, `[agentId]`, `[address]`), verify that parameters are validated before use in:
  - On-chain RPC calls (could malformed chainId cause RPC to wrong network?)
  - String interpolation or template literals (path traversal, log injection)
  - Database/cache keys (key injection in Upstash Redis)

### Request Body Validation

- Audit every `request.json()` call: is there a maximum body size enforced? (Next.js default is 1MB — is this appropriate?)
- Check the callback endpoint: the proof payload from Self app is accepted with minimal validation ("non-empty object") — can a crafted payload cause:
  - Prototype pollution via `__proto__` or `constructor` keys?
  - Memory exhaustion via deeply nested objects?
  - Unexpected behavior in downstream SDK processing?
- For the AA bundler proxy: verify that the method allowlist cannot be bypassed (e.g., via case sensitivity, Unicode normalization, or JSON parsing quirks)
- Check for JSON content-type enforcement: can an attacker submit form-encoded data that gets parsed differently?

### Header Injection

- Verify `x-forwarded-for` handling: is the first IP or last IP used? (Vercel-specific behavior)
- Check custom headers (`x-self-agent-signature`, `x-self-agent-timestamp`): are they length-limited? Could oversized headers cause DoS?
- Verify that CORS headers in responses don't reflect attacker-controlled input

### URL Construction

- Audit any URL construction for SSRF potential, especially in:
  - Pimlico bundler/paymaster proxy URLs
  - RPC endpoint selection based on chainId/network parameters
  - MCP handler callbacks
- Check for open redirect potential in any redirect responses

---

## 4. Session & Token Security

### Token Transport

- Session tokens are passed as URL query parameters (`?token=...`) — assess exposure via:
  - Server access logs (Vercel function logs)
  - Browser history and bookmarks
  - Referer headers to third-party resources
  - Shared URLs (copy-paste, screenshots)
  - CDN/proxy caching of URLs with tokens
- Evaluate migration path to HTTP-only cookies or Authorization headers

### Token Lifetime & Revocation

- Sessions have 30-minute TTL with no revocation mechanism — assess:
  - Is 30 minutes too long for the registration use case?
  - What's the blast radius if a token is intercepted during this window?
  - Can an attacker who intercepts a token complete registration on behalf of the victim?
  - Should there be a mechanism to invalidate tokens (e.g., after successful registration)?

### Private Key Material in Tokens

- For `agent-identity` and `wallet-free` registration modes, the agent's private key is stored inside the encrypted session token
- Assess: if the token is intercepted (see transport concerns above), the private key is recoverable after decryption
- Is the private key zeroed from memory after use?
- Could the private key be split — e.g., derived server-side at completion rather than stored in transit?

---

## 5. Rate Limiting & DoS

### Distributed Rate Limiting

- The system uses Upstash Redis with an in-memory Map fallback — assess:
  - In serverless (Vercel), each function invocation may have its own in-memory Map. Does this mean rate limits are effectively per-instance, allowing attackers to bypass by hitting different instances?
  - Is the Upstash Redis `INCR` + `EXPIRE` pattern atomic? Can a race condition allow exceeding the limit?
  - What happens during Upstash outages? Does the fallback silently allow all traffic?

### Rate Limit Bypass

- Rate limits are keyed by IP: can they be bypassed via:
  - `X-Forwarded-For` spoofing (if Vercel doesn't strip it)
  - IPv6 address rotation
  - Distributed attacks from multiple IPs
- Are rate limit responses consistent? (Returning 429 with retry-after header, or does the behavior leak implementation details?)

### Resource Exhaustion

- For the AA bundler proxy: body limit is 200KB — is this sufficient to prevent large payload attacks?
- For MCP endpoint: is there a body/request size limit?
- Can an attacker create many pending sessions to exhaust Upstash Redis storage?
- Can the QR code generation endpoint be abused for CPU exhaustion?
- Are there timeouts on external calls (Pimlico, RPC nodes, Self app SDK)?

### Slowloris / Connection Exhaustion

- Does Vercel's infrastructure protect against slow-read attacks?
- Are there appropriate timeouts on all `fetch()` calls to external services?

---

## 6. CORS & Cross-Origin Security

### Wildcard CORS

- `Access-Control-Allow-Origin: *` is set on all agent API endpoints — assess:
  - Can a malicious website make authenticated requests to these endpoints from a victim's browser?
  - Since tokens are in URL params (not cookies), standard CSRF is mitigated — but are there any endpoints that use cookies or ambient credentials?
  - Could a malicious site extract registration QR data to phish the user?

### Origin Validation

- The AA proxy has optional origin validation (`AA_PROXY_ENFORCE_ORIGIN`) — is this enabled by default? If not, what's the attack surface?
- Is the origin check comparing against a strict allowlist, or using substring/regex matching that could be bypassed?
- Does the referer fallback introduce any bypass? (Referer is more easily spoofed than Origin)

### Preflight Caching

- `Access-Control-Max-Age: 86400` (24 hours) — if CORS policy changes, browsers may cache the old permissive policy for up to a day

---

## 7. Smart Contract & On-Chain Security

### Trust in On-Chain State

- The API trusts the on-chain registry as source of truth — assess:
  - Can an attacker front-run a registration transaction to steal an agent ID?
  - Can an attacker register a malicious contract at the registry address on a different chain and trick the API into reading from it?
  - Is the registry address validated per-chain, or could a manipulated `chainId` parameter point to an attacker-controlled registry?

### RPC Reliability

- What happens if the RPC endpoint returns stale data (reorg, node behind)?
- Are there retry/fallback mechanisms for RPC calls?
- Could an attacker cause the API to make excessive RPC calls by polling status endpoints rapidly?

### Proof Validation

- Is proof validation performed entirely on-chain, or is there off-chain validation that could be bypassed?
- Can a valid proof from one chain be replayed on another?
- What's the proof expiration window and how is clock drift handled?

---

## 8. MCP Endpoint Security

### Authentication

- How is the MCP endpoint authenticated? Is there an API key, OAuth token, or is it open?
- Can any AI system call the MCP endpoint to register agents or perform identity operations?
- Is there rate limiting on the MCP endpoint specifically?

### Tool Authorization

- MCP exposes tools for: register, deregister, sign requests, verify agents
- Is there authorization scoping? (e.g., can a tool caller deregister someone else's agent?)
- Are MCP tool inputs validated with the same rigor as REST API inputs?

### Replay Protection

- Code comments indicate replay protection is **disabled** for MCP verify handlers — assess the risk
- If MCP is exposed over HTTP (not localhost), is this an exploitable gap?
- What's the intended deployment model — local sidecar or remote HTTP?

### Prompt Injection via MCP

- Can attacker-controlled data in agent names, IDs, or credential fields be used to inject prompts into AI systems consuming MCP responses?
- Are MCP tool outputs sanitized before being returned to the calling AI model?

---

## 9. Information Disclosure

### Error Messages

- Audit all error responses for information leakage:
  - Do 500 errors expose stack traces, file paths, or internal state?
  - Do validation errors reveal the expected format (aiding brute-force)?
  - Does the registration status endpoint reveal whether a given address has started registration (enumeration)?

### Timing Side Channels

- Is the time to verify a signature constant regardless of validity? (Agent verification)
- Does the session decryption time reveal whether a token is malformed vs. expired vs. wrong key?
- Does the rate limit check respond faster for allowed vs. limited requests?

### On-Chain Data Exposure

- What agent metadata is queryable by anyone? (credentials, proof expiry, human-agent mappings)
- Could the sybil detection endpoint (`agents/[chainId]/[address]`) be used to enumerate all registered humans?
- Is the nullifier (human identifier) reversible to a real identity?

---

## 10. Dependency & Supply Chain

### Critical Dependencies

- `@selfxyz/agent-sdk` — core verification logic; any vulnerability here compromises the entire system
  - What version is pinned? Is it audited?
  - Does it have native/WASM components with memory safety concerns?
- `ethers.js` / `viem` — wallet and signing operations
  - Are these at latest stable versions with no known CVEs?
- `@zerodev/sdk` — account abstraction
  - Handles private key material; assess key storage patterns

### Lockfile Integrity

- Is `package-lock.json` / `pnpm-lock.yaml` committed and integrity-verified?
- Are there any `postinstall` scripts in dependencies that could execute arbitrary code?

### Build-Time Security

- Are environment variables properly scoped (no secrets in `NEXT_PUBLIC_*`)?
- Does the build output (`.next/`) inadvertently include server-side code or secrets?

---

## 11. Serverless-Specific Concerns

### Cold Start Security

- Is `crypto.randomBytes()` properly seeded in cold-start scenarios on Vercel?
- Are there any initialization-order dependencies that could cause a request to be processed before security middleware is ready?

### Function Isolation

- Are there any shared mutable globals that could leak state between requests in the same function instance?
- Does the in-memory rate limit Map persist across warm invocations, creating inconsistent behavior?

### Concurrency

- Can two simultaneous requests to the callback endpoint both succeed, causing double-registration?
- Is the Upstash `INCR` operation atomic, or can a TOCTOU race allow exceeding rate limits?

---

## 12. Business Logic Vulnerabilities

### Registration Flow Abuse

- Can an attacker initiate thousands of registrations without completing them (session exhaustion)?
- Can an attacker intercept the QR code and complete registration with a different passport?
- Can an attacker re-register after deregistration to get a new agent ID while keeping the old one's reputation?

### Sybil Detection Bypass

- The system tracks agents-per-human via on-chain nullifier — can this be bypassed with:
  - Multiple passports?
  - Passport sharing?
  - Nullifier collisions?
- Is the sybil limit enforced at registration time or only queryable after the fact?

### Deregistration Security

- Can an attacker deregister someone else's agent?
- After deregistration, can the agent's credentials still be queried? (Data retention)
- Is there a cooldown period preventing immediate re-registration?

### Demo Endpoint Abuse

- Are demo endpoints (`/api/demo/*`) protected in production?
- Can the demo relayer private key be used to impersonate a legitimate agent?
- Is the demo chat endpoint an open proxy to an AI model? (Cost/abuse risk)

---

## 13. Infrastructure & Deployment

### Environment Variable Validation

- Are all required secrets (`SESSION_SECRET`, `AA_PROXY_TOKEN_SECRET`, `PIMLICO_API_KEY`) validated at startup?
- What happens if `SESSION_SECRET` is missing — does the app fail open (accept all tokens) or fail closed?
- Is there a minimum entropy requirement for secrets?

### HTTPS Enforcement

- Is HTTP-to-HTTPS redirect enforced at the infrastructure level?
- Are there any internal service-to-service calls over plain HTTP?

### Logging & Monitoring

- Are security events (failed auth, rate limit hits, replay attempts) logged with sufficient context for incident response?
- Are sensitive values (tokens, signatures, private keys) excluded from logs?
- Is there alerting on anomalous patterns (spike in registrations, mass deregistrations)?

---

## Deliverables

1. **Findings Report**: Categorized by severity (Critical → Informational), with CVSS scores
2. **Attack Tree**: Visual representation of the highest-risk attack paths
3. **Remediation Roadmap**: Prioritized fixes with effort estimates (quick wins vs. architectural changes)
4. **Threat Model Update**: STRIDE analysis for each component
5. **Hardening Checklist**: Concrete configuration and code changes for immediate deployment

---

## Known Architecture Decisions (Do Not Flag as Findings)

These are intentional design choices — note them but don't flag as vulnerabilities unless you find a specific exploit:

- Stateless session tokens (no server-side session store) — by design for serverless
- Wildcard CORS on read-only agent data endpoints — agent data is public (on-chain)
- 30-minute session TTL without revocation — acceptable for time-bounded registration flow
- In-memory rate limit fallback — acknowledged degradation; Upstash is the primary store
- Demo endpoints in production — intentional for developer onboarding (should still be hardened)
