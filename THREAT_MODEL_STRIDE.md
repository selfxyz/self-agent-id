# Self Agent ID Threat Model (STRIDE)

## Scope
- Project: Self Agent ID (contracts + SDKs + demo app)
- Baseline commit: `d9dca40a3bf12a4d3ea2d64a7cc3ff1f9c847d30` on `dev`
- Threat model date: February 21, 2026
- Security posture modeled for: public demo exposure next week

## Executive Summary
- STRIDE is industry-standard for software/system threat modeling (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege).
- Core cryptographic primitives are sound (ECDSA/EIP-191, EIP-712, keccak256).
- Major protocol-level weaknesses identified in the initial audit (header spoofing in chat path, canonicalization drift, replay handling gaps, open AA proxies) are now materially reduced.
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
| Spoofing | Fake `x-self-agent-address` or identity headers | Identity now derived from signature recovery (chat and demo endpoints fixed) | If private key compromised, attacker is legitimate signer | Medium |
| Tampering | Body/URL rewriting causing verifier mismatch or bypass | Canonical URL helper added across TS/Python/Rust; middleware uses raw body when possible | Intermediaries that mutate body/URL post-signing still break auth (fail-closed) | Low |
| Repudiation | Agent denies making a request | Signed request artifacts exist (signature+timestamp+message basis) | No tamper-evident centralized audit log by default | Medium |
| Information Disclosure | Sensitive credential fields publicly queryable on-chain | Optional disclosure model exists | If enabled, disclosed PII is irreversible/public | High |
| Denial of Service | Replay floods, AA proxy abuse, cache pressure | Replay detection added; AA endpoints now use token gating, origin checks, method allowlists, size caps, and shared rate-limit hooks | If external store is not configured, fallback is per-instance memory | Medium |
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
- Fix status: partially implemented.
  - In-memory replay cache enabled by default in TS/Python/Rust verifiers.
  - Replay key now binds signature + signing message, avoiding cross-message poisoning.
- Residual: in-memory caches reset on restart and are not shared across instances.
- Required for production: external replay store (Redis/DB) with TTL + atomic check-and-set, and stable shared AA token secret.

### 3) Demo Path Identity Spoofing
- Failure mode: chat API trusting caller-provided address header.
- Effect: privilege bypass in downstream agent gating.
- Fix status: implemented.
  - Chat route now verifies signature/timestamp and forwards recovered address only.

### 4) Public Infra Abuse (Bundler/Paymaster)
- Failure mode: anonymous callers drain sponsored infra capacity.
- Effect: service degradation or cost burn.
- Fix status: mitigated.
  - Added token auth, origin checks, JSON-RPC allowlists, request throttling, and payload caps.
- Residual: distributed deployment still needs shared/global rate limiting and strong secret/origin configuration hygiene.

## Public Demo Readiness (Next Week)
### Must-have
1. Deploy with replay protection enabled (default is on).
2. Ensure each runtime process reuses verifier instances (implemented via cached verifier factory in app).
3. Set strict rate limits for AA routes (`AA_PROXY_MAX_REQ_PER_MINUTE`) appropriate to expected traffic.
4. Pin expected demo agent address via env (`NEXT_PUBLIC_DEMO_AGENT_ADDRESS_CELO*`) for stronger peer-response identity checks.

### Should-have
1. Configure Redis-backed replay/rate-limit store before scaling to >1 instance.
2. Set a stable strong `AA_PROXY_TOKEN_SECRET` and explicit origin allowlist.
3. Reduce verifier cache TTL for revocation-sensitive demos if RPC budget allows.

## Residual Risk Register
- `R1` Distributed replay gap when external store is absent/misconfigured: Medium-High.
- `R2` Optional on-chain PII disclosure misuse: High.
- `R3` Internet-facing AA relay path (now token-gated, still abuse-sensitive): Medium.
- `R4` No immutable request audit pipeline: Medium.

## Decision
- For a controlled public demo, current post-fix posture is acceptable if rate limits are tuned and expected demo agent address is pinned.
- For production/multi-instance rollout, Redis-backed replay/rate limits + stable AA token secret are required before claiming robust anti-replay and abuse resistance.
