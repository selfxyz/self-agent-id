# Self Agent ID API Security Review (Next.js App Router)

Date: 2026-02-25  
Reviewer: Principal Security Engineering (AI-assisted)

## Scope

Reviewed the API and supporting security libraries in:

- `app/lib/session-token.ts`
- `app/lib/aaProxyAuth.ts`
- `app/lib/rateLimit.ts`
- `app/lib/replayGuard.ts`
- `app/lib/securityStore.ts`
- `app/lib/agent-api-helpers.ts`
- `app/lib/selfVerifier.ts`
- `app/lib/mcp/handlers/*`
- `app/app/api/agent/*`
- `app/app/api/demo/*`
- `app/app/api/aa/*`
- `app/app/api/mcp/route.ts`

---

## Executive Summary

The codebase demonstrates strong foundational controls (AEAD token encryption, path-level chain allowlists for AA proxy, origin checks, signature verification integrations, and replay keying). However, multiple **high-impact logic and deployment-safety gaps** remain:

1. **Remote MCP endpoint has no authentication gate**, exposing registration/deregistration and signed outbound request tooling to unauthenticated callers.
2. **MCP authenticated fetch tool can be abused for SSRF** against internal resources.
3. **Session tokens in URL query parameters carry high-value secrets** (including agent private keys in some flows), increasing interception blast radius.
4. **Rate limiting/replay protections degrade to per-instance memory fallback** and are vulnerable to known serverless bypass patterns during Redis outages.
5. **External fetches have no explicit timeout/abort control**, enabling resource pinning and availability degradation.

---

## Findings (Critical → Informational)

### 1) Unauthenticated remote MCP endpoint exposes privileged tools
- **Severity:** Critical  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H` (9.9)
- **Location:** `app/app/api/mcp/route.ts`
- **Description:** The MCP handler is exported directly for GET/POST/DELETE with no API key, bearer token, mTLS, signature verification, or IP allowlist enforcement.
- **Attack scenario:** Any Internet client can invoke `self_register_agent`, `self_deregister_agent`, `self_sign_request`, and `self_authenticated_fetch`, abusing identity operations and request-signing capabilities.
- **Impact:** Confidentiality/integrity/availability compromise across identity lifecycle and downstream integrations.
- **Recommendation:** Add mandatory MCP authentication (HMAC API key or OAuth2/JWT), request-level authorization per tool, and disable DELETE unless explicitly needed.

### 2) MCP `self_authenticated_fetch` is an SSRF primitive
- **Severity:** High  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:L/A:L` (9.3)
- **Location:** `app/lib/mcp/handlers/auth.ts`
- **Description:** Tool accepts arbitrary URL and performs server-side fetch with no host allowlist, scheme restriction, DNS-rebinding protections, or local-network denylist.
- **Attack scenario:** Untrusted MCP caller targets cloud metadata endpoints, internal admin services, Redis dashboards, etc.
- **Impact:** Internal network/data exposure; lateral movement.
- **Recommendation:** Enforce URL policy: HTTPS-only, explicit domain allowlist, resolved-IP private range blocking, and outbound egress controls.

### 3) Session tokens in query params + encrypted private keys increase theft impact
- **Severity:** High  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:N` (8.1)
- **Location:** `app/app/api/agent/register/callback/route.ts`, `app/app/api/agent/register/status/route.ts`, `app/app/api/agent/deregister/callback/route.ts`, `app/app/api/agent/deregister/status/route.ts`, and token payload fields in `app/lib/session-token.ts`
- **Description:** Multiple endpoints require `?token=` in URL. Session payload can contain `agentPrivateKey` in agent-identity and wallet-free flows.
- **Attack scenario:** Token leaks through logs, browser history, shared URLs, referrers/screenshots; attacker replays token to export private key or advance flow.
- **Impact:** Agent key compromise and identity takeover within token TTL.
- **Recommendation:** Move tokens to `Authorization: Bearer` or HttpOnly secure cookie; strip sensitive session fields (store key server-side via envelope/ref-id); one-time consume semantics after completion.

### 4) MCP request verification explicitly disables replay protection
- **Severity:** High  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N` (7.5)
- **Location:** `app/lib/mcp/handlers/verify.ts`
- **Description:** `SelfAgentVerifier` is instantiated with `.replayProtection(false)` for `handleVerifyRequest`.
- **Attack scenario:** Intercepted signed request can be replayed within freshness window to any MCP consumer trusting this tool output.
- **Impact:** Duplicate action execution / idempotency bypass on relying services.
- **Recommendation:** Enable replay protection with distributed cache by default; require nonce and audience binding.

