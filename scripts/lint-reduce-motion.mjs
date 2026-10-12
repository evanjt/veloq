#!/usr/bin/env node
// React Native `Animated` reads no reduce-motion setting on iOS, and Android's
// Remove animations stops neither its springs nor `LayoutAnimation`. So a
// timing, spring or loop made straight on `Animated`, or a
// `LayoutAnimation.configureNext`, moves for an athlete who asked for no
// motion. `src/shared/ui/reduceMotion.tsx` owns the setting and carries the
// primitives that land at once when it is on, and a layout change is a
// Reanimated layout transition, which follows the setting. This guard refuses
// the direct calls everywhere else under `src`.
//
// Not counted: the primitives' own file, tests under `src/__tests__/`, and
// comments.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flagValue = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : resolve(process.argv[i + 1]);
};

const ROOT = flagValue('--root', join(HERE, '..'));
const SRC = join(ROOT, 'src');
const OWNER = 'src/shared/ui/reduceMotion.tsx';
const EXEMPT = ['src/__tests__/', OWNER];

/** A direct call that ignores the setting, allowing whitespace around the dot. */
const DIRECT =
  /\b(Animated\s*\.\s*(?:timing|spring|loop)|LayoutAnimation\s*\.\s*configureNext)\s*\(/g;

/** Blanks comments, keeping line breaks so a match still has its line. */
function withoutComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, (_, lead) => lead);
}

const tree = treeView(ROOT, [relative(ROOT, SRC)]);

const found = [];
for (const file of tree.files(
  SRC,
  (rel) => /\.tsx?$/.test(rel) && !rel.split('/').includes('node_modules')
)) {
  const rel = relative(ROOT, file).split('\\').join('/');
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
  const code = withoutComments(tree.text(file));
  for (const match of code.matchAll(DIRECT)) {
    const line = code.slice(0, match.index).split('\n').length;
    found.push(`${rel}:${line}  ${match[1].replace(/\s+/g, '')}`);
  }
}

if (found.length === 0) {
  console.log(
    'reduce-motion guard: no timing, spring, loop or layout animation outside the primitives.'
  );
  process.exit(0);
}

console.error(
  'Motion that ignores Reduce Motion. Use motionTiming, motionSpring or motionLoop from'
);
console.error(`${OWNER}, and a Reanimated layout transition in place of LayoutAnimation:\n`);
for (const entry of found) console.error(`  ${entry}`);
process.exit(1);
