#!/usr/bin/env node
// Prints one locale's translation review sheet: every value it accepts as
// identical to en-US, with the en-US value and the reason, and every value it
// has changed since a revision. Reads the bundles and the accepted list from
// the working tree, so the sheet is rewritten on demand rather than kept. Each
// value is what a reader sees, resolved through the locale's fallback chain.
//
// Usage: node scripts/translation-review-sheet.mjs <locale> [--since <rev>]
//
// --since defaults to the commit that added the accepted list.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LOCALE_FALLBACKS } from '../src/i18n/types.ts';

const { resolvedBundle, reviewSheet } = createRequire(import.meta.url)(
  './lib/translation-review.js'
);

const LOCALES = 'src/i18n/locales';
const ACCEPTED = 'src/__tests__/i18n/acceptedIdenticalValues.json';
const load = (name) => JSON.parse(readFileSync(`${LOCALES}/${name}.json`, 'utf8'));

const args = process.argv.slice(2);
const sinceAt = args.indexOf('--since');
const since = sinceAt === -1 ? null : args.splice(sinceAt, 2)[1];
const [locale] = args;
if (!locale || (sinceAt !== -1 && !since)) {
  console.error('usage: translation-review-sheet.mjs <locale> [--since <rev>]');
  process.exit(2);
}

const git = (...gitArgs) => execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

const path = `${LOCALES}/${locale}.json`;
try {
  json(path);
} catch {
  console.error(`no locale bundle at ${path}`);
  process.exit(2);
}

const base = since ?? git('log', '--diff-filter=A', '--format=%h', '-1', '--', ACCEPTED);
if (!base) {
  console.error(`no commit adds ${ACCEPTED}; pass --since <rev>`);
  process.exit(2);
}
try {
  git('rev-parse', '--verify', '--quiet', `${base}^{commit}`);
} catch {
  console.error(`${base} is not a commit`);
  process.exit(2);
}

let before = {};
try {
  before = JSON.parse(
    execFileSync('git', ['show', `${base}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  );
} catch {
  // The locale did not exist at that revision, so every value is new.
}

process.stdout.write(
  reviewSheet({
    locale,
    since: base,
    // en-US holds only its overrides, and es-ES only the keys it differs on, so
    // each side is what a reader sees after the fallback chain.
    reference: resolvedBundle(LOCALE_FALLBACKS['en-US'], load),
    current: resolvedBundle(LOCALE_FALLBACKS[locale] ?? [locale], load),
    before,
    accepted: json(ACCEPTED)[locale] ?? {},
  })
);
