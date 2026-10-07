#!/usr/bin/env node
// Bash before 4.4 reads an empty array under `set -u` as unbound and stops the
// script, and macOS ships 3.2. Linux CI runs bash 5, which accepts the bare
// expansion, so the failure shows only on a Mac. The safe form is
// `${a[@]+"${a[@]}"}`, and this refuses any other `[@]` or `[*]` expansion in a
// Maestro script that sets `set -u`.

import { resolve } from 'node:path';
import { treeSources } from './lib/indexedSources.mjs';

const argv = process.argv.slice(2);
const rootFlag = argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(argv[rootFlag + 1]);

const SETS_NOUNSET = /^\s*set\s+-[a-zA-Z]*u/m;
const GUARDED = /\$\{(\w+)\[[@*]\]\+"\$\{\1\[[@*]\]\}"\}/g;
const BARE = /\$\{(\w+)\[[@*]\]\}/;

// No Maestro directory is an empty listing, and nothing to check.
const files = [...treeSources(root, ['.maestro'])].filter(([name]) => /^\.maestro\/[^/]+\.sh$/.test(name));

const failures = [];
for (const [path, bytes] of files) {
  const file = path.slice('.maestro/'.length);
  const text = bytes.toString('utf8');
  if (!SETS_NOUNSET.test(text)) continue;
  text.split('\n').forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    if (BARE.test(line.replace(GUARDED, '')))
      failures.push(`.maestro/${file}:${i + 1}: ${line.trim()}`);
  });
}

if (failures.length > 0) {
  console.error('Unguarded array expansion under set -u, unbound when empty on bash 3.2:');
  for (const f of failures) console.error(`  ${f}`);
  console.error('Write it as ${name[@]+"${name[@]}"}.');
  process.exit(1);
}
