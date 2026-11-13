#!/usr/bin/env node
// The connect page's theme subset, web/connect/theme.ts, stands in for the app's theme index in a
// browser. Every module it re-exports, and every module those import by a relative path or `@/`,
// must import nothing native: react-native, react-native-paper, expo-* or
// react-native-reanimated. Type-only imports are not read.
//
// `--root <dir>` points the check at another tree, for the guard's own test.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const i = process.argv.indexOf('--root');
const ROOT = i === -1 ? join(HERE, '..') : resolve(process.argv[i + 1]);
const SUBSET = 'web/connect/theme.ts';
const NATIVE = /^(react-native($|\/)|react-native-paper|react-native-reanimated|expo($|-|\/))/;
const IMPORT = /^\s*(import|export)\s+(?!type\b)[^;]*?from\s+'([^']+)'|^\s*import\s+'([^']+)'/gms;

function resolveFile(from, spec) {
  const base = spec.startsWith('@/')
    ? join(ROOT, 'src', spec.slice(2))
    : resolve(dirname(from), spec);
  return ['.ts', '.tsx', '/index.ts'].map((x) => base + x).find(existsSync) ?? null;
}

const problems = [];
const seen = new Set();
function visit(file, chain) {
  if (seen.has(file)) return;
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(IMPORT)) {
    const spec = m[2] ?? m[3];
    if (NATIVE.test(spec)) {
      problems.push(`${chain.concat(file.replace(`${ROOT}/`, '')).join(' -> ')} imports ${spec}`);
    } else if (spec.startsWith('.') || spec.startsWith('@/')) {
      const next = resolveFile(file, spec);
      if (next) visit(next, chain.concat(file.replace(`${ROOT}/`, '')));
    }
  }
}

visit(join(ROOT, SUBSET), []);
if (problems.length) {
  console.error(`${SUBSET} reaches a native import:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