### 5) Replay guard does not reject future/stale timestamps explicitly
- **Severity:** Medium  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L` (5.3)
- **Location:** `app/lib/replayGuard.ts`
- **Description:** `checkAndRecordReplay` parses timestamp but does not enforce absolute skew window before store insert; TTL is derived from timestamp and clamped to >=1ms.
- **Attack scenario:** Crafted extreme timestamps create odd replay windows; relying callers may assume strict freshness in this layer.
- **Impact:** Replay control weakening and inconsistent acceptance semantics.
- **Recommendation:** Enforce `abs(now - ts) <= maxAgeMs` prior to dedupe; reject future timestamps beyond small skew.

### 6) Rate limiting degrades fail-open semantics in outages/serverless fanout
- **Severity:** Medium  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H` (7.5)
- **Location:** `app/lib/securityStore.ts`, `app/lib/rateLimit.ts`
- **Description:** On Upstash errors, logic silently falls back to in-memory maps. In serverless, this is per-instance and non-global.
- **Attack scenario:** Attacker induces/benefits from Redis degradation and distributes requests across instances, bypassing effective limits.
- **Impact:** DoS/cost amplification and brute-force surface increase.
- **Recommendation:** Add explicit degraded-mode signaling and stricter emergency limits; optionally fail-closed on sensitive endpoints (AA token, bundler/paymaster).

### 7) AA proxy request size check uses character length, not bytes
- **Severity:** Medium  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L` (4.3)
- **Location:** `app/app/api/aa/bundler/route.ts`, `app/app/api/aa/paymaster/route.ts`
- **Description:** `body.length` can underestimate actual byte size for multibyte UTF-8 input.
- **Attack scenario:** Attacker sends oversized multibyte payloads to bypass intended 200KB cap.
- **Impact:** Memory and upstream abuse risk.
- **Recommendation:** Use `Buffer.byteLength(body, "utf8")` for enforcement.

### 8) No explicit outbound fetch timeouts for critical upstream calls
- **Severity:** Medium  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:M` (6.5)
- **Location:** `app/lib/securityStore.ts`, `app/app/api/aa/bundler/route.ts`, `app/app/api/aa/paymaster/route.ts`, `app/app/api/demo/chat/route.ts`
- **Description:** External fetches do not use `AbortController` timeout caps.
- **Attack scenario:** Slow upstream responses pin serverless concurrency and increase tail latency/error rate.
- **Impact:** Availability degradation and cost spikes.
- **Recommendation:** Add strict per-upstream timeout budgets and retries with jitter where appropriate.

### 9) Deregistration initiation lacks caller possession proof of target agent key
- **Severity:** Medium  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N` (4.2)
- **Location:** `app/app/api/agent/deregister/route.ts`
- **Description:** Endpoint accepts any valid on-chain agent address and issues deregistration challenge flow without proving caller controls that agent key.
- **Attack scenario:** Social engineering/phishing workflow confusion by generating valid-looking deregistration QR for victim agent.
- **Impact:** User deception, potential accidental deregistration confirmation.
- **Recommendation:** Require signed initiation nonce from agent key (or owner wallet) before issuing deregistration session.

### 10) Callback proof payload accepted with minimal schema validation
- **Severity:** Medium  
- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L` (5.3)
- **Location:** `app/app/api/agent/register/callback/route.ts`, `app/app/api/agent/deregister/callback/route.ts`
- **Description:** Any non-empty JSON object transitions to `proof-received`; no object depth/shape/size constraints.
- **Attack scenario:** Malformed or oversized proof-like payloads cause parser/memory pressure or ambiguous state transitions.
- **Impact:** Availability and state-integrity risk.
- **Recommendation:** Enforce zod schema for expected callback payload and maximum nested/object size.

### 11) `x-forwarded-for` trust model is implicit and not hardened
- **Severity:** Low  
- **CVSS 3.1:** `AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L` (3.7)
- **Location:** `app/lib/aaProxyAuth.ts`, registration/deregistration routes
- **Description:** First IP from `x-forwarded-for` is used without explicit trusted proxy boundary documentation.
- **Attack scenario:** In non-Vercel or misconfigured proxy chains, spoofing can weaken IP-bound tokens/rate limits.
- **Impact:** Rate-limit and token-binding bypass under certain deployments.
- **Recommendation:** Parse IP only from trusted platform headers or verified edge metadata; document deployment assumptions.

### 12) Dependency/supply-chain posture needs tightening
- **Severity:** Informational
- **Location:** `app/package.json`, `app/package-lock.json`
- **Description:** Core security dependency `@selfxyz/agent-sdk` is pinned to pre-release `0.1.0-alpha.1`; no documented SCA gate in repo.
- **Recommendation:** Introduce automated dependency scanning (npm audit/Snyk/OSV), pin trusted versions, and maintain SBOM.

