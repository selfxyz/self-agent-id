#!/usr/bin/env node
/**
 * Replaces `new ethers.Contract(addr, ABI, runner)` with typed helpers.
 *
 * For SDK files: imports from ./contract-types
 * For app files: imports from @/lib/contract-types
 * For functions files: imports from @selfxyz/agent-sdk
 *
 * Usage: node scripts/apply-typed-contracts.mjs [--dry-run]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const DRY_RUN = process.argv.includes("--dry-run");

// Find all TS/TSX files with `new ethers.Contract`
const files = execSync(
  "grep -rl 'new ethers\\.Contract' --include='*.ts' --include='*.tsx' .",
  { encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter(Boolean);

console.log(`Found ${files.length} files with ethers.Contract usage`);

// ABI name → helper function mapping
const ABI_HELPERS = {
  REGISTRY_ABI: "typedRegistry",
  PROVIDER_ABI: "typedProvider",
  AGENT_DEMO_VERIFIER_ABI: "typedDemoVerifier",
  AGENT_GATE_ABI: "typedGate",
};

// Determine import source based on file path
function getImportSource(filePath) {
  if (filePath.includes("typescript-sdk/src/")) {
    // SDK internal — skip test files (they mock contracts) and contract-types itself
    if (filePath.includes("/test/")) return null;
    if (filePath.includes("contract-types")) return null;
    return "./contract-types";
  }
  if (filePath.includes("functions/src/")) {
    return "@selfxyz/agent-sdk";
  }
  if (
    filePath.includes("app/") &&
    !filePath.includes("app/lib/contract-types")
  ) {
    return "@/lib/contract-types";
  }
  // Skip snippets.ts (code examples), plugin/, etc.
  return null;
}

let totalReplacements = 0;

for (const filePath of files) {
  const importSource = getImportSource(filePath);
  if (!importSource) {
    console.log(`  SKIP ${filePath} (not in scope)`);
    continue;
  }

  let content = readFileSync(filePath, "utf8");
  let modified = false;
  const helpersNeeded = new Set();

  // Match patterns like:
  //   new ethers.Contract(addr, REGISTRY_ABI, provider)
  //   new ethers.Contract(\n    addr,\n    REGISTRY_ABI,\n    provider,\n  )
  // Also inline ABIs like:
  //   new ethers.Contract(addr, [...], provider)

  // Pattern 1: Named ABI constant
  for (const [abiName, helperName] of Object.entries(ABI_HELPERS)) {
    // Single-line pattern
    const singleLine = new RegExp(
      `new ethers\\.Contract\\(\\s*([^,]+),\\s*${abiName},\\s*([^)]+?)\\s*\\)`,
      "g",
    );

    let match;
    while ((match = singleLine.exec(content)) !== null) {
      const [full, addr, runner] = match;
      const replacement = `${helperName}(${addr.trim()}, ${runner.trim()})`;
      content = content.replace(full, replacement);
      helpersNeeded.add(helperName);
      modified = true;
      totalReplacements++;
      console.log(`  ${filePath}: ${abiName} → ${helperName}()`);
    }

    // Multi-line pattern: new ethers.Contract(\n  addr,\n  ABI,\n  runner,?\n)
    const multiLine = new RegExp(
      `new ethers\\.Contract\\(\\s*\\n\\s*([^,]+),\\s*\\n\\s*${abiName},\\s*\\n\\s*([^,)]+),?\\s*\\n\\s*\\)`,
      "g",
    );

    while ((match = multiLine.exec(content)) !== null) {
      const [full, addr, runner] = match;
      const replacement = `${helperName}(${addr.trim()}, ${runner.trim()})`;
      content = content.replace(full, replacement);
      helpersNeeded.add(helperName);
      modified = true;
      totalReplacements++;
      console.log(`  ${filePath}: ${abiName} (multiline) → ${helperName}()`);
    }
  }

  // Pattern 2: Inline ABI arrays (used in functions/src/demo-agent.ts)
  // new ethers.Contract(ADDR, [...], provider)
  const inlineABI =
    /new ethers\.Contract\(\s*\n?\s*([^,]+),\s*\n?\s*\[[\s\S]*?\],\s*\n?\s*([^,)]+),?\s*\n?\s*\)/g;
  let inlineMatch;
  while ((inlineMatch = inlineABI.exec(content)) !== null) {
    // For inline ABIs, we need to determine which helper to use based on the functions listed
    const full = inlineMatch[0];
    if (full.includes("isVerifiedAgent") || full.includes("getAgentId")) {
      const addr = inlineMatch[1].trim();
      const runner = inlineMatch[2].trim();
      const replacement = `typedRegistry(${addr}, ${runner})`;
      content = content.replace(full, replacement);
      helpersNeeded.add("typedRegistry");
      modified = true;
      totalReplacements++;
      console.log(`  ${filePath}: inline ABI → typedRegistry()`);
    }
  }

  if (modified) {
    // Add import if not already present
    if (helpersNeeded.size > 0) {
      const helpers = [...helpersNeeded].sort();

      // Check if import from this source already exists
      const existingImportRegex = new RegExp(
        `import\\s*\\{([^}]*)\\}\\s*from\\s*["']${importSource.replace(/[.*+?^${}()|[\]\\\/]/g, "\\$&")}["']`,
      );
      const existingMatch = content.match(existingImportRegex);

      if (existingMatch) {
        // Add to existing import
        const existingImports = existingMatch[1]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const newImports = helpers.filter((h) => !existingImports.includes(h));
        if (newImports.length > 0) {
          const allImports = [...existingImports, ...newImports].join(", ");
          content = content.replace(
            existingMatch[0],
            `import { ${allImports} } from "${importSource}"`,
          );
        }
      } else {
        // Add new import after the last import
        const lastImportIdx = content.lastIndexOf("\nimport ");
        if (lastImportIdx >= 0) {
          const endOfLine = content.indexOf("\n", lastImportIdx + 1);
          // Find the actual end of this import statement (could be multi-line)
          let importEnd = endOfLine;
          const afterImport = content.slice(lastImportIdx + 1);
          const importMatch = afterImport.match(
            /^import[\s\S]*?from\s*["'][^"']*["'];?\s*\n/,
          );
          if (importMatch) {
            importEnd = lastImportIdx + 1 + importMatch[0].length - 1;
          }
          const importLine = `import { ${helpers.join(", ")} } from "${importSource}";\n`;
          content =
            content.slice(0, importEnd + 1) +
            importLine +
            content.slice(importEnd + 1);
        }
      }

      // Remove unused ABI imports if they were the only reason for the import
      // e.g., if REGISTRY_ABI is no longer used directly
      for (const abiName of Object.keys(ABI_HELPERS)) {
        // Check if ABI is still used anywhere (beyond the import line)
        const usageRegex = new RegExp(`(?<!import[^;]*?)\\b${abiName}\\b`);
        const importLineRegex = new RegExp(`\\b${abiName}\\b`);

        // Count usages that are NOT import statements
        const lines = content.split("\n");
        let usageCount = 0;
        for (const line of lines) {
          if (line.trim().startsWith("import")) continue;
          if (importLineRegex.test(line)) usageCount++;
        }

        if (usageCount === 0) {
          // Remove from import statement
          // Pattern: REGISTRY_ABI, or , REGISTRY_ABI
          content = content.replace(
            new RegExp(`\\s*,\\s*${abiName}`, "g"),
            (match, offset) => {
              // Only remove from import lines
              const lineStart = content.lastIndexOf("\n", offset);
              const line = content.slice(lineStart, offset + match.length);
              if (
                line.includes("import") ||
                content.slice(lineStart - 100, offset).includes("import {")
              ) {
                return "";
              }
              return match;
            },
          );
          content = content.replace(
            new RegExp(`${abiName}\\s*,\\s*`, "g"),
            (match, offset) => {
              const lineStart = content.lastIndexOf("\n", offset);
              const line = content.slice(lineStart, offset + match.length);
              if (
                line.includes("import") ||
                content.slice(lineStart - 100, offset).includes("import {")
              ) {
                return "";
              }
              return match;
            },
          );
        }
      }
    }

    if (!DRY_RUN) {
      writeFileSync(filePath, content, "utf8");
      console.log(`  ✓ Wrote ${filePath}`);
    }
  }
}

console.log(
  `\nReplaced ${totalReplacements} contract instantiations${DRY_RUN ? " (dry run)" : ""}`,
);
