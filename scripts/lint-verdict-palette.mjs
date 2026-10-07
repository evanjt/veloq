#!/usr/bin/env node
// One judgement, one palette. A good, caution or bad verdict is drawn from the
// `verdict` ladder in `src/theme/colors.ts` and from nowhere else, so the same
// verdict cannot be amber on one card and grey on the card beside it.
//
// Four palettes used to answer this question. `insightIcon.positive` and
// `.caution`, `statusBadge`'s good/alert/watch/bad, and the raw semantic
// `colors.success`/`warning`/`error`. This guard holds the first two
// everywhere: reaching them for a polarity fails, and `insightIcon.info` and
// `.opportunity` are left alone because they are categories rather than
// polarities and the ladder has no rung for either.
//
// The third palette is held everywhere in `src/`: a raw `colors.success`,
// `warning` or `error` picked by a ternary is a verdict taken off the sign of
// a number, which is how the period comparison drew load green and amber
// against the polarity table. The same token used as a fixed colour is not a
// verdict and is left alone, and so is a theme pick,
// `isDark ? darkColors.error : colors.error`. A file whose ternary is a state
// and not a verdict is listed in `STATE_CHOICES` with the reason.
//
// The ladder's own module is exempt, since it is where the tokens live.

import { join, dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeView } from './lib/indexedSources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const rootFlag = process.argv.indexOf('--root');
const ROOT = rootFlag === -1 ? join(HERE, '..') : resolve(process.argv[rootFlag + 1]);
const SRC = join(ROOT, 'src');

/** Where the tokens are defined and re-exported, so naming them is the point. */
const EXEMPT = ['src/theme/colors.ts', 'src/theme/index.ts'];

/** Polarity members only. `info` and `opportunity` are categories. */
const POLARITY =
  /\binsightIcon\.(positive|caution)\b|\bstatusBadge\.(good|alert|watch|bad|goodStrong|watchStrong)\b/g;

/** Where a raw semantic colour picked by a comparison is refused. */
const COMPARED_SCOPE = 'src/';

/** Files whose raw semantic choice is a state, not a verdict, with why. */
const STATE_CHOICES = {
  'src/features/activity/components/stats/useActivityStats.ts':
    'session intensity zones, a banded scale with no good or bad end',
  'src/features/recording/components/TimerHeader.tsx':
    'recording and paused are modes, not a judgement',
  'src/features/routes/components/section/SectionActionRow.tsx':
    'restore is an action affordance, not a judgement',
  'src/features/settings/components/CacheManagementPanel.tsx':
    'a destructive action is red unless disabled',
};

/**
 * A raw semantic colour as one branch of a ternary: after the `?`, after the
 * `:` on the same line as a `?`, or on a line that opens with either, which is
 * how a ternary laid out over several lines reads.
 */
const COMPARED = /(?<![\w.])colors\.(success|warning|error)\b/g;
function isComparedChoice(line, index) {
  const before = line.slice(0, index);
  if (/\bisDark\s*\?/.test(before)) return false;
  if (/\?\s*$/.test(before)) return true;
  if (/:\s*$/.test(before) && (before.includes('?') || /^\s*:\s*$/.test(before))) return true;
  return false;
}

/**
 * A condition that names a polarity: `isGood`, `isPositive`, `isImproving`, or a
 * name a polarity flag was bound to first (`const ok = analysis.isGood`). Outside
 * the insight scope this is the only ternary refused, because a ternary there is
 * as often a state as a verdict.
 */
const POLARITY_WORD = /\b\w*(?:good|positive|improv(?:ing|ed)|better)\w*\b/i;

function polarityNames(lines) {
  const names = new Set();
  for (const line of lines) {
    const bound = line.match(/\b(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(.*)$/);
    if (bound && POLARITY_WORD.test(bound[2]) && !/colors\./.test(bound[2])) names.add(bound[1]);
  }
  return names;
}

function isPolarityChoice(lines, i, index, names) {
  const line = lines[i];
  const before = line.slice(0, index);
  if (/\bisDark\s*\?/.test(before)) return false;
  // The condition is what precedes the `?`, on this line or the line above.
  const head = `${i > 0 ? lines[i - 1] : ''} ${before}`;
  const condition = head.slice(Math.max(0, head.lastIndexOf('?') - 80));
  const asked = condition.includes('?') ? head.slice(0, head.lastIndexOf('?')) : head;
  const tail = asked.slice(-80);
  if (POLARITY_WORD.test(tail)) return true;
  return [...names].some((name) => new RegExp(`\\b${name}\\b`).test(tail));
}

const tree = treeView(ROOT, ['src']);

function walk(dir) {
  return tree.files(dir, (rel) => {
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    if (parts.slice(0, -1).some((part) => part === '__tests__' || part === '__mocks__'))
      return false;
    return /\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !/\.d\.ts$/.test(name);
  });
}

const failures = [];
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (EXEMPT.includes(rel) || rel in STATE_CHOICES) continue;
  const lines = tree.text(file).split('\n');
  const names = polarityNames(lines);
  const compared = rel.split('\\').join('/').startsWith(COMPARED_SCOPE);
  lines.forEach((line, i) => {
    for (const match of line.matchAll(POLARITY)) {
      failures.push(`${rel}:${i + 1}  ${match[0]}`);
    }
    for (const match of line.matchAll(COMPARED)) {
      if (!isComparedChoice(line, match.index)) continue;
      if (compared || isPolarityChoice(lines, i, match.index, names)) {
        failures.push(`${rel}:${i + 1}  ${match[0]}`);
      }
    }
  });
}

if (failures.length > 0) {
  console.error(`A polarity drawn from a palette that is not the ladder: ${failures.length}.`);
  console.error('Use verdictColor(rung, isDark) or verdictFill(rung, isDark) from src/theme.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Verdict palette guard: every polarity comes from the ladder.');
