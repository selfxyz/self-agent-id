#!/usr/bin/env node
/**
 * Automated ESLint warning fixer for mechanical patterns.
 *
 * Handles:
 *  - no-floating-promises: adds `void` prefix to fire-and-forget calls
 *  - no-misused-promises: wraps async onClick/onChange/onSubmit handlers
 *
 * Usage: node scripts/fix-lint-warnings.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY_RUN = process.argv.includes("--dry-run");

// ─── Step 1: Get warnings from ESLint ──────────────────────────────────────

console.log("Running ESLint to collect warnings...");
const raw = execSync("npx eslint . -f json 2>/dev/null", {
  encoding: "utf8",
  maxBuffer: 50 * 1024 * 1024,
});
const results = JSON.parse(raw);

// Group warnings by file
const warningsByFile = new Map();
for (const file of results) {
  for (const msg of file.messages) {
    if (
      msg.ruleId === "@typescript-eslint/no-floating-promises" ||
      msg.ruleId === "@typescript-eslint/no-misused-promises"
    ) {
      if (!warningsByFile.has(file.filePath)) {
        warningsByFile.set(file.filePath, []);
      }
      warningsByFile.get(file.filePath).push(msg);
    }
  }
}

console.log(
  `Found ${[...warningsByFile.values()].flat().length} warnings in ${warningsByFile.size} files`,
);

let totalFixed = 0;

// ─── Step 2: Fix each file ─────────────────────────────────────────────────

for (const [filePath, warnings] of warningsByFile) {
  const original = readFileSync(filePath, "utf8");
  const lines = original.split("\n");
  let modified = false;

  // Process warnings in reverse line order so edits don't shift line numbers
  const sorted = [...warnings].sort((a, b) => b.line - a.line);

  for (const warn of sorted) {
    const lineIdx = warn.line - 1;
    const line = lines[lineIdx];

    if (warn.ruleId === "@typescript-eslint/no-floating-promises") {
      // Pattern 1: fire-and-forget promise call — prefix with `void`
      // e.g.  navigator.clipboard.writeText(text);
      // e.g.  handleLoadAgent();
      // e.g.  document.fonts.ready.then(() => {
      // e.g.  fetch("/lottie_agents.json").then(...)

      const indent = line.match(/^(\s*)/)[1];
      const rest = line.slice(indent.length);

      // Skip if already has void
      if (rest.startsWith("void ")) continue;

      // Add void prefix
      lines[lineIdx] = indent + "void " + rest;
      modified = true;
      totalFixed++;
      console.log(
        `  FLOAT ${filePath.replace(process.cwd() + "/", "")}:${warn.line} → void`,
      );
    } else if (warn.ruleId === "@typescript-eslint/no-misused-promises") {
      // Pattern 2: async function in JSX event handler attribute
      // e.g.  onClick={handlePasskeySignIn}        → onClick={() => void handlePasskeySignIn()}
      // e.g.  onClick={async () => { ... }}         → onClick={() => void (async () => { ... })()}
      // e.g.  onChange={(e) => handleFoo(e)}        — if handleFoo is async, wrap with void
      //
      // We'll handle the most common sub-patterns:

      // Sub-pattern A: onClick={someAsyncFn}  (bare function reference)
      const bareRef = line.match(/(on\w+=\{)([a-zA-Z_]\w*)(\})/);
      if (bareRef) {
        const [, prefix, fnName, suffix] = bareRef;
        lines[lineIdx] = line.replace(
          bareRef[0],
          `${prefix}() => void ${fnName}()${suffix}`,
        );
        modified = true;
        totalFixed++;
        console.log(
          `  MISUSE ${filePath.replace(process.cwd() + "/", "")}:${warn.line} → () => void ${fnName}()`,
        );
        continue;
      }

      // Sub-pattern B: onClick={async () => { ... }}  or onChange={async (e) => { ... }}
      // These are inline async arrows — wrap the call
      const inlineAsync = line.match(/(on\w+=\{)(async\s+\([^)]*\)\s*=>)/);
      if (inlineAsync) {
        const [, attr, arrow] = inlineAsync;
        // Replace: onX={async (...) => ...} with onX={(...) => void (async (...) => ...)()}
        // This is complex for multi-line — mark for manual review
        console.log(
          `  MISUSE ${filePath.replace(process.cwd() + "/", "")}:${warn.line} → MANUAL (inline async arrow)`,
        );
        continue;
      }

      // Sub-pattern C: onClick={(e) => someAsyncFn(e)}  (arrow that calls async)
      const arrowCall = line.match(
        /(on\w+=\{)\(([^)]*)\)\s*=>\s*([a-zA-Z_]\w*\([^)]*\))(\})/,
      );
      if (arrowCall) {
        const [, prefix, params, call, suffix] = arrowCall;
        lines[lineIdx] = line.replace(
          arrowCall[0],
          `${prefix}(${params}) => void ${call}${suffix}`,
        );
        modified = true;
        totalFixed++;
        console.log(
          `  MISUSE ${filePath.replace(process.cwd() + "/", "")}:${warn.line} → void ${call}`,
        );
        continue;
      }

      // Sub-pattern D: .forEach(asyncFn)  or  setTimeout(asyncFn, ...)
      // Just flag for manual review
      console.log(
        `  MISUSE ${filePath.replace(process.cwd() + "/", "")}:${warn.line} → MANUAL (non-JSX pattern): ${line.trim().slice(0, 80)}`,
      );
    }
  }

  if (modified && !DRY_RUN) {
    writeFileSync(filePath, lines.join("\n"), "utf8");
    console.log(`  ✓ Wrote ${filePath.replace(process.cwd() + "/", "")}`);
  }
}

console.log(`\nFixed ${totalFixed} warnings${DRY_RUN ? " (dry run)" : ""}`);
