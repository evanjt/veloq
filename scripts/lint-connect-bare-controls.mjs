#!/usr/bin/env node
// The connect page renders its buttons, selects and inputs through the kit in
// `web/connect/ui/`, so one control looks and behaves the same on every page.
// The pages were written before the kit, so this is a ratchet: the baseline
// holds the count each page file still carries. A file above its count fails,
// a file the baseline never listed fails, and a file below its count fails with
// the number to write back, so converted ground is not given away again.
//
// Counted: a rendered `<button`, `<select` or `<input` in a `.tsx` file under
// `web/connect/` outside `web/connect/ui/`.
//
// Usage: node scripts/lint-connect-bare-controls.mjs [--root DIR] [--write]

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const rootAt = args.indexOf('--root');
const root = rootAt === -1 ? process.cwd() : args[rootAt + 1];
const write = args.includes('--write');
const SOURCE = 'web/connect';
const KIT = 'web/connect/ui/';
const BASELINE = 'scripts/connect-bare-controls-baseline.json';
const CONTROL = /<(button|select|input)[\s>/]/g;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

export function count(source) {
  return [...source.matchAll(CONTROL)].length;
}

const found = {};
for (const path of files(join(root, SOURCE))) {
  const rel = relative(root, path).split('\\').join('/');
  if (!rel.endsWith('.tsx') || rel.startsWith(KIT)) continue;
  const n = count(readFileSync(path, 'utf8'));
  if (n > 0) found[rel] = n;
}

if (write) {
  writeFileSync(join(root, BASELINE), `${JSON.stringify(found, null, 2)}\n`);
  process.exit(0);
}

let held = {};
try {
  held = JSON.parse(readFileSync(join(root, BASELINE), 'utf8'));
} catch {
  held = {};
}

const failures = [];
for (const [file, n] of Object.entries(found)) {
  const allowed = held[file] ?? 0;
  if (n > allowed) {
    failures.push(
      `${file}: ${n} bare button, select or input elements, ${allowed} allowed. Use the kit in ${KIT}.`
    );
  }
}
for (const [file, allowed] of Object.entries(held)) {
  const n = found[file] ?? 0;
  if (n < allowed) {
    failures.push(`${file}: ${n} left, baseline says ${allowed}. Write ${n} back to ${BASELINE}.`);
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'));
  process.exit(1);
}
