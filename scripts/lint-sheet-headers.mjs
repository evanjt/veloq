#!/usr/bin/env node
// Every route the root stack presents as a sheet draws its title row through
// the one `SheetHeader` in `src/shared/ui/`. A formSheet takes no navigation
// header, so a sheet that draws its own title picks its own size, alignment,
// heading role and dismissal, and the sheets drifted into five treatments that way.
//
// The sheet routes are the keys of `SCREEN_SHEETS` in
// `src/shared/app/screenHeaders.ts`. A route passes when its file under
// `src/app/` renders `<SheetHeader`, or renders a component whose own file,
// found by the component's name under `src/`, does: four sheets hand their body
// to a feature component of that kind.

import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const SRC = join(ROOT, 'src');
const HEADERS = 'src/shared/app/screenHeaders.ts';

const RENDERS_HEADER = /<SheetHeader[\s/>]/;

const tree = treeView(ROOT, ['src']);
const sources = tree.files(
  SRC,
  (rel) =>
    /\.tsx?$/.test(rel) && !rel.startsWith('src/__tests__/') && !rel.includes('/node_modules/')
);

const headersText = tree.text(join(ROOT, HEADERS));
const block = headersText?.match(/export const SCREEN_SHEETS[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!block) {
  console.error(`sheet header guard: no SCREEN_SHEETS table found in ${HEADERS}.`);
  process.exit(1);
}
const routes = [...block[1].matchAll(/^\s*'([^']+)'\s*:/gm)].map((m) => m[1]);

/** The files under src/ named for a component, `Name.tsx` or `Name.ts`. */
const fileOfComponent = (name) =>
  sources.filter((file) => /^(.*\/)?([^/]+)\.tsx?$/.exec(file)?.[2] === name);

const missing = [];
const bare = [];
for (const route of routes) {
  const file = join(ROOT, 'src/app', `${route}.tsx`);
  const text = tree.text(file);
  if (text === undefined) {
    missing.push(route);
    continue;
  }
  if (RENDERS_HEADER.test(text)) continue;
  const rendered = new Set([...text.matchAll(/<([A-Z]\w*)[\s/>]/g)].map((m) => m[1]));
  const delegated = [...rendered].some((name) =>
    fileOfComponent(name).some((body) => RENDERS_HEADER.test(tree.text(body) ?? ''))
  );
  if (!delegated) bare.push(relative(ROOT, file).split('\\').join('/'));
}

if (missing.length === 0 && bare.length === 0) {
  console.log(`sheet header guard: ${routes.length} sheet routes, each draws SheetHeader.`);
  process.exit(0);
}
if (bare.length > 0) {
  console.error('A sheet route that renders no SheetHeader, itself or through the component it');
  console.error('renders. A sheet draws its title row and dismissal with SheetHeader from');
  console.error('src/shared/ui/SheetHeader.tsx:\n');
  for (const file of bare) console.error(`  ${file}`);
}
if (missing.length > 0) {
  console.error(`\nA SCREEN_SHEETS route in ${HEADERS} with no file under src/app/:\n`);
  for (const route of missing) console.error(`  ${route}`);
}
process.exit(1);
