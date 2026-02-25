# Linting and Formatting Implementation Spec

## 1. Purpose
Define a complete, enforceable linting and formatting system for `self-agent-id` across all maintained languages and file types, with fast local feedback and strict CI enforcement.

## 2. Goals
1. One consistent quality gate across TypeScript, Python, Rust, Solidity, shell scripts, and text/config files.
2. Fast local feedback (especially pre-commit).
3. Deterministic CI enforcement.
4. Reuse style direction from the `self` monorepo where useful.
5. Preserve current license-header behavior.

## 3. Non-Goals
1. No large refactors.
2. No ecosystem migration (for example ESLint to Biome).
3. No lint ownership of generated artifacts.
4. No licensing-policy changes.

## 4. Scope
### 4.1 In-scope file types
1. TS/JS: `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`
2. Python: `.py`
3. Rust: `.rs`
4. Solidity: `.sol`
5. Shell: `.sh`
6. Text/config: `.md`, `.json`, `.yaml`, `.yml`, `.css`
7. Optional phase 2: `.toml` (Taplo)

### 4.2 In-scope directories
1. `app/`
2. `typescript-sdk/`
3. `functions/` (while present)
4. `python-sdk/`
5. `rust-sdk/`
6. `contracts/`
7. `examples/`
8. `scripts/`

### 4.3 Out of scope
1. Vendored code: `contracts/lib/**`
2. Generated outputs (`dist`, `.next`, `target`, coverage, etc.)
3. Binary assets

## 5. Current Baseline
1. License headers are enforced by Python scripts and a pre-commit hook.
2. TypeScript linting is mostly limited to `app` via `next lint`.
3. No root Prettier baseline.
4. Python has tests but no enforced formatter/linter policy.
5. Rust fmt/clippy are not globally enforced.
6. Solidity format config exists (Foundry), but no repo-wide orchestration.
7. No unified CI workflow for multi-language lint/format.

## 6. Design Principles
1. Bash orchestration, language-native tools for checks.
2. Fail-fast CI, fast pre-commit.
3. Deterministic and idempotent commands.
4. Clear source-vs-generated ownership.
5. Minimal, auditable config surface.

## 7. Tooling Decisions
### 7.1 TypeScript/JavaScript
1. ESLint for semantic linting.
2. Prettier for formatting.
3. Keep Next baseline in `app`, add selected monorepo-inspired rules:
   - import sorting
   - no duplicate imports
   - `@typescript-eslint/consistent-type-imports`
4. Add lint/format support to `typescript-sdk` (and `functions` if still active).

### 7.2 Python
1. Ruff for lint + format (`ruff check`, `ruff format`).
2. Configure in `python-sdk/pyproject.toml`.

### 7.3 Rust
1. `cargo fmt --check`
2. `cargo clippy --all-targets --all-features -- -D warnings`

### 7.4 Solidity
1. `forge fmt --check`
2. Keep Foundry as sole formatter authority for `.sol`.

### 7.5 Shell
1. `shfmt -d` for formatting checks.
2. `shellcheck` for linting.

### 7.6 Text/config
1. Prettier for `.md`, `.json`, `.yaml`, `.yml`, `.css`.
2. Optional phase 2: Taplo for TOML.

## 8. Config Artifacts to Add
1. Root `.editorconfig`
2. Root `.prettierrc` (aligned with monorepo style direction)
3. Root `.prettierignore`
4. ESLint config(s) for `typescript-sdk` (and optionally `functions`)
5. Ruff config block in `python-sdk/pyproject.toml`
6. Optional phase 2: `taplo.toml`

## 9. Script Contracts (root `scripts/`)
### 9.1 `scripts/format-all.sh`
Mutating formatter pass:
1. Prettier write for eligible files.
2. `ruff format` in `python-sdk`.
3. `cargo fmt` in `rust-sdk`.
4. `forge fmt` in `contracts`.
5. `shfmt -w` on tracked shell scripts.
6. Exclude generated/vendor paths.

### 9.2 `scripts/lint-all.sh`
Non-mutating full gate:
1. `python3 scripts/lint-headers.py`
2. Prettier check
3. ESLint in each TS package
4. `ruff check` and `ruff format --check`
5. `cargo fmt --check` and clippy
6. `forge fmt --check`
7. `shfmt -d` and `shellcheck`
8. Fail non-zero on any violation

### 9.3 `scripts/lint-staged.sh`
Fast pre-commit checks:
1. Discover staged files.
2. Route by extension.
3. Run targeted checks only.
4. Skip heavy whole-crate checks (clippy) locally.

## 10. Git Hook Policy
Update `.githooks/pre-commit` to run:
1. `python3 scripts/lint-headers.py`
2. `scripts/lint-staged.sh`

