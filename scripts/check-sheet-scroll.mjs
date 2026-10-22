#!/usr/bin/env node
// Every vertical scroll view in a sheet's body turns on nested scrolling, through
// `SheetScrollView` or by spreading `sheetScrollProps` from
// `src/shared/ui/SheetScrollView.tsx`, or `pageScroll` from
// `usePagerPageScrollProps`, which also turns it off for a page or a sheet card
// that is not on show. Android's form sheet hands a drag to its
// content only through the first view, depth first, that scrolls nested. With
// none it takes every drag it can follow, so a body scrolled down is never
// scrolled back up: each drag down moves the sheet instead.
//
// The sheet routes are the files under `src/app/sheets/` and every `sheet.tsx`
// under `src/app/`, the map sheet routes. The guard reads each, and each
// component one of them renders whose own file, found by the component's name
// under `src/`, holds the body. A `ScrollView`, `FlatList` or `SectionList`
// there passes when its opening tag spreads `sheetScrollProps` or `pageScroll` or scrolls
// sideways with `horizontal`.

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

const tree = treeView(ROOT, ['src']);
const sources = tree.files(
  SRC,
  (rel) =>
    /\.tsx?$/.test(rel) && !rel.startsWith('src/__tests__/') && !rel.includes('/node_modules/')
);
const relOf = (file) => relative(ROOT, file).split('\\').join('/');

const routes = sources.filter((file) => {
  const rel = relOf(file);
  return /^src\/app\/sheets\/[^/]+\.tsx$/.test(rel) || /^src\/app\/(.*\/)?sheet\.tsx$/.test(rel);
});

/** The files under src/ named for a component, `Name.tsx` or `Name.ts`. */
const fileOfComponent = (name) =>
  sources.filter((file) => /^(.*\/)?([^/]+)\.tsx?$/.exec(file)?.[2] === name);

/** The opening tag starting at `start`, up to the `>` outside every brace. */
function openingTag(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

const SCROLLER = /<(?:Animated\.)?(ScrollView|FlatList|SectionList)[\s/>]/g;
const HANDS_OFF = /\{\s*\.\.\.(?:sheetScrollProps|pageScroll)\s*\}/;
const SIDEWAYS = /\shorizontal(?:[\s/>]|=\{\s*true\s*\})/;

/** The line of each bare vertical scroll view in a file's text. */
function bareScrollers(text) {
  const lines = [];
  for (const match of text.matchAll(SCROLLER)) {
    const tag = openingTag(text, match.index);
    if (HANDS_OFF.test(tag) || SIDEWAYS.test(tag)) continue;
    lines.push(text.slice(0, match.index).split('\n').length);
  }
  return lines;
}

const bodies = new Set(routes);
for (const route of routes) {
  const text = tree.text(route) ?? '';
  for (const match of text.matchAll(/<([A-Z]\w*)[\s/>]/g)) {
    for (const file of fileOfComponent(match[1])) bodies.add(file);
  }
}

const bare = [];
for (const file of [...bodies].sort()) {
  for (const line of bareScrollers(tree.text(file) ?? '')) bare.push(`${relOf(file)}:${line}`);
}

if (bare.length === 0) {
  console.log(
    `sheet scroll guard: ${routes.length} sheet routes and ${bodies.size - routes.length} body components, every vertical scroll view scrolls nested.`
  );
  process.exit(0);
}
console.error('A vertical scroll view in a sheet body that does not scroll nested. Android');
console.error('then hands every downward drag to the sheet, so the body never scrolls back');
console.error('to its top. Scroll through SheetScrollView, or spread sheetScrollProps from');
console.error('src/shared/ui/SheetScrollView.tsx on a list:\n');
for (const entry of bare) console.error(`  ${entry}`);
process.exit(1);
