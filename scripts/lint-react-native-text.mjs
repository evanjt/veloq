#!/usr/bin/env node
// Text is Paper's `Text`, so Android inherits the Material 3 type and colour.
// react-native's `Text` takes the platform default wherever a style omits a
// colour or a font, so one screen importing both shows two typefaces.
//
// The files that still import react-native's `Text` are too many to convert in
// one sweep, so this is a ratchet. `scripts/react-native-text-baseline.json`
// lists each file that may still import it. A file the list does not name
// fails, and a listed file that no longer imports it fails as stale, so a
// conversion deletes its own line and the list only shrinks.
// `--write` rewrites the list from the tree.
//
// Counted: `Text` named in a value import from `react-native`, aliased or not.
// Not counted: a type-only import, which renders nothing; `src/shared/ui/`,
// where the primitives are built over either; and tests.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'react-native-text-baseline.json'));
const SRC = join(ROOT, 'src');
const WRITE = process.argv.includes('--write');

const EXEMPT = ['src/shared/ui/', 'src/__tests__/'];

/** A value import from react-native, the braces captured. `import type` is skipped. */
const NATIVE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*['"]react-native['"]/g;

function importsNativeText(source) {
  for (const [, names] of source.matchAll(NATIVE_IMPORT)) {
    for (const name of names.split(',')) {
      if (name.trim().split(/\s+as\s+/)[0] === 'Text') return true;
    }
  }
  return false;
}

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const importing = new Set();
for (const file of tree.files(
  SRC,
  (rel) => /\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  if (importsNativeText(tree.text(file))) importing.add(rel);
}

if (WRITE) {
  writeFileSync(BASELINE_FILE, JSON.stringify([...importing].sort(), null, 2) + '\n');
  console.log(`react-native Text baseline written: ${importing.size} files`);
  process.exit(0);
}

const baseline = new Set(JSON.parse(readFileSync(BASELINE_FILE, 'utf8')));
const unlisted = [...importing].filter((file) => !baseline.has(file)).sort();
const stale = [...baseline].filter((file) => !importing.has(file)).sort();

if (unlisted.length === 0 && stale.length === 0) {
  console.log(`react-native Text guard: ${importing.size} files import it, all in the baseline.`);
  process.exit(0);
}

if (unlisted.length > 0) {
  console.error("react-native's Text in a file the baseline does not list. Import Text from");
  console.error('react-native-paper, which carries the Material 3 type and colour on Android.\n');
  for (const file of unlisted) console.error(`  ${file}`);
}
if (stale.length > 0) {
  console.error(
    "\nA baseline entry that is stale: its file no longer imports react-native's Text."
  );
  console.error('Delete the line so the list only shrinks:\n');
  for (const file of stale) console.error(`  ${file}`);
  console.error('\n  npm run lint:react-native-text -- --write');
}
process.exit(1);