## 11. CI Policy
Create `.github/workflows/lint.yml` with required jobs:
1. `headers`
2. `lint-format` (full `scripts/lint-all.sh`)

Implementation notes:
1. Cache npm/pip/cargo/foundry dependencies.
2. Pin major versions for CI-critical tools.
3. Keep required checks strict.

## 12. Rollout Plan
### Phase 1: Foundation
1. Add root formatting configs.
2. Add `format-all.sh`, `lint-all.sh`, `lint-staged.sh`.
3. Verify license-header flow unchanged.

### Phase 2: TypeScript hardening
1. Strengthen `app` ESLint rules.
2. Add lint/format scripts for TS SDKs.
3. Ensure deterministic check/fix behavior.

### Phase 3: Python/Rust/Solidity/Shell
1. Enable Ruff.
2. Enforce Rust fmt/clippy.
3. Enforce Solidity fmt check.
4. Add shell checks.

### Phase 4: Hook + CI
1. Wire pre-commit to staged lint checks.
2. Add CI required jobs.

### Phase 5: Baseline formatting commit
1. Single formatting-only commit after tooling lands.
2. Follow-up cleanup for rule exceptions.

## 13. Severity Strategy
1. Formatting and deterministic correctness checks default to error.
2. Noisy rules can start as warnings during onboarding.
3. Ratchet warnings to errors after baseline cleanup.

## 14. Ignore Policy
Exclude from lint/format ownership:
1. `**/node_modules/**`
2. `**/dist/**`
3. `**/.next/**`
4. `**/target/**`
5. `contracts/lib/**`
6. Coverage/build outputs
7. Binary assets

## 15. Operational Requirements
1. Scripts use `set -euo pipefail`.
2. Commands are CI-safe and deterministic.
3. Missing tool errors include install guidance.
4. README documents format/lint/hook/CI commands.

## 16. Risks and Mitigations
1. Large first-format diff.
   - Mitigation: dedicated format-only commit.
2. Slow pre-commit.
   - Mitigation: staged-only checks.
3. Developer friction from strictness.
   - Mitigation: phased severity ratchet.
4. Directory churn (`functions/`).
   - Mitigation: conditionally skip absent paths.

## 17. Definition of Done
1. `scripts/format-all.sh` exists and works.
2. `scripts/lint-all.sh` gates all in-scope languages.
3. Pre-commit runs headers + staged checks.
4. CI enforces full lint/format.
5. README quality section is updated.
6. Baseline format-only commit is isolated.

## 18. Implementation Checklist
1. Add `.editorconfig`
2. Add `.prettierrc`
3. Add `.prettierignore`
4. Add/update ESLint configs + scripts
5. Add Ruff config
6. Add `scripts/format-all.sh`
7. Add `scripts/lint-all.sh`
8. Add `scripts/lint-staged.sh`
9. Update pre-commit hook
10. Add CI workflow
11. Update README quality docs
12. Run baseline format-only commit

## 19. Tool Viability and Support Status (as of 2026-02-25)
Summary: recommended tools are active and appropriate.

Active choices:
1. ESLint (current major v9)
2. Prettier (3.x)
3. typescript-eslint
4. Ruff
5. rustfmt + Clippy
6. Foundry/forge fmt
7. shfmt + ShellCheck
8. Taplo (optional)

Repository support gap to resolve:
1. `app` currently on `eslint@8` + Next 14.
2. Upgrade track required before final strict TS CI gating in `app`:
   - move `app` to supported Next major
   - move ESLint config/tooling to v9 compatibility
   - revalidate `next lint` behavior

## 20. Ownership and Governance
1. Assign one primary and one backup owner for lint infra.
2. Assign language reviewers (TS/Python/Rust/Solidity).
3. Rule severity increases require explicit PR note and clean default-branch CI.
4. New lint tools require rationale, runtime estimate, and rollback plan.

## 21. Version Pinning and Update Cadence
1. Pin major versions for CI-critical tools.
2. Prefer reproducible installs via lockfiles.
3. Monthly health check and quarterly planned upgrades.

## 22. Exceptions Process
1. Temporary disables must include inline rationale, owner, and removal target date.
2. Directory exclusions require issue link and expiry date.
3. No permanent blanket disable of core correctness rules.
4. No silent CI bypasses.

## 23. Success Metrics
1. PR failure rate due to lint/format (should trend down in first month).
2. Median pre-commit runtime target: < 15s on staged deltas.
3. Median CI lint runtime target: < 8m with warm cache.
4. Active exception count should trend to zero.
5. Near-zero post-merge style-fix PRs.

## 24. Directory Lifecycle Note (`functions/`)
`functions/` is in scope while present. If removed, update:
1. Root lint scripts
2. Package install/lint invocations
3. README quality docs and CI matrix