---

## Attack Tree (Highest-Risk Paths)

```text
Compromise identity/API trust
├── Abuse unauthenticated MCP endpoint
│   ├── Call self_sign_request to generate trusted headers
│   ├── Call self_authenticated_fetch for SSRF/internal discovery
│   └── Automate self_register_agent/self_deregister_agent workflows
├── Steal or replay session token
│   ├── Obtain ?token= from logs/history/referrer/screenshots
│   ├── Poll status/export endpoints
│   └── Recover agent private key (agent-identity/wallet-free modes)
└── Exhaust service availability
    ├── Trigger Upstash degradation → memory fallback bypass
    ├── Flood AA proxy with near-limit requests across instances
    └── Hold outbound upstream calls open (no fetch timeouts)
```

---

## Remediation Roadmap (Prioritized)

### Quick wins (1–3 days)
1. Add MCP authentication middleware + tool-level authorization.
2. Disable or hard-restrict `self_authenticated_fetch` with URL allowlist.
3. Enable replay protection in MCP verify handler.
4. Enforce byte-based body limits (`Buffer.byteLength`) and JSON content-type checks.
5. Add timeout wrappers for all external `fetch()` calls.

### Near-term (3–7 days)
1. Move session tokens from query params to Authorization header/cookie.
2. Remove private key material from transport token payload; replace with short opaque handle.
3. Add strict callback payload schemas and request size caps.
4. Add degraded-mode circuit breakers for securityStore outages.

### Architectural (1–3 weeks)
1. Introduce one-time token consumption and stage transition monotonicity checks.
2. Add signed initiation challenge for deregistration.
3. Centralize security telemetry (failed auth/replay/rate-limit) with alerting.
4. Formalize threat model and regression tests for replay/race conditions.

---

## STRIDE Threat Model Update (By Component)

### Agent Registration / Deregistration
- **S:** Session token theft can spoof flow ownership.
- **T:** Weak callback schema allows ambiguous stage mutation.
- **R:** Limited audit trail around state transitions.
- **I:** Query token exposure leaks sensitive session data.
- **D:** Session flood + callback payload size abuse.
- **E:** Deregister initiation without caller key proof.

### Agent Verification APIs
- **S:** Header replay if relying party skips replay guard.
- **T:** Path params mostly validated; low tampering risk.
- **R:** Minimal per-request forensic metadata in responses.
- **I:** Public agent/sybil data intentionally exposed.
- **D:** RPC dependency can be polled aggressively.
- **E:** Limited due to read-only behavior.

### AA Proxy (Token/Bundler/Paymaster)
- **S:** IP/UA binding can be brittle behind proxies.
- **T:** Method allowlists reduce RPC tampering.
- **R:** Missing explicit `Retry-After` header consistency.
- **I:** Token errors may disclose policy behavior.
- **D:** No fetch timeout + distributed RL bypass in degraded mode.
- **E:** Cross-endpoint token confusion risk currently low due chain binding and endpoint-specific header gate.

### MCP Endpoint
- **S:** No auth enables impersonated callers.
- **T:** Arbitrary fetch URL allows SSRF-style control.
- **R:** Tool invocation identity not established.
- **I:** Internal resource access via SSRF.
- **D:** Open endpoint can be abused for compute/network costs.
- **E:** Callers can invoke privileged identity operations.

---

## Hardening Checklist (Immediate)

- [ ] Require MCP auth (API key/JWT) and per-tool ACL.
- [ ] Disable `self_authenticated_fetch` by default, or enforce strict egress allowlist.
- [ ] Set `replayProtection(true)` in MCP verify handler.
- [ ] Enforce `Content-Type: application/json` where JSON is expected.
- [ ] Use `Buffer.byteLength` for body size checks.
- [ ] Add `AbortSignal.timeout(...)` to all external fetches.
- [ ] Add explicit timestamp skew checks in `replayGuard`.
- [ ] Prevent sensitive session tokens in URL query for state-changing endpoints.
- [ ] Avoid embedding private key material in client-transported token payloads.
- [ ] Standardize 429 responses with `Retry-After` header.
- [ ] Add security event logging with sensitive-field redaction.
- [ ] Add CI SCA scanning + dependency update policy.

---

## Notes on Intentional Design Decisions

The following were treated as acknowledged architecture choices per request and therefore not independently raised as defects unless exploitable coupling existed:

- Stateless encrypted session tokens.
- Wildcard CORS on public read-only data.
- 30-minute session TTL without revocation.
- In-memory rate-limit fallback.
- Demo endpoints present in production.
