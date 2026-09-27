#!/usr/bin/env node
// `SectionDetectionHandle::recv` answers with the phase a run that sent nothing
// ended in, because a detect is refused for three reasons before it starts and
// a worker can die after it, and none of those is a catalogue.
//
// `recv().unwrap_or_default()` throws that away and hands back an empty
// catalogue instead, so the assertion behind it reports a run that never
// happened as a verdict about the library. On 2026-09-19 one full
// `cargo test -p veloqrs` failed that way and the message named the lift veto
// over a climb the streams say was walked, which sends the next
// reader into the detector rather than into the gate that refused.
//
// Take the result with `expect`, or match on it, so the phase reaches whoever
// reads the failure.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const CRATE = join(ROOT, 'modules/veloqrs/rust/veloqrs');
const DIRS = ['src', 'tests', 'benches'].map((d) => join(CRATE, d));

// The swallow, on one line or wrapped onto the next as rustfmt leaves it. It
// is narrow on purpose: `recv().ok()` is how the blocking helpers themselves
// are written, and the channels the engine releases locks over read that way
// too, so widening this would name the definitions rather than their callers.
const SWALLOW = /\.recv\(\)\s*\.\s*unwrap_or_default\(\)/g;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.rs')) out.push(full);
  }
  return out;
}

const hits = [];
for (const dir of DIRS) {
  for (const file of walk(dir)) {
    const source = readFileSync(file, 'utf8');
    const rel = relative(ROOT, file).split('\\').join('/');
    for (const match of source.matchAll(SWALLOW)) {
      const line = source.slice(0, match.index).split('\n').length;
      hits.push(`${rel}:${line}`);
    }
  }
}

if (hits.length === 0) {
  console.log('Detect recv guard: every blocking detect reads the phase it ended in.');
  process.exit(0);
}

console.error('A detect that sent nothing was refused, aborted or died, and none of those');
console.error('is an empty catalogue. Take the result with expect, so the phase is what');
console.error('the failure names:\n');
for (const hit of hits) console.error(`  ${hit}`);
process.exit(1);
