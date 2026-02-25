# Self Agent ID Threat Model (STRIDE)

## Scope
- Project: Self Agent ID (contracts + SDKs + demo app)
- Baseline commit: `dev` branch post-security-audit fixes (February 2026)
- Threat model date: February 25, 2026 (updated after comprehensive security audit)
- Security posture modeled for: production deployment

## Executive Summary
- STRIDE is industry-standard for software/system threat modeling (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege).
- Core cryptographic primitives are sound (ECDSA/EIP-191, EIP-712, keccak256).
- Major protocol-level weaknesses identified in the initial audit (header spoofing in chat path, canonicalization drift, replay handling gaps, open AA proxies) are now materially reduced.
- Post-audit fixes applied: EIP-712 nonce-based replay protection for setAgentWallet, int256 overflow prevention in reputation registry, proof freshness checks in all SDK verify() paths, signed-header authentication in LangChain demo, CORS hardening, rate limiting, error sanitization, and security headers.
- Remaining major risk is operational configuration drift: distributed protections exist but degrade to process-local memory when external store/secret env is missing.

## System Model
### Assets
- Agent private keys (secp256k1)
- Human proof state on registry (agentId, nullifier linkage, provider metadata)
- API trust decision (`valid` / `invalid`)
- Relayer/paymaster quotas and funds
- Optional credential disclosures (nationality, age threshold, OFAC bits, and potentially sensitive fields)

### Actors
- Honest agent client
- Honest verifier service
- Honest registry/proof-provider contracts
- External attacker (network observer/replayer, request forger, abuse bot)
- Internal operator (misconfiguration risk)

### Trust Boundaries
1. Agent client -> service API (untrusted network)
2. Service verifier -> chain RPC (external dependency)
3. Public demo endpoints -> internal infra secrets (bundler/paymaster/relayer)
4. Browser demo UI -> demo agent endpoint

### High-Level Data Flow
1. Agent signs request over `timestamp + METHOD + canonical(path+query) + bodyHash`.
2. Service verifies timestamp window, reconstructs message, recovers signer, checks on-chain agent state.
3. Service applies policy (provider match, sybil cap, credentials).
4. For agent-to-agent demo, responder signs response and caller verifies.

## STRIDE Analysis
| STRIDE | Threat in this system | Current controls | Residual risk | Priority |
|---|---|---|---|---|
| Spoofing | Fake `x-self-agent-address` or identity headers | Identity derived from signature recovery in all endpoints; LangChain demo now uses signed-header auth (EIP-191) | If private key compromised, attacker is legitimate signer | Medium |
| Tampering | Body/URL rewriting causing verifier mismatch or bypass | Canonical URL helper added across TS/Python/Rust; middleware uses raw body when possible | Intermediaries that mutate body/URL post-signing still break auth (fail-closed) | Low |
| Repudiation | Agent denies making a request | Signed request artifacts exist (signature+timestamp+message basis) | No tamper-evident centralized audit log by default | Medium |
| Information Disclosure | Sensitive credential fields publicly queryable on-chain | Optional disclosure model exists | If enabled, disclosed PII is irreversible/public | High |
| Denial of Service | Replay floods, AA proxy abuse, cache pressure | Replay detection added; AA endpoints use token gating, origin checks, method allowlists, size caps, and shared rate-limit hooks; per-IP rate limiting on register/deregister endpoints; Rust middleware enforces 1MB body limit; security headers set via next.config.mjs | If external store is not configured, fallback is per-instance memory (startup warning emitted) | Medium |
| Elevation of Privilege | Abuse relayer/paymaster endpoints as free transaction proxy | Token-bound AA proxy auth + origin checks + RPC method restrictions | Token secret misconfiguration or lax origin policy can weaken protection | Medium |

## Key Threat Scenarios (Focused)
### 1) Canonicalization Drift
- Failure mode: signer/verifier disagree about exact signed URL/body representation.
- Effect: valid users get rejected, or policies become inconsistent across stacks.
- Fix status: implemented.
  - Shared canonical rule: sign path+query, not absolute origin.
  - FastAPI middleware fixed to verify path+query.
  - Cross-language vectors updated.
- Residual: proxies/framework middleware must preserve raw body or deterministic serialization.

### 2) Replay Without Durable Replay Store
- Failure mode: captured signed request replayed within timestamp window.
- Effect: repeated unauthorized execution of same action.
- Fix status: implemented with external store support.
  - In-memory replay cache enabled by default in TS/Python/Rust verifiers.
  - Replay key now binds signature + signing message, avoiding cross-message poisoning.
  - Replay guard in chain-verify moved after signature validation to prevent cache poisoning.
  - EIP-712 `setAgentWallet` now includes nonce to prevent signature replay after wallet unset.
  - Upstash Redis support for production replay/rate-limit persistence (startup warning when absent).
- Residual: in-memory caches reset on restart and are not shared across instances when Upstash is not configured.
- Required for production: configure Upstash Redis (UPSTASH_REDIS_REST_URL/TOKEN) for durable replay/rate-limit store.

### 3) Demo Path Identity Spoofing
- Failure mode: chat API trusting caller-provided address header.
- Effect: privilege bypass in downstream agent gating.
- Fix status: implemented.
  - Chat route now verifies signature/timestamp and forwards recovered address only.
  - LangChain demo now requires signed-header auth (EIP-191 signature over request body).
  - CORS restricted to configured origins (no more wildcard).

### 4) Public Infra Abuse (Bundler/Paymaster)
- Failure mode: anonymous callers drain sponsored infra capacity.
- Effect: service degradation or cost burn.
- Fix status: mitigated.
  - Added token auth, origin checks, JSON-RPC allowlists, request throttling, and payload caps.
- Residual: distributed deployment still needs shared/global rate limiting and strong secret/origin configuration hygiene.

## Production Readiness
### Implemented
1. Replay protection enabled by default across all verifier SDKs.
2. Rate limiting on register/deregister endpoints (10 req/min per IP).
3. Signed-header authentication on all demo endpoints.
4. Security headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.).
5. Error response sanitization across all API routes.
6. Proof freshness checking in all SDK verify() paths.
7. Nonce-based EIP-712 replay protection for setAgentWallet.

### Required for multi-instance deployment
1. Configure Upstash Redis (`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) for shared replay/rate-limit state.
2. Set a stable strong `AA_PROXY_TOKEN_SECRET` and explicit origin allowlist.
3. Pin expected demo agent address via env (`NEXT_PUBLIC_DEMO_AGENT_ADDRESS_CELO*`) for peer-response identity checks.

## Residual Risk Register
- `R1` Distributed replay gap when Upstash Redis is not configured: Medium (startup warning now emitted).
- `R2` Optional on-chain PII disclosure misuse: High (inherent to credential disclosure model).
- `R3` Internet-facing AA relay path (token-gated, rate-limited, still abuse-sensitive): Medium.
- `R4` No immutable request audit pipeline: Medium.
- `R5` Expired proof agents retain soulbound NFT (historical record only, `hasHumanProof()` returns false): Low.

## Decision
- Post-audit security posture is suitable for production deployment with Upstash Redis configured.
- For single-instance deployments, in-memory fallback is acceptable with the understanding that state resets on restart.
- For multi-instance deployments, Upstash Redis is required for shared replay/rate-limit state.
