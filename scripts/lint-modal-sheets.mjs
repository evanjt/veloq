#!/usr/bin/env node
// A sheet that returns a choice is a formSheet route under `src/app/sheets/`,
// opened through `openSheet` in `src/shared/app/sheetRequest.ts`. A hand-built
// react-native `Modal` sheet gives each screen its own backdrop, corner and
// dismissal, so this guard refuses a `<Modal` in any file it does not list.
//
// `scripts/modal-sheet-baseline.json` maps each file that renders `<Modal` to
// the reason it does. The full-screen takeovers (the landscape chart, the
// full-screen maps, the QR camera), the menu and the developer panel stay a
// `Modal` because a formSheet cannot hold a landscape lock or a full-screen
// camera, and their entries say so. The rest say `converting`. A confirmation
// is `Alert.alert`, not a sheet.
//
// An entry whose file no longer renders `<Modal` fails as stale, so a
// conversion deletes its own line and the list only shrinks. An entry with no
// reason fails too.
//
// Not counted: tests under `src/__tests__/`.

import { readFileSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const BASELINE_FILE = flagValue('--baseline', join(HERE, 'modal-sheet-baseline.json'));
const SRC = join(ROOT, 'src');

const EXEMPT = ['src/__tests__/'];

/** A rendered react-native `Modal`, opening tag only. */
const RENDERED = /<Modal[\s/>]/;

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const rendering = new Set();
for (const file of tree.files(
  SRC,
  (rel) => /\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  if (RENDERED.test(tree.text(file))) rendering.add(rel);
}

const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
const unlisted = [...rendering].filter((file) => !(file in baseline));
const stale = Object.keys(baseline).filter((file) => !rendering.has(file));
const reasonless = Object.keys(baseline).filter(
  (file) => rendering.has(file) && !String(baseline[file]).trim()
);

if (unlisted.length === 0 && stale.length === 0 && reasonless.length === 0) {
  console.log(
    `modal sheet guard: ${rendering.size} files render a Modal, all in the baseline with a reason.`
  );
  process.exit(0);
}

if (unlisted.length > 0) {
  console.error('A react-native Modal in a file the baseline does not list. A sheet that returns');
  console.error('a choice is a formSheet route under src/app/sheets/, opened through openSheet in');
  console.error('src/shared/app/sheetRequest.ts. A confirmation is Alert.alert.\n');
  for (const file of unlisted) console.error(`  ${file}`);
}
if (stale.length > 0) {
  console.error('\nA baseline entry that is stale: its file no longer renders a Modal. Delete the');
  console.error('line from scripts/modal-sheet-baseline.json so the list only shrinks:\n');
  for (const file of stale) console.error(`  ${file}`);
}
if (reasonless.length > 0) {
  console.error(
    '\nA baseline entry with no reason. Say why the file stays a Modal, or `converting`:\n'
  );
  for (const file of reasonless) console.error(`  ${file}`);
}
process.exit(1);
