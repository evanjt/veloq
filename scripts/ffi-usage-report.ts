#!/usr/bin/env npx tsx
/**
 * Which FFI exports nothing in the app calls.
 *
 * Usage:
 *   npx tsx scripts/ffi-usage-report.ts
 *   npx tsx scripts/ffi-usage-report.ts --unused    # just the list
 *   npx tsx scripts/ffi-usage-report.ts --check     # exit 1 on an unlisted one
 *   npx tsx scripts/ffi-usage-report.ts --json
 *
 * What counts as a caller, and which exports are owned elsewhere, live in
 * lib/ffiUsage.ts beside the reasons for each.
 */

import * as fs from 'fs';
import * as path from 'path';

import {
  OWNED_ELSEWHERE,
  type Reach,
  exportedNames,
  isCallerFile,
  isDelegateFile,
  reachOf,
} from './lib/ffiUsage';

const REPO = path.resolve(__dirname, '..');
const ROOTS = [path.join(REPO, 'src'), path.join(REPO, 'modules/veloqrs/src')];
const EXTENSIONS = ['.ts', '.tsx'];

interface UsageInfo {
  name: string;
  usageCount: number;
  delegateCount: number;
  reach: Reach;
  files: { file: string; line: number; context: string }[];
}

/** Every file a caller could be in, relative to the repository root. */
function callerFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(full);
      } else if (EXTENSIONS.includes(path.extname(entry.name))) {
        const rel = path.relative(REPO, full);
        if (isCallerFile(rel) || isDelegateFile(rel)) found.push(rel);
      }
    }
  };
  for (const root of ROOTS) if (fs.existsSync(root)) walk(root);
  return found;
}

/**
 * One pass over the files rather than one grep per export. With 248 exports
 * the old shape read every file 248 times, which is why nobody ran it.
 */
function report(): UsageInfo[] {
  const names = exportedNames();
  const usage = new Map<string, UsageInfo>();
  for (const name of names) {
    usage.set(name, {
      name,
      usageCount: 0,
      delegateCount: 0,
      reach: 'unreachable',
      files: [],
    });
  }

  const wanted = new Set(names);
  const identifier = /[A-Za-z_$][A-Za-z0-9_$]*/g;

  for (const file of callerFiles()) {
    const delegate = isDelegateFile(file);
    const lines = fs.readFileSync(path.join(REPO, file), 'utf-8').split('\n');
    lines.forEach((text, index) => {
      const seen = new Set<string>();
      for (const [word] of text.matchAll(identifier)) {
        if (!wanted.has(word) || seen.has(word)) continue;
        seen.add(word);
        const entry = usage.get(word);
        if (!entry) continue;
        if (delegate) {
          entry.delegateCount++;
          continue;
        }
        entry.usageCount++;
        entry.files.push({ file, line: index + 1, context: text.trim().substring(0, 80) });
      }
    });
  }

  for (const entry of usage.values()) {
    entry.reach = reachOf(entry.usageCount, entry.delegateCount);
  }

  return [...usage.values()].sort((a, b) => b.usageCount - a.usageCount);
}

const usageReport = report();
const used = usageReport.filter((u) => u.reach === 'called');
const delegated = usageReport.filter((u) => u.reach === 'delegated');
const unused = usageReport.filter((u) => u.reach === 'unreachable');
const unlisted = unused.filter((u) => !(u.name in OWNED_ELSEWHERE));

if (usageReport.length === 0) {
  console.error('The manifest declared no exports. Run: npm run ffi:manifest');
  process.exit(1);
}

if (process.argv.includes('--json')) {
  console.log(
    JSON.stringify(
      {
        used,
        delegated,
        unused,
        unlisted: unlisted.map((u) => u.name),
        summary: {
          total: usageReport.length,
          used: used.length,
          delegated: delegated.length,
          unused: unused.length,
        },
      },
      null,
      2
    )
  );
  process.exit(unlisted.length > 0 && process.argv.includes('--check') ? 1 : 0);
}

if (process.argv.includes('--check')) {
  if (unlisted.length === 0) {
    console.log(
      `FFI usage guard: ${used.length} of ${usageReport.length} exports reach a screen, ` +
        `${delegated.length} reach the delegate layer and no further.`
    );
    process.exit(0);
  }
  console.error(
    `${unlisted.length} FFI export(s) are exported from Rust and named by nothing, not even a delegate:`
  );
  for (const u of unlisted) console.error(`  - ${u.name}`);
  console.error('');
  console.error('Either wire it up, delete it, or add it to OWNED_ELSEWHERE in');
  console.error('scripts/lib/ffiUsage.ts with the reason it has no caller here.');
  process.exit(1);
}

if (process.argv.includes('--unused')) {
  console.log(`=== UNREACHABLE FFI EXPORTS (${unused.length}/${usageReport.length}) ===\n`);
  for (const u of unused) {
    const reason = OWNED_ELSEWHERE[u.name];
    console.log(reason ? `  - ${u.name}  (owned elsewhere: ${reason})` : `  - ${u.name}`);
  }
  console.log(`\n${unlisted.length} of these have no recorded owner.`);
} else {
  console.log('=== FFI USAGE REPORT ===\n');
  console.log(`Total FFI exports: ${usageReport.length} distinct names`);
  console.log(`Called from the app: ${used.length}`);
  console.log(`Delegated but never called under that name: ${delegated.length}`);
  console.log(`Named by nothing: ${unused.length} (${unlisted.length} without a recorded owner)\n`);

  console.log('--- MOST USED (top 15) ---\n');
  for (const u of used.slice(0, 15)) {
    console.log(`${u.name} (${u.usageCount} references)`);
    for (const f of u.files.slice(0, 3)) console.log(`  ${f.file}:${f.line}`);
    if (u.files.length > 3) console.log(`  ... and ${u.files.length - 3} more`);
    console.log();
  }

  if (unused.length > 0) {
    console.log(`\n--- NAMED BY NOTHING (${unused.length}) ---\n`);
    for (const u of unused) console.log(`  - ${u.name}`);
    console.log('\nRun with --unused for just this list, or --check to gate on it.');
  }
}
