# ESLint 9 + Prettier for TypeScript — Implementation Status

Branch: `justin/add-ts-linting-prettier`
Last updated: 2026-02-26

## Scope

TypeScript only (`app/`, `typescript-sdk/`, `functions/`). Python/Rust/Solidity planned for a future PR.

---

## Current Status

| Check                           | Result                 |
| ------------------------------- | ---------------------- |
| `npx eslint .`                  | 0 errors, 247 warnings |
| `npx prettier --check .`        | All files pass         |
| `cd app && npm run build`       | Next.js build succeeds |
| `cd app && npm test`            | 205/205 pass           |
| `cd typescript-sdk && npm test` | 84/84 pass             |

### Warning breakdown (247 total — all `no-unsafe-*`)

| Rule                      | Count |
| ------------------------- | ----- |
| `no-unsafe-member-access` | 109   |
| `no-unsafe-assignment`    | 62    |
| `no-unsafe-argument`      | 37    |
| `no-unsafe-call`          | 32    |
| `no-unsafe-return`        | 7     |

All remaining warnings are `no-unsafe-*` from typed contract return values and REST API response parsing in the app layer. These will be resolved as the codebase is incrementally typed.

---

## What Was Done

### Phase 0: Config setup (prior work)

| File                | Purpose                                                                               |
| ------------------- | ------------------------------------------------------------------------------------- |
| `package.json`      | Shared devDeps: eslint 9, typescript-eslint 8, prettier 3, react plugins              |
| `eslint.config.mjs` | Flat config with `recommendedTypeChecked`, React overlay for `.tsx`, test relaxations |
| `.prettierrc`       | Codifies existing style (double quotes, semis, 2-space indent, trailing commas)       |
| `.prettierignore`   | Excludes contracts/, python-sdk/, rust-sdk/, lock files, binaries                     |
| `.editorconfig`     | 2-space indent, UTF-8, LF, trailing newline                                           |

### Phase 1: Fix warnings (1063 → 247)

**Rules fixed to zero (now promoted to `error`):**

| Rule                             | Was | Fix approach                                            |
| -------------------------------- | --- | ------------------------------------------------------- |
| `no-unused-vars`                 | 10  | Removed/prefixed with `_`                               |
| `require-await`                  | 63  | Removed `async` from 15 OPTIONS route handlers + others |
| `no-floating-promises`           | 120 | Script-automated `void` prefix; test override           |
| `no-misused-promises`            | 24  | Script-automated handler wrapping + manual fixes        |
| `no-redundant-type-constituents` | 7   | Changed to `(string & {})` pattern                      |
| `restrict-template-expressions`  | 1   | Wrapped with `String()`                                 |
| `prefer-promise-reject-errors`   | 1   | Used `new Error()`                                      |
| `unbound-method`                 | 3   | Test override                                           |

**`no-unsafe-*` reduction (830 → 247):**

- Created typed contract interfaces (`TypedRegistryContract`, `TypedProviderContract`, etc.) in `typescript-sdk/src/contract-types.ts` and `app/lib/contract-types.ts`
- Added `typedRegistry()`, `typedProvider()`, `typedDemoVerifier()`, `typedGate()` helper constructors
- Replaced 38 `new ethers.Contract(...)` calls with typed helpers across all packages
- Removed unnecessary `as Promise<>` type assertions
- Removed numeric index fallbacks on typed `AgentCredentials`

### Phase 2: Re-enable `.well-known/`

- Removed from global ignores in `eslint.config.mjs`
- Added targeted `disableTypeChecked` override (bracket paths not found by TS project service)
- Fixed `consistent-type-imports` error and removed unnecessary `async`
- `@next/eslint-plugin-next` remains deferred until Next 15 upgrade

### Phase 3: CI integration

- Created `.github/workflows/lint.yml` with TypeScript lint & format job
- Runs `prettier --check .` and `eslint .` on PRs to main

---

## Rules Summary

### Errors (enforced — zero violations)

