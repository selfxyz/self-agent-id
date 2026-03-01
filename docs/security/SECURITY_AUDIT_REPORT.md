# Self Agent ID API Security Audit Report

Date: February 25, 2026
Scope: Next.js App Router API under `app/app/api/*` and security libraries under `app/lib/*`
Reviewer mode: Read-only audit (no code modifications)

## Findings (Critical to Informational)

### 1. Critical: Unauthenticated MCP endpoint exposes privileged identity operations

- Severity: Critical
- Location:
  - `app/app/api/mcp/route.ts:15`
  - `app/app/api/mcp/route.ts:237`
  - `app/lib/mcp/config.ts:24`
  - `app/lib/mcp/handlers/auth.ts:35`
  - `app/lib/mcp/handlers/identity.ts:199`
- Description: `/api/mcp` has no authentication gate. If `SELF_AGENT_PRIVATE_KEY` is configured, any remote caller can invoke tools that sign requests or trigger deregistration flows using the server's identity.
- Attack Scenario: An attacker invokes MCP tool `self_sign_request` to mint valid `x-self-agent-*` headers and impersonates your trusted agent to downstream services.
- Impact: Integrity/authentication compromise across systems trusting Self-agent headers; service abuse potential.
- Recommendation: Require strong authentication on MCP (API key + HMAC, OAuth, or mTLS), enforce per-tool authorization for privileged actions, and default-deny tool registration unless explicitly enabled for authorized callers.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H`

### 2. High: MCP `self_authenticated_fetch` is an unauthenticated SSRF/open-proxy primitive

- Severity: High
- Location:
  - `app/lib/mcp/handlers/auth.ts:64`
  - `app/app/api/mcp/route.ts:97`
- Description: The tool accepts arbitrary URLs and performs server-side fetches, returning response body content.
- Attack Scenario: Attacker uses MCP to request internal/admin endpoints or high-cost third-party resources through your infrastructure.
- Impact: Confidentiality exposure (internal data), availability and cost abuse.
- Recommendation: Block private/internal CIDRs, enforce domain allowlist, cap response size, and require authenticated caller identities with per-tool scopes.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:L/A:L`

### 3. High: Session token transport in URL plus export endpoint enables agent key theft on token disclosure

- Severity: High
- Location:
  - `app/app/api/agent/register/route.ts:231`
  - `app/app/api/agent/register/status/route.ts:25`
  - `app/app/api/agent/register/callback/route.ts:20`
  - `app/lib/session-token.ts:17`
  - `app/lib/session-token.ts:98`
  - `app/app/api/agent/register/export/route.ts:63`
- Description: Registration tokens are passed in query parameters across routes. For `agent-identity` and `wallet-free` modes, token payload includes `agentPrivateKey`; export endpoint returns it after completion.
- Attack Scenario: Token leaks via logs/history/referer/screenshot; attacker polls status and calls export before expiry.
- Impact: Full agent identity compromise (confidentiality and integrity).
- Recommendation: Eliminate query-param tokens for sensitive flows; use `Authorization: Bearer` or HttpOnly cookie, make export one-time with nonce/audience binding, and avoid storing private key material in transport tokens.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:R/S:U/C:H/I:H/A:L`

### 4. High: `/api/demo/chat` allows anonymous upstream invocation with no rate limit

- Severity: High
- Location:
  - `app/app/api/demo/chat/route.ts:34`
  - `app/app/api/demo/chat/route.ts:84`
- Description: Unsigned requests are accepted and forwarded to LangChain backend.
- Attack Scenario: Botnet spams endpoint, consuming model/backend quota and saturating service.
- Impact: Availability and cost exposure.
- Recommendation: Require signatures in production, enforce strict rate limits and quotas.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`

### 5. Medium: Replay guard can be poisoned (unbounded future timestamps and ordering issue in chain-verify path)

- Severity: Medium
- Location:
  - `app/lib/replayGuard.ts:91`
  - `app/lib/replayGuard.ts:98`
  - `app/app/api/demo/chain-verify/route.ts:155`
  - `app/app/api/demo/chain-verify/route.ts:196`
