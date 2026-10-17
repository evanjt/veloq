#!/usr/bin/env node
// One style property class, held to its owner in `src/theme`.
//
// `scripts/lib/styleValues.mjs` lists every class and its owner. The ESLint
// scale rules refuse a literal colour, font size, spacing and radius outright;
// the classes below them were written by hand at hundreds of sites before any
// guard existed, so refusing them would fail every commit. Each is a ratchet,
// the shape `lint-rgba-literals.mjs` uses: `scripts/style-literal-baseline.json`
// holds, per class, the count each file still carries. A file above its
// baseline fails, a file the baseline never listed fails, and a file the tree
// has already beaten fails with the command that lowers it, so ground a sweep
// takes cannot be given away again.
//
// `--class font-weight` also refuses a weight of 500 or 800 anywhere under
// `src/`, the theme included, held at its own count under
// `font-weight-off-scale`, which stands at zero.
//
// Usage: node scripts/lint-style-literals.mjs --class <name> [--root <dir>]
//        [--baseline <file>] [--write] [--list]

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';
import {
  STYLE_CLASSES,
  judgedFor,
  literalSites,
  offScaleWeightSites,
  parse,
} from './lib/styleValues.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const ROOT = resolve(flag('--root') ?? join(HERE, '..'));
const BASELINE_FILE = resolve(flag('--baseline') ?? join(HERE, 'style-literal-baseline.json'));
const CLASS = flag('--class');
const WRITE = process.argv.includes('--write');
const LIST = process.argv.includes('--list');

const ratcheted = STYLE_CLASSES.filter((c) => c.guard?.startsWith('lint:style-'));
const cls = ratcheted.find((c) => c.name === CLASS);
if (!cls) {
  console.error(
    `lint-style-literals: --class takes one of ${ratcheted.map((c) => c.name).join(', ')}`
  );
  process.exit(2);
}

const sources = treeSources(ROOT, ['src']);
refuseEmptyListing(sources, `style ${CLASS} guard`);

/** The counts by baseline key, then file, and the sites behind them. */
const counts = { [CLASS]: {} };
const sites = { [CLASS]: {} };
const OFF_SCALE = 'font-weight-off-scale';
if (CLASS === 'font-weight') {
  counts[OFF_SCALE] = {};
  sites[OFF_SCALE] = {};
}

for (const [rel, bytes] of sources) {
  if (!/\.tsx?$/.test(rel)) continue;
  const inScope = judgedFor(CLASS, rel);
  const offScaleScope = CLASS === 'font-weight' && !/(^|\/)(__tests__|__mocks__)\//.test(rel);
  if (!inScope && !offScaleScope) continue;
  const sf = parse(rel, bytes.toString('utf8'));
  if (inScope) {
    const found = literalSites(sf, CLASS);
    if (found.length > 0) {
      counts[CLASS][rel] = found.length;
      sites[CLASS][rel] = found;
    }
  }
  if (offScaleScope && !/\.test\.tsx?$/.test(rel)) {
    const found = offScaleWeightSites(sf);
    if (found.length > 0) {
      counts[OFF_SCALE][rel] = found.length;
      sites[OFF_SCALE][rel] = found;
    }
  }
}

const sorted = (record) =>
  Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
const total = (record) => Object.values(record).reduce((a, b) => a + b, 0);

if (LIST) {
  for (const key of Object.keys(sites)) {
    for (const [file, found] of Object.entries(sorted(sites[key]))) {
      for (const site of found) console.log(`${file}:${site.line}  ${site.text}`);
    }
  }
  process.exit(0);
}

let baseline = {};
try {
  baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
} catch (error) {
  if (!WRITE) {
    console.error(`style ${CLASS} guard: cannot read ${BASELINE_FILE}: ${error.message}`);
    process.exit(1);
  }
}

if (WRITE) {
  const next = { ...baseline };
  for (const key of Object.keys(counts)) next[key] = sorted(counts[key]);
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted(next), null, 2) + '\n');
  for (const key of Object.keys(counts)) {
    console.log(
      `style ${key} baseline written: ${total(counts[key])} across ${Object.keys(counts[key]).length} files`
    );
  }
  process.exit(0);
}

let failed = false;
for (const key of Object.keys(counts)) {
  const allowed = baseline[key] ?? {};
  const over = [];
  const under = [];
  for (const [file, n] of Object.entries(counts[key])) {
    const ceiling = allowed[file] ?? 0;
    if (n > ceiling) over.push([file, n, ceiling]);
    else if (n < ceiling) under.push([file, n, ceiling]);
  }
  for (const file of Object.keys(allowed)) {
    if (!(file in counts[key])) under.push([file, 0, allowed[file]]);
  }
  if (over.length === 0 && under.length === 0) {
    console.log(`style ${key} guard: ${total(counts[key])} sites, all at baseline.`);
    continue;
  }
  failed = true;
  if (over.length > 0) {
    const instead =
      key === OFF_SCALE
        ? 'a weight of 400, 600 or 700: a 500 resolves to 400 or 600 by platform, and nothing is drawn above 700'
        : cls.instead;
    console.error(`A hand-written ${key} value above the baseline. Use ${instead}.\n`);
    for (const [file, n, ceiling] of over) {
      console.error(`  ${file}  ${n}, baseline ${ceiling}`);
      for (const site of sites[key][file]) console.error(`    ${file}:${site.line}  ${site.text}`);
    }
  }
  if (under.length > 0) {
    console.error(
      `\nThe tree has beaten its ${key} baseline. Lower it, so the ground stays taken:`
    );
    for (const [file, n, ceiling] of under) console.error(`  ${file}  ${n}, baseline ${ceiling}`);
    console.error(`\n  node scripts/lint-style-literals.mjs --class ${CLASS} --write`);
  }
}
process.exit(failed ? 1 : 0);
