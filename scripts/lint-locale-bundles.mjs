#!/usr/bin/env node
// A translation that loses a `{{placeholder}}` renders without the value, and one that gains a
// name the call site never passes renders the braces. A locale missing a plural form its counts
// select reads the English form, because i18next falls back to the root bundle for that key.
// Both pass key parity, so both reached the screen unnoticed.
//
// Placeholders: every string in every bundle carries exactly the placeholders of its `en-GB`
// counterpart. A plural form is compared with the same form in `en-GB`, or with the union of the
// base's forms when English has no such form (`_few`, `_many`). The one exemption is `count` in a
// form that selects a single number in that language, where `one` may read "one" rather than "1".
//
// Plural forms: every count key `en-GB` holds as `_other` has, in each locale, every category the
// locale's CLDR rules select for a whole number, read through the locale's own fallback chain
// short of the root. A key that resolves to its English form is the defect, so English does not
// fill it in. The chain is `LOCALE_FALLBACKS` in `src/i18n/types.ts`.
//
// Count names: i18next selects a plural form only for a placeholder named `count`, so an `en-GB`
// string whose one placeholder sits before a plural noun under another name reads "1 efforts".

import ts from 'typescript';
import { refuseEmptyListing, trackedText, treeSources } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const LOCALES_DIR = 'src/i18n/locales';
const TYPES_FILE = 'src/i18n/types.ts';
const REFERENCE = 'en-GB';
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;
// Words ending in s after a value that are not plural nouns.
const NOT_PLURAL = new Set(['is', 'was', 'has', 'does', 'as', 'its', 'vs', 'this', 'thus']);
// The counts a screen interpolates are whole numbers well inside this range.
const COUNT_RANGE = 10000;

function flatten(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, out);
    else out.set(path, child);
  }
  return out;
}

export function placeholders(value) {
  if (typeof value !== 'string') return new Set();
  return new Set([...value.matchAll(/\{\{-?\s*([\w.]+)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1]));
}

/** `LOCALE_FALLBACKS` read out of the types module, without running it. */
function fallbackChains(text) {
  const source = ts.createSourceFile(TYPES_FILE, text, ts.ScriptTarget.Latest, true);
  const chains = new Map();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(source) === 'LOCALE_FALLBACKS' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const name = property.name;
        const key = ts.isStringLiteral(name) ? name.text : name.getText(source);
        if (!ts.isArrayLiteralExpression(property.initializer)) continue;
        chains.set(
          key,
          property.initializer.elements.filter(ts.isStringLiteral).map((element) => element.text)
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return chains;
}

/** The whole numbers each plural category selects in `locale`, up to `COUNT_RANGE`. */
function categoryCounts(locale) {
  const rules = new Intl.PluralRules(locale);
  const counts = new Map();
  for (let n = 0; n <= COUNT_RANGE; n++) {
    const category = rules.select(n);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return counts;
}

const sources = treeSources(root, [LOCALES_DIR]);
refuseEmptyListing(sources, 'Locale bundle guard');

const bundles = new Map();
for (const [file, bytes] of sources) {
  const match = file.match(/^src\/i18n\/locales\/([\w-]+)\.json$/);
  if (match) bundles.set(match[1], flatten(JSON.parse(bytes.toString('utf8'))));
}
const reference = bundles.get(REFERENCE);
if (!reference) {
  console.error(`Locale bundle guard: ${LOCALES_DIR}/${REFERENCE}.json is missing.`);
  process.exit(1);
}
const typesText = trackedText(root, TYPES_FILE);
if (typesText === undefined) {
  console.error(`Locale bundle guard: ${TYPES_FILE} is missing, so no fallback chain is known.`);
  process.exit(1);
}
const chains = fallbackChains(typesText);

// Every placeholder any form of a base carries in the reference.
const referenceBases = new Map();
for (const [key, value] of reference) {
  const base = key.replace(PLURAL_SUFFIX, '');
  const names = referenceBases.get(base) ?? new Set();
  for (const name of placeholders(value)) names.add(name);
  referenceBases.set(base, names);
}
const countBases = [...reference.keys()]
  .filter((key) => key.endsWith('_other'))
  .map((key) => key.slice(0, -'_other'.length));

const failures = [];

for (const [key, value] of reference) {
  if (PLURAL_SUFFIX.test(key)) continue;
  const names = placeholders(value);
  if (names.size !== 1) continue;
  const [name] = names;
  if (name === 'count') continue;
  const escaped = name.replace(/\./g, '\\.');
  const word = value.match(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\} ([a-z]+)\\b`))?.[1];
  if (word && /[^s]s$/.test(word) && !NOT_PLURAL.has(word)) {
    failures.push(
      `${REFERENCE}: ${key} puts {{${name}}} before a plural noun, so it reads "1 ${word}": name it {{count}} and give it plural forms`
    );
  }
}

for (const [locale, bundle] of bundles) {
  if (locale === REFERENCE) continue;
  const counts = categoryCounts(locale);
  for (const [key, value] of bundle) {
    const base = key.replace(PLURAL_SUFFIX, '');
    const allowed = referenceBases.get(base);
    if (!allowed) continue;
    const expected = reference.has(key) ? placeholders(reference.get(key)) : allowed;
    const actual = placeholders(value);
    const category = key.match(PLURAL_SUFFIX)?.[1];
    for (const name of expected) {
      if (actual.has(name)) continue;
      if (name === 'count' && category && counts.get(category) === 1) continue;
      failures.push(`${locale}: ${key} drops {{${name}}}`);
    }
    for (const name of actual) {
      if (!allowed.has(name))
        failures.push(`${locale}: ${key} adds {{${name}}}, which en-GB lacks`);
    }
  }
}

for (const locale of bundles.keys()) {
  if (locale === REFERENCE) continue;
  const english = locale === 'en' || locale.startsWith('en-');
  const chain = (chains.get(locale) ?? [locale]).filter((entry) => entry !== REFERENCE || english);
  if (!chain.includes(locale)) chain.unshift(locale);
  const visible = (key) => chain.some((entry) => bundles.get(entry)?.has(key));
  for (const category of categoryCounts(locale).keys()) {
    for (const base of countBases) {
      if (!visible(`${base}_${category}`)) {
        failures.push(`${locale}: ${base}_${category} is missing, so its counts read in English`);
      }
    }
  }
}

if (failures.length > 0) {
  console.error('A translation whose placeholders or plural forms differ from what it needs:\n');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`Locale bundles: placeholders and plural forms hold in ${bundles.size} bundles.`);