- Description: Replay guard does not reject stale/future timestamps; TTL can be attacker-inflated. In `demo/chain-verify`, replay state is recorded before header-signature verification.
- Attack Scenario: Attacker submits arbitrary signature with far-future timestamp to create long-lived replay keys and consume store capacity.
- Impact: Availability/cost degradation and replay-control weakening.
- Recommendation: Enforce strict timestamp window (`abs(now - ts) <= maxAge`), hard-cap TTL, and always verify signature before replay-store write.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:M`

### 6. Medium: Callback proof payload accepted with minimal validation and stored in session token

- Severity: Medium
- Location:
  - `app/app/api/agent/register/callback/route.ts:52`
  - `app/app/api/agent/register/callback/route.ts:72`
  - `app/app/api/agent/deregister/callback/route.ts:52`
  - `app/app/api/agent/deregister/callback/route.ts:59`
- Description: Any non-empty JSON is treated as proof and persisted; no schema validation or callback authenticity.
- Attack Scenario: With token access, attacker can push misleading stage transitions or oversized payloads.
- Impact: Integrity confusion and DoS potential.
- Recommendation: Add signed callback verification, strict JSON schema, stage-transition constraints, and body size caps.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:M`

### 7. Medium: AA proxy origin/IP controls are bypass-prone as authentication boundaries

- Severity: Medium
- Location:
  - `app/lib/aaProxyAuth.ts:59`
  - `app/lib/aaProxyAuth.ts:79`
  - `app/app/api/aa/token/route.ts:18`
- Description: Origin check is header-based and not strong client auth; IP binding depends on forwarded header parsing.
- Attack Scenario: Non-browser client forges accepted headers to obtain AA tokens and abuse proxy endpoints.
- Impact: Abuse/cost risk and weaker abuse controls.
- Recommendation: Use cryptographic client auth challenge for AA token issuance, trusted platform IP extraction, and strict origin allowlist enforcement.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:M`

### 8. Medium: Wildcard CORS applied globally to state-changing agent endpoints

- Severity: Medium
- Location:
  - `app/lib/agent-api-helpers.ts:50`
  - `app/lib/agent-api-helpers.ts:51`
- Description: `Access-Control-Allow-Origin: *` is used for write endpoints, not only read-only public data.
- Attack Scenario: Malicious sites can orchestrate registration/deregistration flows from victim browsers and read responses.
- Impact: Workflow abuse and phishing surface expansion.
- Recommendation: Restrict CORS on state-changing routes to explicit allowed origins; keep wildcard only for explicitly public read-only endpoints.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:L/A:N`

### 9. Medium: No explicit outbound timeouts on critical external calls

- Severity: Medium
- Location:
  - `app/app/api/aa/bundler/route.ts:131`
  - `app/app/api/aa/paymaster/route.ts:127`
  - `app/app/api/demo/chat/route.ts:84`
  - `app/lib/securityStore.ts:44`
- Description: External fetches rely on platform timeout behavior.
- Attack Scenario: Slow upstreams pin serverless concurrency.
- Impact: Availability degradation.
- Recommendation: Add `AbortController` timeouts and bounded retries for all outbound calls.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:M`

### 10. Low: Demo chain-verify limiter is per-instance in-memory

- Severity: Low
- Location:
  - `app/app/api/demo/chain-verify/route.ts:22`
- Description: Demo limiter state is process-local and bypassable in horizontal scale.
- Attack Scenario: Attacker distributes requests across instances to bypass 3/hour cap.
- Impact: Abuse control degradation.
- Recommendation: Move limiter to shared store (Upstash) with atomic operations.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`

### 11. Low: Upstash `INCR` plus conditional `PEXPIRE` is not atomic

- Severity: Low
- Location:
  - `app/lib/securityStore.ts:110`
  - `app/lib/securityStore.ts:113`
- Description: Failure between `INCR` and `PEXPIRE` can leave counters without TTL.
- Attack Scenario: Sticky rate-limit keys persist longer than intended.
- Impact: Availability and operational correctness risk.
- Recommendation: Use single atomic Lua script or transaction to set/increment with TTL.
- CVSS 3.1: `AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:L/A:L`

### 12. Informational: Core crypto usage is mostly sound, but secret hygiene requirements are under-specified

- Severity: Informational
- Location:
  - `app/lib/session-token.ts:34`
  - `app/lib/session-token.ts:41`
  - `app/lib/aaProxyAuth.ts:135`
  - `app/.env.example:41`
- Description: AES-256-GCM and HMAC comparison patterns are structurally correct. SHA-256 KDF approach is acceptable only with high-entropy server secret; entropy requirements are not enforced.
- Attack Scenario: Weak operator-provided secrets reduce security margin.
- Impact: Potential reduction in cryptographic resilience.
- Recommendation: Enforce minimum secret length/entropy at startup and document `AA_PROXY_TOKEN_SECRET` requirements in `.env.example`.
- CVSS: N/A

