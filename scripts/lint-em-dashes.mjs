#!/usr/bin/env node
// style.md bans the em dash outright, in prose, comments, docs and store copy
// alike. Three sweeps have cleared it and three have missed a corner: store
// metadata fifteen locales deep, maestro flows, Rust test headers. Counting the
// whole index rather than a hand-listed set of directories is what keeps the
// next corner from reopening.
//
// The tracematch submodule has its own index and is not covered here.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EM_DASH = '—';

// Paths that may keep an em dash, each with the reason. Prefixes, not globs.
const ALLOWED = [];

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

function tracked() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function isText(bytes) {
  return !bytes.includes(0);
}

const failures = [];
let total = 0;

for (const file of tracked()) {
  if (ALLOWED.some((prefix) => file.startsWith(prefix))) continue;

  let bytes;
  try {
    bytes = readFileSync(join(root, file));
  } catch {
    continue; // A submodule entry, or a path the index still lists after a move.
  }
  if (!isText(bytes)) continue;

  const lines = bytes.toString('utf8').split('\n');
  lines.forEach((line, i) => {
    const count = line.split(EM_DASH).length - 1;
    if (count === 0) return;
    total += count;
    failures.push(`${file}:${i + 1}  ${line.trim()}`);
  });
}

if (failures.length > 0) {
  console.error(`Em dashes are banned by style.md. ${total} in ${failures.length} lines.`);
  console.error('Use a period, a comma or a conjunction.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Em dash guard: none in the tracked tree.');
