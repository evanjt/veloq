#!/usr/bin/env node
// Colour lives in `src/theme`. The eslint rule already refuses a raw hex, and
// `S36` found the same violation wearing `rgba(`: a tint, a scrim or a hairline
// written inline, invisible to a theme change and wrong in one of the two
// themes.
//
// Demanding zero would fail every commit: 148 of them stand across 63 files.
// So this is a ratchet, the shape `lint-feature-imports.mjs` uses.
// `scripts/rgba-baseline.json` holds the count each file still carries. A file
// above its baseline fails, a file the baseline never listed fails, and a file
// the tree has already beaten fails with the number to paste back, so ground a
// sweep takes cannot be given away again.
//
// The form to use instead is `colorWithOpacity(token, alpha)`, which is what
// the theme exports for exactly this and what the tree already uses in places.
//
// Not counted: `src/theme` itself, where the tokens are defined; tests;
// `src/features/maps/styles`, which the eslint hex rule also exempts, because a
// MapLibre paint takes a colour string and has no access to a token.

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'rgba-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/theme/', 'src/__tests__/', 'src/features/maps/styles/'];
// A quoted rgb() or rgba() opener. Template literals count: an interpolated
// channel is still a colour nobody named.
const LITERAL = /['"`]rgba?\(/g;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

const counts = {};
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const hits = (readFileSync(file, 'utf8').match(LITERAL) || []).length;
  if (hits > 0) counts[rel] = hits;
}

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify(counts, null, 2) + '\n');
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`rgba baseline written: ${total} across ${Object.keys(counts).length} files`);
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
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`rgba guard: ${total} literals, all at baseline.`);
  process.exit(0);
}

if (over.length > 0) {
  console.error('Raw rgba colour above the baseline. Use colorWithOpacity(token, alpha)');
  console.error('from src/theme, or add a token there.\n');
  for (const [file, n, allowed] of over) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
}
if (under.length > 0) {
  console.error('\nThe tree has beaten its baseline. Lower it, so the ground stays taken:');
  for (const [file, n, allowed] of under) {
    console.error(`  ${file}  ${n}, baseline ${allowed}`);
  }
  console.error('\n  npm run lint:rgba -- --write');
}
process.exit(1);