### 13. Informational: Dependency and security test posture still need hardening depth

- Severity: Informational
- Location:
  - `app/package.json:15`
  - `app/tests/api/*.test.ts`
- Description: Core trust boundary depends on `@selfxyz/agent-sdk` alpha (`0.1.0-alpha.1`). The branch now includes broad API tests, but many security-critical paths are heavily mocked, so regressions in shared auth/replay/rate-limit primitives may still slip through.
- Attack Scenario: Shared security helper changes can pass route tests while breaking real replay/token/timeout behavior in production.
- Impact: Increased latent defect risk.
- Recommendation: Pin audited stable versions and expand low-mock security tests for `aaProxyAuth`, `replayGuard`, `securityStore`, byte-accurate body limits, and timeout behavior.
- CVSS: N/A

## Cross-Review Additions (Second Security Review Reconciliation)

### A1. Medium: MCP `self_verify_request` disables replay protection

- Severity: Medium (can be High if downstream treats MCP output as authoritative authz)
- Location:
  - `app/lib/mcp/handlers/verify.ts:172`
- Description: `handleVerifyRequest` explicitly sets `.replayProtection(false)`, so duplicate signed requests are not rejected at this layer.
- Attack Scenario: Intercepted signed request is replayed to systems relying on this MCP tool output without their own nonce/replay cache.
- Impact: Integrity risk via duplicate action execution in relying services.
- Recommendation: Enable replay protection by default (shared cache-backed), or require nonce/audience/idempotency keys in caller protocol.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N`

### A2. Medium: AA proxy body limit checks UTF-16 char count, not UTF-8 bytes

- Severity: Medium
- Location:
  - `app/app/api/aa/bundler/route.ts:120`
  - `app/app/api/aa/paymaster/route.ts:116`
- Description: `body.length` undercounts multi-byte payloads versus real transport bytes.
- Attack Scenario: Attacker crafts multi-byte body to exceed intended 200KB budget while passing local check.
- Impact: Resource abuse and potential upstream pressure.
- Recommendation: Enforce size with `Buffer.byteLength(body, "utf8")`.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L`

### A3. Low: Deregistration initiation has no caller possession proof for target agent

- Severity: Low
- Location:
  - `app/app/api/agent/deregister/route.ts:48`
  - `app/app/api/agent/deregister/route.ts:96`
- Description: Any caller can initiate a deregistration session for any verified agent address; actual completion still depends on human confirmation in Self app.
- Attack Scenario: Attacker generates convincing deregistration QR/deeplink flows for victim agents and uses social engineering.
- Impact: Primarily phishing/workflow abuse (not direct unauthorized on-chain deregistration).
- Recommendation: Require signed nonce by agent key or owner wallet before issuing deregistration session.
- CVSS 3.1: `AV:N/AC:L/PR:N/UI:R/S:U/C:N/I:L/A:N`

### Reconciliation Notes

- Strong concurrence: unauthenticated MCP exposure, SSRF risk, URL token leakage, replay/timestamp issues, outage/degraded-rate-limit concerns, and missing outbound timeouts.
- Severity nuance: I treat deregistration initiation as lower severity than direct auth bypass because Self-app confirmation remains a hard gate.
- Protocol nuance: removing MCP `DELETE` is not always safe because some MCP transport modes use it; gate it behind auth and method policy rather than blanket removal.
- Hardening stance: keep all existing routes/endpoints and apply compensating controls (authn/authz, validation, rate limits, replay defense, egress policy) rather than removing API surface.

## Attack Tree

```text
Goal: Compromise identity trust or abuse infrastructure

1) Abuse public MCP endpoint
   1.1 Invoke self_sign_request -> mint valid auth headers -> impersonate trusted agent
   1.2 Invoke self_authenticated_fetch -> SSRF/open-proxy -> exfiltration or abuse
   1.3 Exploit self_verify_request replay-disabled mode against relying services
   1.4 Trigger self_deregister_agent workflow -> social engineer owner

2) Steal registration token
   2.1 Capture token from URL/log/history/referer
   2.2 Poll register status until completed
   2.3 Call register/export -> obtain agent private key

3) Exhaust availability
   3.1 Spam demo/chat anonymous path -> saturate LangChain/backend budget
   3.2 Poison replay cache with far-future timestamps -> storage pressure
   3.3 Hold upstream calls open due to no explicit fetch timeouts
```

## Remediation Roadmap

### Immediate (same day)

1. Add an MCP authorization profile:
   - either require caller auth at transport, or
   - keep transport public-safe and require strict authz for privileged tools.
