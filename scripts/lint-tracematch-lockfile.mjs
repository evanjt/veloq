#!/usr/bin/env node
// tracematch's own `Cargo.lock` must name the version its manifest declares.
//
// tracematch is a member of the workspace in `modules/veloqrs/rust`, so cargo
// run anywhere in this checkout writes the workspace lockfile and never the one
// inside the submodule. A version bump then passes every local gate and leaves
// the standalone lockfile naming the old version. Only tracematch's CI reads it,
// at `cargo publish --dry-run --locked`, and only after a push to its remote,
// which can be weeks after the bump.
//
// Dependency drift in that lockfile needs cargo run outside the workspace and is
// not checked here. The version is the part a bump from this checkout breaks.
//
// A submodule that is not checked out is not wrong: a fresh worktree has an
// empty directory until the clone recipe runs.

// Read off the disk on purpose: both files sit inside the tracematch submodule,
// whose files the superproject's index does not hold.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const SUB = 'modules/veloqrs/rust/tracematch';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const dir = join(root, SUB);
const manifestPath = join(dir, 'Cargo.toml');
const lockPath = join(dir, 'Cargo.lock');

if (!existsSync(manifestPath)) process.exit(0);

const declared = tableValue(readFileSync(manifestPath, 'utf8'), '[package]', 'tracematch');
if (declared === null) {
  console.error(`${SUB}/Cargo.toml: no [package] version for tracematch could be read.`);
  process.exit(1);
}

if (!existsSync(lockPath)) {
  console.error(`${SUB}/Cargo.lock is missing, and tracematch's CI publishes with --locked.`);
  console.error(`The manifest declares tracematch ${declared}.`);
  process.exit(1);
}

const locked = tableValue(readFileSync(lockPath, 'utf8'), '[[package]]', 'tracematch');
if (locked === declared) process.exit(0);

console.error("tracematch's standalone lockfile disagrees with its manifest:");
console.error(`  ${SUB}/Cargo.toml  version ${declared}`);
console.error(`  ${SUB}/Cargo.lock  version ${locked ?? '(no tracematch entry)'}`);
console.error('');
console.error('Cargo in this checkout writes the workspace lockfile, never this one, so');
console.error("tracematch's CI fails at `cargo publish --locked` after the next push.");
// `--manifest-path` into the submodule still finds the workspace root above it
// and rewrites the workspace lockfile, so the update has to run in a copy
// outside this checkout.
console.error('Update it from a clone outside this workspace, then commit it in tracematch:');
console.error(`  git clone -q ${SUB} /tmp/tracematch-lock`);
console.error('  cargo update -p tracematch --manifest-path /tmp/tracematch-lock/Cargo.toml');
console.error(`  cp /tmp/tracematch-lock/Cargo.lock ${SUB}/Cargo.lock`);
process.exit(1);

/**
 * The `version` of the table with header `header` whose `name` is `name`, or
 * null. Line-based rather than a TOML parser: both files are cargo's own
 * output or cargo's own manifest shape, with one key per line.
 */
function tableValue(text, header, name) {
  let inTable = false;
  let tableName = null;
  let tableVersion = null;
  const settle = () => (inTable && tableName === name ? tableVersion : null);
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) {
      const found = settle();
      if (found !== null) return found;
      inTable = line === header;
      tableName = null;
      tableVersion = null;
      continue;
    }
    if (!inTable) continue;
    const match = /^(name|version)\s*=\s*"([^"]*)"/.exec(line);
    if (!match) continue;
    if (match[1] === 'name') tableName = match[2];
    else tableVersion = match[2];
  }
  return settle();
}
