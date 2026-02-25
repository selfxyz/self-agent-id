# ESLint 9 + Prettier for TypeScript — Implementation Status

Branch: `justin/add-ts-linting-prettier`
Last updated: 2025-02-25

## Scope

TypeScript only (`app/`, `typescript-sdk/`, `functions/`). No Python/Rust/Solidity/Shell.

---

## What's Done

### Config files created at root

| File | Purpose |
|---|---|
| `package.json` | Shared devDeps: eslint 9, typescript-eslint 8, prettier 3, react plugins |
| `eslint.config.mjs` | Flat config with `recommendedTypeChecked`, React overlay for `.tsx`, test relaxations |
| `.prettierrc` | Codifies existing style (double quotes, semis, 2-space indent, trailing commas) |
| `.prettierignore` | Excludes contracts/, python-sdk/, rust-sdk/, lock files, binaries |
| `.editorconfig` | 2-space indent, UTF-8, LF, trailing newline |

### Changes to existing files

- `app/package.json` — removed `eslint` + `eslint-config-next` devDeps, removed `"lint": "next lint"` script
- `app/.eslintrc.json` — deleted (replaced by root flat config)
- 10 files — removed stale `{/* eslint-disable-next-line @next/next/no-img-element */}` comments

### Auto-fixes applied

- `eslint --fix` — `consistent-type-imports` (56), `no-unnecessary-type-assertion` (17), `no-import-type-side-effects` (1)
- `prettier --write .` — formatted all TS/JSON/MD files

### Verification (all pass)

| Check | Result |
|---|---|
| `npx eslint .` | 0 errors, 1367 warnings |
| `npx prettier --check .` | All files pass |
| `cd app && npm run build` | Next.js build succeeds |
| `cd app && npm test` | 205/205 pass |
| `cd typescript-sdk && npm test` | Pre-existing type errors (unrelated to linting changes) |

---

## Current Warning Breakdown (1367 total)

All set to `"warn"` in `eslint.config.mjs`. To be promoted to `"error"` as the codebase improves.

| Rule | Count | Root cause |
|---|---|---|
| `no-unsafe-member-access` | 558 | Untyped ethers contract return values |
| `no-unsafe-assignment` | 357 | `any` propagation from contract calls and SDK imports |
| `no-unsafe-call` | 247 | Calling methods on `any`-typed values |
| `require-await` | 64 | `async` functions that don't `await` anything |
| `no-unsafe-argument` | 59 | Passing `any` to typed parameters |
| `no-unsafe-return` | 25 | Returning `any` from typed functions |
| `no-misused-promises` | 23 | Async functions in React event handlers (`onClick={async () => ...}`) |
| `no-floating-promises` | 11 | Unhandled promise return values |
| `no-unused-vars` | 10 | Assigned but unused variables |
| `no-redundant-type-constituents` | 8 | Redundant union/intersection members |
| `restrict-template-expressions` | 1 | Unsafe value in template literal |
| `prefer-promise-reject-errors` | 1 | Rejecting with non-Error value |

---

## Remaining Work

### Phase 1: Fix warnings, promote to errors

The bulk (1246) are `no-unsafe-*` from untyped contract/SDK responses. Fix by:

1. **Type ethers contract calls** — define return types for `contract.isVerifiedAgent()`, `contract.getAgentCredentials()`, etc. instead of relying on `any`. This is the biggest win and overlaps with the API security refactor.
2. **Type Self SDK dynamic imports** — `SelfAppBuilder`, `SelfQRcodeWrapper` produce `any` via `import().then()`
3. **Fix `require-await` (64)** — remove `async` keyword from functions that don't `await`, or add the missing `await`
4. **Fix `no-misused-promises` (23)** — wrap async React event handlers: `onClick={() => void handleClick()}` or extract to named handler
5. **Fix `no-floating-promises` (11)** — add `void` operator or `.catch()` to fire-and-forget promises
6. **Fix `no-unused-vars` (10)** — prefix with `_` or remove

Once a package is clean, flip its warnings to errors via override in `eslint.config.mjs`.

### Phase 2: Re-enable ignored paths

- **`app/app/.well-known/`** — ignored because `[agentId]` brackets in directory names confuse `projectService`. Revisit after typescript-eslint update or restructure those routes.
- **`@next/eslint-plugin-next`** — dropped because flat config support is unreliable with Next 14. Re-add when upgrading to Next 15.

### Phase 3: CI integration

- Add `npm run lint` and `npm run format:check` to CI pipeline
- Add `--max-warnings 0` once all warnings are resolved

---

## ESLint Config Design Decisions

| Decision | Rationale |
|---|---|
| `recommendedTypeChecked` (not just `recommended`) | Catches real bugs (`no-floating-promises`, `no-misused-promises`), worth the slower first run |
| `projectService: true` | Auto-discovers each package's tsconfig, no manual per-package config |
| `no-unsafe-*` as warn (not error) | Codebase has ~1200 `any` usages, blocking on these would prevent adoption |
| `consistent-type-imports` as error | Auto-fixable, enforces clean import hygiene going forward |
| `disallowTypeAnnotations: false` | Allows `import("module").Type` syntax which can't be auto-fixed |
| `allowEmptyCatch: true` | Codebase uses intentional empty catches for optional contract reads |
| `no-control-regex: off` | Binary data parsing uses control characters in regexes intentionally |
| React rules scoped to `app/**/*.tsx` only | Avoids false positives in non-React packages |
| Test files relax `no-unsafe-*` to off | Tests legitimately use `any` for mocking |
| `.well-known/` in global ignores | Bracket notation in Next.js dynamic routes breaks `projectService` |

---

## Commands

```bash
# From repo root
npm run lint          # eslint .
npm run lint:fix      # eslint . --fix
npm run format        # prettier --write .
npm run format:check  # prettier --check .
```
