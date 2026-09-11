#!/usr/bin/env node
// One judgement, one palette. A good, caution or bad verdict is drawn from the
// `verdict` ladder in `src/theme/colors.ts` and from nowhere else, so the same
// verdict cannot be amber on one card and grey on the card beside it.
//
// Four palettes used to answer this question. `insightIcon.positive` and
// `.caution`, `statusBadge`'s good/alert/watch/bad, and the raw semantic
// `colors.success`/`warning`/`error`. This guard holds the first two: reaching
// them for a polarity fails, and `insightIcon.info` and `.opportunity` are
// left alone because they are categories rather than polarities and the ladder
// has no rung for either.
//
// The ladder's own module is exempt, since it is where the tokens live.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const SRC = join(ROOT, 'src');

/** Where the tokens are defined and re-exported, so naming them is the point. */
const EXEMPT = ['src/theme/colors.ts', 'src/theme/index.ts'];

/** Polarity members only. `info` and `opportunity` are categories. */
const POLARITY = /\binsightIcon\.(positive|caution)\b|\bstatusBadge\.(good|alert|watch|bad|goodStrong|watchStrong)\b/g;

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === '__mocks__') continue;
      out.push(...walk(full));
      continue;
    }
    if (!/\.tsx?$/.test(name)) continue;
    if (/\.(test|spec)\.tsx?$/.test(name) || /\.d\.ts$/.test(name)) continue;
    out.push(full);
  }
  return out;
}

const failures = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (EXEMPT.includes(rel)) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const match of line.matchAll(POLARITY)) {
      failures.push(`${rel}:${i + 1}  ${match[0]}`);
    }
  });
}

if (failures.length > 0) {
  console.error(
    `A polarity drawn from a palette that is not the ladder: ${failures.length}.`
  );
  console.error(
    'Use verdictColor(rung, isDark) or verdictFill(rung, isDark) from src/theme.\n'
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Verdict palette guard: every polarity comes from the ladder.');