2. Enforce strict per-tool authorization for privileged MCP actions (request signing, authenticated fetch, identity-changing flows).
3. Require signed auth on `/api/demo/chat` in production and add strict rate limits.
4. Add outbound timeouts to Pimlico/LangChain/Upstash fetches.
5. Restrict CORS for state-changing routes.

### Short Term (1-3 days)

1. Move session tokens out of query params to header/cookie transport.
2. Add signed callback authenticity verification and strict schema validation.
3. Enforce replay timestamp bounds and cap replay key TTL.
4. Move demo per-human rate limits to Upstash shared state.

### Medium Term (1-2 weeks)

1. Add token audience and endpoint scoping for AA proxy tokens.
2. Add startup secret policy checks (presence, min entropy, safe defaults).
3. Build security regression suite (auth bypass, replay, SSRF, request size, timeout behavior).

## Threat Model Update (STRIDE)

### Registration/Deregistration

- Spoofing: Callback authenticity gap.
- Tampering: Stage transitions can be influenced via unvalidated payloads.
- Repudiation: Limited event-level auditing context.
- Information Disclosure: URL token leakage risk.
- Denial of Service: Large callback payload and polling pressure.
- Elevation of Privilege: Token reuse across endpoints if leaked.

### Verification and Public Read APIs

- Spoofing: Low.
- Tampering: Low.
- Repudiation: Moderate observability gaps.
- Information Disclosure: Public on-chain metadata expected.
- Denial of Service: High RPC polling potential.
- Elevation of Privilege: Low.

### AA Proxy

- Spoofing: Origin/IP checks are not strong identity.
- Tampering: Method allowlist helps.
- Repudiation: Caller attribution limited without stronger auth.
- Information Disclosure: Low direct risk.
- Denial of Service: Paid endpoint abuse.
- Elevation of Privilege: Token scope confusion risk.

### MCP Endpoint

- Spoofing: Critical if unauthenticated.
- Tampering: Tool misuse across broad capabilities.
- Repudiation: Weak user-level attribution.
- Information Disclosure: SSRF/open-proxy response leakage.
- Denial of Service: Expensive tool abuse.
- Elevation of Privilege: High with private-key tools enabled.

### Demo Endpoints

- Spoofing: Mixed (some verified, some anonymous).
- Tampering: Replay/cache abuse vectors.
- Repudiation: Minimal.
- Information Disclosure: Moderate.
- Denial of Service: Elevated.
- Elevation of Privilege: Moderate.

### Rate Limiting/Security Store

- Spoofing: Header-based IP keying limitations.
- Tampering: Low.
- Repudiation: Low.
- Information Disclosure: Low.
- Denial of Service: Fallback and non-atomic behavior under failures.
- Elevation of Privilege: Low.

## Hardening Checklist

- [ ] Define MCP access profile:
  - transport-level auth required for private deployments, or
  - public-safe transport with strict privileged-tool authz + abuse controls.
- [ ] Enforce per-tool authorization policies for privileged MCP actions.
- [ ] Classify all MCP tools/resources as `public-safe` or `privileged` (default-deny for privileged).
- [ ] Restrict/allowlist outbound URLs for authenticated fetch tooling.
- [ ] Enable replay protection for MCP `self_verify_request` or require nonce/audience binding.
- [ ] Remove query-param token transport for sensitive session endpoints.
- [ ] Enforce callback authenticity and strict JSON schema.
- [ ] Add route-level request body size caps for callback/MCP/demo routes.
- [ ] Enforce byte-based body limits (`Buffer.byteLength`) in AA proxy routes.
- [ ] Enforce strict replay timestamp window and bounded TTL.
- [ ] Add explicit fetch timeouts and retry budget controls.
- [ ] Restrict CORS on state-changing agent endpoints.
- [ ] Use trusted platform IP extraction instead of raw forwarded headers.
- [ ] Add possession-proof requirement before deregistration session issuance.
- [ ] Document and validate all required secrets (`SESSION_SECRET`, `AA_PROXY_TOKEN_SECRET`, `PIMLICO_API_KEY`).
- [ ] Move per-instance demo limiters to shared Upstash state.
- [x] Add security-focused automated tests before refactors/fixes.

## Notes

- No code changes were made in this audit pass.
- Known architecture decisions from the prompt were respected (stateless sessions, fallback behavior, etc.) unless a specific exploit path was identified.
- This report has been reconciled with subsequent branch test additions; finding #13 reflects current test posture rather than pre-test baseline.
