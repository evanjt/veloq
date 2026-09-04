#!/usr/bin/env node
// A hash container returned from a public function carries its per-construction
// seed into whatever the caller derives from the order, and no caller can see
// that from the signature. The detection path has lost that fight six times, so
// the boundary is guarded here rather than at each call site.
//
// Iteration inside a function is covered by clippy::iter_over_hash_type. This
// covers the return type, which that lint does not see.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = [
  'modules/veloqrs/rust/tracematch/src/sections',
  'modules/veloqrs/rust/tracematch/src/grouping.rs',
];

const BANNED = /->\s*[^;{]*\b(HashMap|HashSet)\s*</;

function rustFiles(path) {
  if (statSync(path).isFile()) return path.endsWith('.rs') ? [path] : [];
  return readdirSync(path).flatMap((entry) => rustFiles(join(path, entry)));
}

const failures = [];
for (const root of ROOTS) {
  for (const file of rustFiles(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.includes('pub fn')) return;
      // Signatures wrap, so join until the body or the arrow is resolved.
      const signature = lines.slice(i, i + 12).join(' ');
      const head = signature.slice(0, signature.indexOf('{') + 1 || undefined);
      if (BANNED.test(head)) {
        failures.push(`${file}:${i + 1}  ${line.trim()}`);
      }
    });
  }
}

if (failures.length > 0) {
  console.error('Public detection functions must not return a hash container.');
  console.error('Use BTreeMap/BTreeSet for keyed order, or Vec when the caller folds.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Detector ordering guard: no public function returns a hash container.');
