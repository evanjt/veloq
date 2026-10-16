#!/usr/bin/env node
// Every style key the app sets has an owner in `src/theme` or a guard.
//
// The style guards were added one class at a time, so a class nobody thought
// of had neither: font weight, line height, border width, stroke width, icon
// size, layer and motion were each written by hand at hundreds of sites
// before anything counted them. `scripts/lib/styleValues.mjs` lists the
// classes. This reads every key set in a `StyleSheet.create` entry or written
// into a `style` prop, and fails on one that no class and no structural entry
// places, so a new property class cannot arrive unowned. It also fails a
// class with neither an owner nor a guard, an owner `src/theme` does not
// export, and a guard that does not exist.
//
// Usage: node scripts/check-style-owners.mjs [--root <dir>] [--table]
//   --table prints the class, its keys, its owner and its guard as markdown.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { refuseEmptyListing, trackedText, treeSources } from './lib/indexedSources.mjs';
import { STRUCTURAL_KEYS, STYLE_CLASSES, judged, parse, styleKeys } from './lib/styleValues.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const ROOT = resolve(flag('--root') ?? join(HERE, '..'));

if (process.argv.includes('--table')) {
  console.log('| Class | Keys | Owner in src/theme | Guard |');
  console.log('|---|---|---|---|');
  for (const c of STYLE_CLASSES) {
    const keys = c.keys.length > 0 ? c.keys.map((k) => `\`${k}\``).join(', ') : '(see guard)';
    const owner = c.owner.length > 0 ? c.owner.map((o) => `\`${o}\``).join(', ') : 'none yet';
    console.log(`| ${c.name} | ${keys} | ${owner} | \`${c.guard ?? 'owner only'}\` |`);
  }
  process.exit(0);
}

const problems = [];

const themeIndex = trackedText(ROOT, 'src/theme/index.ts') ?? '';
const guardsText = trackedText(ROOT, 'scripts/run-guards.mjs') ?? '';
const eslintText = trackedText(ROOT, 'eslint.config.js') ?? '';

const exported = (name) =>
  new RegExp(`(^|[\\s{,])${name}(\\s*[,}]|\\s+as\\s)`, 'm').test(themeIndex);

for (const c of STYLE_CLASSES) {
  if (c.owner.length === 0 && !c.guard) {
    problems.push(`class ${c.name} has no owner in src/theme and no guard`);
  }
  for (const owner of c.owner) {
    if (!exported(owner)) problems.push(`class ${c.name}: src/theme/index.ts exports no ${owner}`);
  }
  if (c.guard?.startsWith('eslint:')) {
    const selector = c.guard.slice('eslint:'.length);
    const uses = eslintText.match(new RegExp(`\\b${selector}\\b`, 'g'))?.length ?? 0;
    if (!new RegExp(`const ${selector}\\s*=`).test(eslintText) || uses < 2) {
      problems.push(`class ${c.name}: eslint.config.js defines and applies no ${selector}`);
    }
  } else if (c.guard && !guardsText.includes(`name: '${c.guard}'`)) {
    problems.push(`class ${c.name}: scripts/run-guards.mjs runs no guard named ${c.guard}`);
  }
}

const placed = new Set([...STRUCTURAL_KEYS, ...STYLE_CLASSES.flatMap((c) => c.keys)]);
const sources = treeSources(ROOT, ['src']);
refuseEmptyListing(sources, 'style owner check');

const unowned = new Map();
for (const [rel, bytes] of sources) {
  if (!judged(rel)) continue;
  for (const { key, line } of styleKeys(parse(rel, bytes.toString('utf8')))) {
    if (placed.has(key)) continue;
    if (!unowned.has(key)) unowned.set(key, []);
    unowned.get(key).push(`${rel}:${line}`);
  }
}
for (const [key, sites] of unowned) {
  problems.push(
    `style key ${key} has no owner and no guard, set at:\n${sites.map((s) => `      ${s}`).join('\n')}`
  );
}

if (problems.length > 0) {
  console.error('Style owners: every style property class needs a token owner or a guard.\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nPlace a new key in scripts/lib/styleValues.mjs: in the class whose token');
  console.error('owns it, or in a new class with its owner and guard, or among the structural');
  console.error('keys when it places an element rather than draws the design language.');
  process.exit(1);
}
console.log(
  `style owners: ${STYLE_CLASSES.length} classes, each owned or guarded, and every style key placed.`
);
