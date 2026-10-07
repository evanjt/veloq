#!/usr/bin/env node
// A repeated base value masks later edits to the base in a regional locale.

import { trackedText } from './lib/indexedSources.mjs';

const rootIndex = process.argv.indexOf('--root');
const root = rootIndex === -1 ? process.cwd() : process.argv[rootIndex + 1];
const pairs = [
  ['en-AU', 'en-GB'],
  ['en-US', 'en-GB'],
  ['es-419', 'es'],
  ['es-ES', 'es'],
];

function bundle(locale) {
  const file = `src/i18n/locales/${locale}.json`;
  const text = trackedText(root, file);
  if (text === undefined) throw new Error(`Regional locale guard cannot read ${file}`);
  return JSON.parse(text);
}

function repeatedKeys(variant, base, prefix = '') {
  const repeated = [];
  for (const [key, value] of Object.entries(variant)) {
    const path = prefix ? `${prefix}.${key}` : key;
    const inherited = base?.[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      repeated.push(...repeatedKeys(value, inherited, path));
    } else if (value === inherited) {
      repeated.push(path);
    }
  }
  return repeated;
}

const failures = pairs.flatMap(([variant, base]) =>
  repeatedKeys(bundle(variant), bundle(base)).map((key) => `${variant}: ${key} repeats ${base}`)
);

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Regional locale bundles contain only differing values.');
