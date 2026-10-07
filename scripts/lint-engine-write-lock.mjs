#!/usr/bin/env node
// Every engine call from JavaScript used to take the engine's write lock, so a
// screen read waited for whatever write was in flight: 200 ms behind a writer
// holding for 200 ms, where the same read on a pooled connection took 0.4 ms.
// Screen reads are being moved onto `with_reader`, one screen at a time, and a
// sweep spread over many sessions needs the ground it takes to stay taken.
//
// So this is a ratchet, the shape `lint-rgba-literals.mjs` uses.
// `scripts/engine-write-lock-baseline.json` holds the write-lock takes each
// file still carries. A file above its baseline fails, a file the baseline
// never listed fails, and a file the tree has already beaten fails with the
// number to paste back.
//
// A new write-lock take is not forbidden: a mutation belongs on the write lock
// and always will. What the baseline asks is that it be a deliberate line in a
// commit rather than a screen read quietly rejoining the queue behind the
// writer.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';
import { withoutTestItems } from './lib/rustTestItems.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'engine-write-lock-baseline.json'));
const SRC = join(ROOT, 'modules/veloqrs/rust/veloqrs/src');
const WRITE = process.argv.includes('--write');

// The take itself, not the definition: `with_engine(`, `with_persistent_engine(`
// and the `_at` / `_blocking` / `_for` forms the same lock is reached through.
// `_for` refuses a caller whose library has been swapped out from under it,
// which is a different question from which lock it takes: it still
// takes the write one, so it still counts here. A clear's wipe goes through
// `wipe_with_persistent_engine_for`, the same take with the install moved
// before the lock is released, and counts the same. `try_with_persistent_engine_for`
// never waits but is the same take.
const TAKE = /\b(?:try_|wipe_)?with_(?:persistent_)?engine(?:_at|_blocking|_for)?\s*\(/g;
// A `#[cfg(test)]` item is cut out first: a fixture that seeds an engine takes
// the write lock because that is what a write is, and counting it would fail
// the ratchet for writing a test. Only that item goes, so production takes
// after a test-only import still count.

// The definitions live here and take nothing.
const EXEMPT = ['modules/veloqrs/rust/veloqrs/src/persistence/mod.rs'];

const counts = {};
for (const [rel, bytes] of treeSources(ROOT, [relative(ROOT, SRC)])) {
  if (!rel.endsWith('.rs')) continue;
  // Sibling test modules seed the engine under the write lock.
  if (EXEMPT.includes(rel) || rel.includes('/tests/')) continue;
  const hits = (withoutTestItems(bytes.toString('utf8')).match(TAKE) || []).length;
  if (hits > 0) counts[rel] = hits;
}

const total = () => Object.values(counts).reduce((a, b) => a + b, 0);

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  console.log(
    `Engine write-lock baseline written: ${total()} takes across ${Object.keys(counts).length} files`
  );
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
const over = [];
const under = [];
for (const [file, n] of Object.entries(counts)) {
  const allowed = baseline[file] ?? 0;
  if (n > allowed) over.push([file, n, allowed]);
  else if (n < allowed) under.push([file, n, allowed]);
}
for (const file of Object.keys(baseline)) {
  if (!(file in counts)) under.push([file, 0, baseline[file]]);
}

if (over.length === 0 && under.length === 0) {
  console.log(`Engine write-lock guard: ${total()} takes, all at baseline.`);
  process.exit(0);
}

if (over.length > 0) {
  console.error('More engine write-lock takes than the baseline allows. A screen read that');
  console.error('only needs SQLite belongs on with_reader, off the lock.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:engine-write-lock -- --write');
}
process.exit(1);
