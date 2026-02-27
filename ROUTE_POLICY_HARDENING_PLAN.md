# RoutePolicy Hardening Plan (Next.js App Router)

Date: 2026-02-25  
Status: Phase 0 complete (205 tests, 14 files); ready for Phase 1

## 1. Why this is worth it here

Yes, this is worth it for this codebase.

Current routes repeat security-critical logic (body parsing, limits, auth checks, replay/rate limit behavior, error mapping). That creates drift risk: one route gets a fix, sibling routes miss it. A shared RoutePolicy layer gives:

- Consistent security defaults
- Fewer one-off bugs
- Easier audits and onboarding
- Faster rollout of future hardening

## 2. Design goals

1. Centralize cross-cutting controls (not business logic).
2. Keep registration/deregistration state transitions explicit and local.
3. Make route security posture obvious from one policy object.
4. Preserve existing route surface (hardening-only, no endpoint removal).

## 3. Non-goals

1. Do not hide complex state machine transitions behind generic middleware.
2. Do not force a one-size-fits-all auth path for every route.
3. Do not over-abstract on day one; migrate in phases.

## 4. Proposed architecture

Use a higher-order route wrapper (composition, not inheritance):

```ts
export const POST = createApiRoute(policy, async (ctx) => {
  // route-specific business logic only
});
```

### 4.1 Core types

```ts
type AuthMode =
  | "none"
  | "sessionToken"
  | "aaProxyToken"
  | "agentHeaders"
  | "mcpAuth";

interface RoutePolicy {
  name: string;
  methods: Array<"GET" | "POST" | "PUT" | "DELETE" | "OPTIONS">;
  corsProfile: "public-read" | "stateful-write" | "same-origin" | "disabled";
  auth: {
    mode: AuthMode;
    required?: boolean;
  };
  body?: {
    requireJson?: boolean;
    maxBytes?: number;
  };
  validation?: {
    querySchema?: unknown; // zod schema
    paramsSchema?: unknown; // zod schema
    bodySchema?: unknown; // zod schema
  };
  rateLimit?: {
    key: (ctx: RouteContext) => string;
    limit: number;
    windowMs: number;
    failMode?: "degraded-allow" | "degraded-tight-limit" | "fail-closed";
  };
  replay?: {
    enabled: boolean;
    scope: string;
    maxAgeMs?: number;
    requireSignatureFirst?: boolean;
  };
  upstream?: {
    timeoutMs?: number;
  };
}
```

## 5. Shared modules to add

Suggested file layout:

- `app/lib/http/createApiRoute.ts`
- `app/lib/http/errors.ts`
- `app/lib/http/response.ts`
- `app/lib/http/body.ts` (byte limit + JSON parsing + content-type checks)
- `app/lib/http/auth.ts` (session / AA / agent headers / MCP auth adapters)
- `app/lib/http/rateLimit.ts` (wrapper over existing `checkRateLimit`)
- `app/lib/http/replay.ts` (wrapper over existing `checkAndRecordReplay`)
- `app/lib/http/fetch.ts` (`fetchWithTimeout`, standard retries)
- `app/lib/http/policies.ts` (reusable policy presets)

## 6. Default behavior (secure-by-default)

1. Reject unsupported methods with 405.
2. Enforce content-type for JSON bodies when `requireJson=true`.
3. Enforce byte-based body limit (`Buffer.byteLength(..., "utf8")`).
4. Add consistent error envelope:
   - `{ error: { code, message, requestId } }`
5. Add consistent security logging with redaction for:
   - tokens, signatures, private keys, auth headers
6. Standardize 429 responses with `Retry-After`.
7. Apply outbound timeout defaults for all upstream calls.

## 7. Explicit anti-over-DRY boundaries

Keep these out of generic middleware:

1. Register/deregister stage machine transitions.
2. On-chain state transition decisions.
3. Route-specific human-facing messages/instructions.

Instead, put those in focused domain helpers:

- `registrationStateMachine.ts`
- `deregistrationStateMachine.ts`

## 8. Route families and target policy profiles

1. Public read routes (`/api/agent/info`, `/verify-status`, `/cards`, `/reputation`)
   - `auth: none`
   - `corsProfile: public-read`
   - strict params validation
2. Registration/deregistration write routes
   - `auth: sessionToken` where applicable
   - strict body schema + size caps
   - stateful-write CORS profile
3. AA proxy routes
   - `auth: aaProxyToken`
   - strict body bytes + method allowlist
   - rate limit + upstream timeout
4. Demo routes
   - agentHeaders auth required in production profile
   - replay + rate limits
5. MCP route
   - `auth: mcpAuth` mandatory
   - per-tool authorization and egress policy checks

## 9. Migration plan (phased)

### Phase 0: Tests first (complete)

1. Lock behavior with integration tests per route family.
2. Add negative tests: auth bypass, replay, oversized body, invalid content-type, timeout handling.
3. **Important:** Add explicit gap-tracking markers in Phase 0 tests for known security issues (e.g., `body.length` char-count instead of byte-count, wildcard CORS, missing MCP auth), using comments like `// SECURITY_GAP: Finding #N — ...`. These tests may assert **current insecure behavior** during baseline capture. When the corresponding hardening fix lands, the test should fail and then be updated to assert the new secure behavior; replace the marker with `// SECURITY_FIX: Finding #N — hardened in Phase N`.

### Phase 1: Build primitives without changing route behavior

1. Implement `createApiRoute` + body/error/timeout helpers.
2. Add policy presets and no-op wrappers.

### Phase 2: Pilot on AA routes (best first migration)

1. Migrate `/api/aa/token`, `/api/aa/bundler`, `/api/aa/paymaster`.
2. Validate no behavior regression and improved consistency.

### Phase 3: Migrate callback/status routes

1. Add strict body schemas and byte limits.
2. Keep state transitions in local route/domain helpers.

### Phase 4: Migrate demo + MCP routes

1. Add mandatory MCP auth adapter.
2. Add replay defaults and egress restrictions.

### Phase 5: Cleanup

1. Remove duplicated inline guard logic.
2. Update security docs and threat model references.

## 10. Acceptance criteria

1. 100% API routes use `createApiRoute` (or documented exception).
2. All JSON routes enforce content-type + byte limit.
3. All upstream fetches go through timeout wrapper.
4. All auth-required routes declare auth mode in policy.
5. Security regression tests pass for all route families.

## 11. Risks and mitigations

1. Risk: Middleware abstraction obscures route intent.
   - Mitigation: keep policy object short and explicit; keep business logic in route.
2. Risk: Regression during migration.
   - Mitigation: phased rollout + route family tests + pilot first.
3. Risk: Overly strict defaults break clients.
   - Mitigation: opt-in per family during migration, then tighten defaults.

## 12. Recommended next step

Start with Phase 2 (AA routes) as the pilot migration. They are compact, high-risk, and ideal for validating the RoutePolicy pattern before touching registration state flows.
