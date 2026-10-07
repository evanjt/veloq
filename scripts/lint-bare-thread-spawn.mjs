#!/usr/bin/env node
// Linux gives a new thread its creator's `comm`, so a bare `thread::spawn` for a
// long pass reads as the JavaScript thread in a per-thread sampler, and the pass
// cannot be told from the thread that started it.
//
// Spawn through `crate::threads::spawn_named` with a name of fifteen characters
// or fewer. Test code is exempt: a `#[cfg(test)]` item, a `tests` directory and
// a `tests.rs` file.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const CRATE = join(ROOT, 'modules/veloqrs/rust/veloqrs');
const SPAWN = /\bthread::spawn\s*\(/;

const isTestFile = (rel) => /(^|\/)tests(\/|\.rs$)/.test(rel);

// Lines of `source` that sit inside a `#[cfg(test)]` item, found by counting
// braces from the item the attribute precedes.
const testLines = (lines) => {
  const inTest = new Set();
  let pending = false;
  let depth = 0;
  let open = false;
  for (let i = 0; i < lines.length; i++) {
    const code = lines[i].replace(/\/\/.*$/, '');
    if (!open && /#\[cfg\(test\)\]/.test(code)) {
      pending = true;
      continue;
    }
    if (pending || open) {
      inTest.add(i);
      for (const ch of code) {
        if (ch === '{') {
          depth++;
          open = true;
          pending = false;
        } else if (ch === '}') depth--;
      }
      if (pending && code.includes(';')) pending = false;
      if (open && depth <= 0) {
        open = false;
        depth = 0;
      }
    }
  }
  return inTest;
};

export const bareSpawns = (rel, source) => {
  if (isTestFile(rel)) return [];
  const lines = source.split('\n');
  const inTest = testLines(lines);
  const found = [];
  lines.forEach((text, i) => {
    if (inTest.has(i)) return;
    if (/^\s*\/\//.test(text)) return;
    if (SPAWN.test(text.replace(/\/\/.*$/, ''))) found.push(i + 1);
  });
  return found;
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const hits = [];
  for (const [rel, bytes] of treeSources(ROOT, [relative(ROOT, join(CRATE, 'src'))])) {
    if (!rel.endsWith('.rs')) continue;
    for (const line of bareSpawns(rel, bytes.toString('utf8'))) hits.push(`${rel}:${line}`);
  }
  if (hits.length === 0) {
    console.log('Thread spawn guard: every engine thread is named.');
    process.exit(0);
  }
  console.error('A bare thread::spawn reads as the JavaScript thread in a per-thread sampler.');
  console.error('Use crate::threads::spawn_named with a name of 15 characters or fewer:\n');
  for (const hit of hits) console.error(`  ${hit}`);
  process.exit(1);
}