| Rule                             | Scope        |
| -------------------------------- | ------------ |
| `consistent-type-imports`        | All TS files |
| `no-import-type-side-effects`    | All TS files |
| `no-require-imports`             | All TS files |
| `require-await`                  | All TS files |
| `no-floating-promises`           | All TS files |
| `no-misused-promises`            | All TS files |
| `no-redundant-type-constituents` | All TS files |
| `unbound-method`                 | All TS files |
| `restrict-template-expressions`  | All TS files |
| `prefer-promise-reject-errors`   | All TS files |
| `prefer-const`                   | All TS files |

### Warnings (to be promoted as violations reach zero)

| Rule                      | Count | Root cause                               |
| ------------------------- | ----- | ---------------------------------------- |
| `no-unsafe-member-access` | 109   | Untyped REST API / SDK response parsing  |
| `no-unsafe-assignment`    | 62    | `any` propagation from API responses     |
| `no-unsafe-argument`      | 37    | Passing `any` to typed parameters        |
| `no-unsafe-call`          | 32    | Calling methods on `any`-typed values    |
| `no-unsafe-return`        | 7     | Returning `any` from typed functions     |
| `no-explicit-any`         | warn  | Gradual typing in progress               |
| `ban-ts-comment`          | warn  | Some legitimate `@ts-expect-error` usage |

### Test file overrides (relaxed)

Tests (`**/*.test.ts`, `**/*.spec.ts`) disable: `no-explicit-any`, `no-unsafe-*`, `require-await`, `no-floating-promises`, `await-thenable`, `unbound-method`.

---

## ESLint Config Design Decisions

| Decision                                          | Rationale                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `recommendedTypeChecked` (not just `recommended`) | Catches real bugs (`no-floating-promises`, `no-misused-promises`), worth the slower first run |
| `projectService: true`                            | Auto-discovers each package's tsconfig, no manual per-package config                          |
| `no-unsafe-*` as warn (not error)                 | 247 remaining violations, blocking on these would prevent adoption                            |
| `consistent-type-imports` as error                | Auto-fixable, enforces clean import hygiene going forward                                     |
| `disallowTypeAnnotations: false`                  | Allows `import("module").Type` syntax which can't be auto-fixed                               |
| `allowEmptyCatch: true`                           | Codebase uses intentional empty catches for optional contract reads                           |
| `no-control-regex: off`                           | Binary data parsing uses control characters in regexes intentionally                          |
| React rules scoped to `app/**/*.tsx` only         | Avoids false positives in non-React packages                                                  |
| Test files relax `no-unsafe-*` to off             | Tests legitimately use `any` for mocking                                                      |
| `.well-known/` uses `disableTypeChecked`          | Bracket notation in Next.js dynamic routes breaks `projectService`                            |

---

## Commands

```bash
# From repo root
npm run lint          # eslint .
npm run lint:fix      # eslint . --fix
npm run format        # prettier --write .
npm run format:check  # prettier --check .
```

---

## Files Created/Modified

### New files

| File                                   | Purpose                                     |
| -------------------------------------- | ------------------------------------------- |
| `typescript-sdk/src/contract-types.ts` | Typed contract interfaces + helper fns      |
| `app/lib/contract-types.ts`            | App-layer typed contract interfaces         |
| `.github/workflows/lint.yml`           | CI lint & format pipeline                   |
| `scripts/fix-lint-warnings.mjs`        | Automated void/handler wrapping             |
| `scripts/apply-typed-contracts.mjs`    | Automated Contract → typed helper migration |

### Key modified files

- `eslint.config.mjs` — test overrides, .well-known override, rule promotions
- `typescript-sdk/src/constants.ts` — added `isProofFresh` to REGISTRY_ABI
- `app/lib/constants.ts` — added missing methods to app REGISTRY_ABI
- `typescript-sdk/src/index.ts` — exported typed contract helpers
- ~30 route/page files — typed contracts, void wrappers, handler fixes
