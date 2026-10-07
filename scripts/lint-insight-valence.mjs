#!/usr/bin/env node
// Insight cards read in the athlete's language, so a pattern check at runtime
// can only judge the English ones. Check both the base copy and its regional
// overrides at the point they are written. Other locales are held by translation review.

import { trackedText } from './lib/indexedSources.mjs';

const PUNITIVE_PATTERNS = [
  /\byou (haven't|have not|didn't|did not) /i,
  /\byou (failed|missed) /i,
  /\bbehind schedule\b/i,
  /\bnot enough\b/i,
];

// The ranking explainer describes how cards are chosen and never renders as a
// card, so its data-availability labels are not second-person feedback.
const EXEMPT_PREFIXES = ['insights.ranking.'];

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const regionalText = trackedText(root, 'src/i18n/locales/en-AU.json');
if (regionalText === undefined) {
  console.error('Insight valence guard: en-AU.json is not tracked.');
  process.exit(1);
}
const baseText = trackedText(root, 'src/i18n/locales/en-GB.json');
const locale = JSON.parse(regionalText);
const base = baseText ? JSON.parse(baseText) : null;
if (!base?.insights && !locale.insights) {
  console.error('Insight valence guard: no English insights namespace to read.');
  process.exit(1);
}

function* strings(node, path) {
  if (typeof node === 'string') yield [path, node];
  else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) yield* strings(value, `${path}.${key}`);
  }
}

const failures = [];
for (const [name, bundle] of [
  ['en-GB', base],
  ['en-AU', locale],
]) {
  if (!bundle?.insights) continue;
  for (const [path, copy] of strings(bundle.insights, 'insights')) {
    if (EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
    const hit = PUNITIVE_PATTERNS.find((pattern) => pattern.test(copy));
    if (hit) failures.push(`${name} ${path}: ${JSON.stringify(copy)} matches ${hit}`);
  }
}

if (failures.length > 0) {
  console.error('Punitive insight copy in en-AU.json:');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
