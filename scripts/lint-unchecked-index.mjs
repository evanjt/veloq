#!/usr/bin/env node
// `noUncheckedIndexedAccess` is right every time: `array[i]` can be
// `undefined`. Turned on at once it raised 767 errors outside the tests, most
// of them a loop body or chart maths where the index is in range and the
// compiler cannot see it. The value is the few that are neither, and finding
// them means reading each one, so the flag comes on by directory.
//
// So this is a ratchet, the shape `lint-rgba-literals.mjs` uses, counted by
// directory rather than by file. `scripts/unchecked-index-baseline.json` holds
// the errors each directory still carries under the flag. A directory above its
// baseline fails, a directory the baseline never listed fails, and a directory
// the tree has already beaten fails with the command to write it back, so a fix
// cannot be given away again.
//
// Not counted: tests and mocks, where an index out of range fails the test
// that made it and fixing them buys nothing; and generated files, which are
// rewritten whole by their generator, so nobody can lower their count by hand.
//
// The compiler runs on the project's own tsconfig with the one flag added, and only the
// errors an index read can cause are counted (`scripts/lib/uncheckedIndexErrors.mjs`), so a
// type that resolves differently between checkouts counts the same in all of them.

// Read off the disk on purpose: this runs the compiler over the project's own
// tsconfig and counts the errors it prints, and the compiler resolves imports,
// the `veloqrs` link and the generated bindings from the working tree, which
// the index cannot stand in for. It is the `tsc` step by another name, and is
// judged the way that one is.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIndexAccessError } from './lib/uncheckedIndexErrors.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'unchecked-index-baseline.json'));
const WRITE = process.argv.includes('--write');

const EXEMPT = [
  /(^|\/)__tests__\//,
  /(^|\/)__mocks__\//,
  /\.test\.tsx?$/,
  /(^|\/)generated\//,
  /\.generated\.tsx?$/,
];
const FILE_ERROR = /^(.+?\.[cm]?tsx?)\(\d+,\d+\): error TS\d+:/;

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
// The project references the generated bindings' project, whose declarations a plain
// `--project` run reads from its build output, so that is built first.
if (existsSync(join(ROOT, 'tsconfig.generated.json'))) {
  spawnSync(process.execPath, [tsc, '--build', join(ROOT, 'tsconfig.generated.json')], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}
const run = spawnSync(
  process.execPath,
  [
    tsc,
    '--project',
    join(ROOT, 'tsconfig.json'),
    '--noEmit',
    '--noUncheckedIndexedAccess',
    '--incremental',
    '--tsBuildInfoFile',
    join(ROOT, '.unchecked-index.tsbuildinfo'),
    '--pretty',
    'false',
  ],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
);
if (run.error) {
  console.error(`unchecked index guard: could not run tsc: ${run.error.message}`);
  process.exit(2);
}
const output = `${run.stdout}${run.stderr}`;

const counts = {};
const unplaced = [];
let placed = 0;
for (const line of output.split('\n')) {
  if (!line.includes('error TS')) continue;
  const match = FILE_ERROR.exec(line);
  if (!match) {
    unplaced.push(line);
    continue;
  }
  placed += 1;
  if (!isIndexAccessError(line)) continue;
  const file = match[1].split('\\').join('/');
  if (EXEMPT.some((pattern) => pattern.test(file))) continue;
  const dir = dirname(file);
  counts[dir] = (counts[dir] ?? 0) + 1;
}

// An error naming no source file is the compiler refusing the config, and the per-file
// count it leaves behind is whatever it got through, not the tree.
if (unplaced.length > 0 || (run.status !== 0 && placed === 0)) {
  console.error('unchecked index guard: tsc failed before it could count the tree.\n');
  for (const line of unplaced.length > 0 ? unplaced : [output]) {
    console.error(`  ${line}`);
  }
  process.exit(2);
}

const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
const total = Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
  console.log(
    `unchecked index baseline written: ${total} across ${Object.keys(counts).length} directories`
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
const over = [];
const under = [];
for (const [dir, n] of Object.entries(sorted)) {
  const allowed = baseline[dir] ?? 0;
  if (n > allowed) over.push([dir, n, allowed]);
  else if (n < allowed) under.push([dir, n, allowed]);
}
for (const dir of Object.keys(baseline)) {
  if (!(dir in counts)) under.push([dir, 0, baseline[dir]]);
}

if (over.length === 0 && under.length === 0) {
  console.log(`unchecked index guard: ${total} errors, all at baseline.`);
  process.exit(0);
}

if (over.length > 0) {
  console.error('Unchecked index access above the baseline. Under noUncheckedIndexedAccess an');
  console.error('index read can be undefined: check it, or narrow it with a guard or `?.`.\n');
  for (const [dir, n, allowed] of over) {
    console.error(`  ${dir}  ${n}, baseline ${allowed}`);
  }
  console.error(`\n  npx tsc --noEmit --noUncheckedIndexedAccess | grep '^${over[0][0]}/'`);
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [dir, n, allowed] of under) {
    console.error(`  ${dir}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:unchecked-index -- --write');
}
process.exit(1);
