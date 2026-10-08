#!/usr/bin/env node
// Refuses a merge that raises a ratchet's ceiling.
//
// `ffi:area-check` and `lint:engine-surface` hold the tree to a committed
// ceiling, and the ceiling is documented to only fall. Nothing compared it with
// what it held before the change, so a commit that added an engine call and
// added the name to the ceiling in the same change passed both. This reads the
// ceilings at the merge base and in the tree being merged, and refuses when
// any area's list is longer, when an area appears, or when either number in
// the `lint:engine-surface` script is higher.
//
// The base is `VELOQ_MERGE_BASE`, the target head the merge was built on, or
// `--base <rev>`. With neither there is nothing to compare against and the
// guard says so and passes: a commit is judged against its parent by the
// ratchets themselves, and a landing always has a base.
//
// A name may replace another in the same area, which keeps the list the same
// length: a rename or a call moved between two reads.
//
// Both sides are read out of git, the base from its commit and the current
// ceilings from the index, since the index is the tree a merge is making.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { gitFreeEnv } from './lib/indexedSources.mjs';
import { areaGrowth, numberGrowth } from './lib/ratchetGrowth.mjs';

const CEILINGS = 'scripts/ffi-area-ceilings.json';
const SURFACE_SCRIPT = 'lint:engine-surface';

function flag(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

const root = resolve(flag('--root') ?? '.');
const base = flag('--base') ?? process.env.VELOQ_MERGE_BASE;

function git(args) {
  const run = spawnSync('git', args, { cwd: root, env: gitFreeEnv(), encoding: 'utf8' });
  if (run.error) refuse(`git could not be run: ${run.error.message}`);
  return run;
}

function refuse(detail) {
  console.error(`Ratchet growth: ${detail}`);
  console.error('');
  console.error('Nothing was compared, so nothing was checked.');
  process.exit(1);
}

if (!base) {
  console.log('Ratchet growth: no merge base given, so there is no earlier ceiling to compare.');
  process.exit(0);
}

if (git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).status !== 0) {
  refuse(`${base} is not a commit this repository holds.`);
}

/** A file as `rev` holds it, where rev is `:` for the index. Null when the path is not there. */
function show(rev, path) {
  const spec = rev === ':' ? `:${path}` : `${rev}:${path}`;
  if (git(['cat-file', '-e', spec]).status !== 0) return null;
  const shown = git(['show', spec]);
  if (shown.status !== 0) refuse(`git show could not read ${spec}: ${shown.stderr.trim()}`);
  return shown.stdout;
}

function parse(text, label) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return refuse(`${label} is not JSON: ${error.message}`);
  }
}

const problems = [];

const ceilingsNow = show(':', CEILINGS);
if (ceilingsNow === null) refuse(`${CEILINGS} is not in the index.`);
const ceilingsThen = show(base, CEILINGS);
if (ceilingsThen !== null) {
  for (const { area, before, after, added } of areaGrowth(
    parse(ceilingsThen, `${CEILINGS} at ${base}`),
    parse(ceilingsNow, CEILINGS)
  )) {
    problems.push(
      before === null
        ? `${area} is a new area in ${CEILINGS}, with ${after} export(s):`
        : `${area} lists ${after} export(s) in ${CEILINGS}, it listed ${before}:`,
      ...added.map((key) => `  + ${key}`)
    );
  }
}

const packageNow = show(':', 'package.json');
if (packageNow === null) refuse('package.json is not in the index.');
const packageThen = show(base, 'package.json');
if (packageThen !== null) {
  const scriptOf = (text, label) => parse(text, label).scripts?.[SURFACE_SCRIPT];
  for (const { flag: name, before, after } of numberGrowth(
    scriptOf(packageThen, `package.json at ${base}`),
    scriptOf(packageNow, 'package.json')
  )) {
    problems.push(
      after === null
        ? `${SURFACE_SCRIPT} no longer passes ${name}, it was ${before}.`
        : `${SURFACE_SCRIPT} passes ${name} ${after}, it was ${before}.`
    );
  }
}

if (problems.length === 0) {
  console.log(`Ratchet growth: no ceiling is higher than it was at ${base.slice(0, 12)}.`);
  process.exit(0);
}

console.error(
  `Ratchet growth: a ceiling that may only fall is higher than at ${base.slice(0, 12)}.`
);
console.error('');
for (const line of problems) console.error(line);
console.error('');
console.error('Read the data the screen already has, or pay for the new name with one removed');
console.error(
  'from the same area in the same commit. A call that cannot be paid for either way is a'
);
console.error('decision for the owner, not a number to raise.');
process.exit(1);
