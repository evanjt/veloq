#!/usr/bin/env npx tsx
/**
 * FFI Usage Report
 *
 * Shows which FFI functions are actually used in the codebase,
 * which are unused, and where each is called from.
 *
 * Usage:
 *   npx tsx scripts/ffi-usage-report.ts
 *   npx tsx scripts/ffi-usage-report.ts --unused    # Show only unused
 *   npx tsx scripts/ffi-usage-report.ts --json      # JSON output
 */

import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

// Load the generated manifest
const manifestPath = path.resolve(__dirname, '../src/__tests__/bindings/ffi-exports.generated.ts');
if (!fs.existsSync(manifestPath)) {
  console.error('FFI manifest not found. Run: npm run ffi:manifest');
  process.exit(1);
}

// Extract function names from manifest
const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
const functionNames: string[] = [];
const nameRegex = /"camelName":\s*"(\w+)"/g;
let match;
while ((match = nameRegex.exec(manifestContent)) !== null) {
  functionNames.push(match[1]);
}

interface UsageInfo {
  name: string;
  usageCount: number;
  files: { file: string; line: number; context: string }[];
}

const SRC_DIR = path.resolve(__dirname, '../src');
const MODULES_DIR = path.resolve(__dirname, '../modules/veloqrs/src');

function findUsages(fnName: string): UsageInfo {
  const usages: UsageInfo['files'] = [];

  try {
    // Use grep to find usages (faster than parsing all files)
    // Search in src/ but exclude __tests__ and the generated manifest
    const grepCmd = `grep -rn "\\b${fnName}\\b" "${SRC_DIR}" "${MODULES_DIR}" --include="*.ts" --include="*.tsx" 2>/dev/null || true`;
    const result = execSync(grepCmd, { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 });

    for (const line of result.split('\n')) {
      if (!line.trim()) continue;

      // Parse grep output: file:line:content
      const colonIdx = line.indexOf(':');
      if (colonIdx === -1) continue;

      const file = line.substring(0, colonIdx);
      const rest = line.substring(colonIdx + 1);
      const lineNumMatch = rest.match(/^(\d+):/);
      if (!lineNumMatch) continue;

      const lineNum = parseInt(lineNumMatch[1], 10);
      const context = rest.substring(lineNumMatch[0].length).trim();

      // Skip the manifest file itself
      if (file.includes('ffi-exports.generated')) continue;

      // Skip import statements in index.ts (those are just re-exports)
      if (file.endsWith('modules/veloqrs/src/index.ts') && context.includes('import {')) continue;

      // Skip test files
      if (file.includes('__tests__')) continue;

      // Skip type-only references (just the type name, not a call)
      if (context.match(new RegExp(`:\\s*${fnName}\\s*[,;)]`))) continue;

      const relFile = file.replace(path.resolve(__dirname, '..') + '/', '');
      usages.push({ file: relFile, line: lineNum, context: context.substring(0, 80) });
    }
  } catch {
    // grep failed, no usages found
  }

  return {
    name: fnName,
    usageCount: usages.length,
    files: usages,
  };
}

// Main
const showUnusedOnly = process.argv.includes('--unused');
const jsonOutput = process.argv.includes('--json');

console.error(`Analyzing ${functionNames.length} FFI functions...\n`);

const usageReport: UsageInfo[] = [];
for (const name of functionNames) {
  usageReport.push(findUsages(name));
}

// Sort by usage count (most used first)
usageReport.sort((a, b) => b.usageCount - a.usageCount);

const used = usageReport.filter((u) => u.usageCount > 0);
const unused = usageReport.filter((u) => u.usageCount === 0);

if (jsonOutput) {
  console.log(JSON.stringify({ used, unused, summary: { total: functionNames.length, used: used.length, unused: unused.length } }, null, 2));
  process.exit(0);
}

if (showUnusedOnly) {
  console.log(`=== UNUSED FFI FUNCTIONS (${unused.length}/${functionNames.length}) ===\n`);
  for (const u of unused) {
    console.log(`  - ${u.name}`);
  }
  console.log(`\nThese ${unused.length} functions are exported from Rust but not used in TypeScript.`);
  console.log('They may be candidates for removal, or they may be used dynamically.');
} else {
  console.log(`=== FFI USAGE REPORT ===\n`);
  console.log(`Total FFI functions: ${functionNames.length}`);
  console.log(`Used: ${used.length}`);
  console.log(`Unused: ${unused.length}\n`);

  console.log(`--- MOST USED (top 15) ---\n`);
  for (const u of used.slice(0, 15)) {
    console.log(`${u.name} (${u.usageCount} references)`);
    for (const f of u.files.slice(0, 3)) {
      console.log(`  ${f.file}:${f.line}`);
    }
    if (u.files.length > 3) {
      console.log(`  ... and ${u.files.length - 3} more`);
    }
    console.log();
  }

  if (unused.length > 0) {
    console.log(`\n--- UNUSED (${unused.length}) ---\n`);
    for (const u of unused) {
      console.log(`  - ${u.name}`);
    }
    console.log(`\nRun with --unused for just this list.`);
  }
}
