#!/usr/bin/env node
// Write every style baseline the tree has beaten down to what the tree holds.
//
// A style ratchet fails a tree below its baseline as well as above it, so the
// ground a sweep takes is written down. At a landing that made every merge
// that improved the tree fail until someone ran `--write` by hand, and with
// several sweeps landing together nearly every candidate beat one. So
// `land-branch.sh` runs this on each candidate before its gates and commits
// what it wrote. A count above its baseline is left for the gate to refuse.
//
// The classes share one baseline file and each writes only its own keys, so
// each runs at once on a copy of its own, and the keys it lowered are taken
// from that copy into one write. Each key lowered prints
// `<baseline file>\t<key>` on stdout, which is what the lander stages and
// names in its commit.
//
// Usage: node scripts/lower-style-baselines.mjs [--root <dir>] [--baseline <file>]

import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STYLE_CLASSES } from './lib/styleValues.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const BASELINE_FILE = resolve(flag('--baseline') ?? join(HERE, 'style-literal-baseline.json'));
const rootArgs = flag('--root') ? ['--root', resolve(flag('--root'))] : [];
const scratch = mkdtempSync(join(tmpdir(), 'lower-style-baselines-'));

/** The keys one class lowered, read back from its own copy of the baseline. */
function lowerOne(cls) {
  const copy = join(scratch, `${cls.name}.json`);
  writeFileSync(copy, readFileSync(BASELINE_FILE));
  const args = [join(HERE, 'lint-style-literals.mjs'), '--class', cls.name, ...rootArgs];
  return new Promise((done) => {
    execFile('node', [...args, '--baseline', copy, '--lower'], (error, stdout) => {
      // Above its baseline: the gate that runs next names it.
      if (error) return done({});
      const lowered = JSON.parse(readFileSync(copy, 'utf8'));
      const keys = stdout.split('\n').flatMap((line) => /^lowered (\S+)$/.exec(line)?.[1] ?? []);
      done(Object.fromEntries(keys.map((key) => [key, lowered[key]])));
    });
  });
}

async function main() {
  const classes = STYLE_CLASSES.filter((c) => c.guard?.startsWith('lint:style-'));
  const queue = [...classes];
  const found = {};
  const limit = Math.max(2, Math.floor(availableParallelism() / 2));
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length > 0) Object.assign(found, await lowerOne(queue.shift()));
    })
  );
  rmSync(scratch, { recursive: true, force: true });
  const keys = Object.keys(found).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) return;
  const next = { ...JSON.parse(readFileSync(BASELINE_FILE, 'utf8')), ...found };
  const sorted = Object.fromEntries(Object.entries(next).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE_FILE, JSON.stringify(sorted, null, 2) + '\n');
  for (const key of keys) console.log(`${BASELINE_FILE}\t${key}`);
}

main();
