#!/usr/bin/env node
// English labels and titles are written in sentence case: "Edit bounds",
// "Local data range". A word after the first that opens with a capital and a
// lower-case letter is title case, and one such label beside sentence-case
// ones makes the same term read two ways on one screen. This fails on any such
// string in an English locale, whatever its key, so a label added later is
// held to the same shape. A capital after a hyphen counts the same way,
// "Auto-Pause" beside "Auto-pause delay".
//
// A sentence is not a label and is not read: a string that ends in a full
// stop, a question mark or an exclamation mark is prose, and the capitals in
// it name things the rule cannot tell apart from a title.
//
// What keeps its capitals: a proper noun or product name from the list below,
// an acronym or a mixed-case name ("GPS", "eFTP", "iCloud"), the first word
// after a full stop, a bullet or an arrow, the activity type names, the
// generated route name, and the cited titles of outside articles, which are
// quoted as their authors wrote them.
//
// `--root` points the lint at another tree, so the rule itself can be tested.

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const rootArg = process.argv.indexOf('--root');
const ROOT =
  rootArg === -1
    ? join(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootArg + 1]);

const LOCALES = /^src\/i18n\/locales\/en(-[A-Za-z]+)?\.json$/;

// Names written as their owners write them. A phrase is matched before its
// words are read, so "Drive" passes inside "Google Drive" and nowhere else.
const PROPER_PHRASES = [
  'Google Drive',
  'iCloud Drive',
  'Live Activities',
  'Bluetooth LE',
  'Garmin Connect',
  "Garmin's",
];
const PROPER_WORDS = new Set([
  'Android',
  'Apache',
  'Apple',
  'Bluetooth',
  'Celsius',
  'Fahrenheit',
  'Garmin',
  'GitHub',
  'Google',
  'Nextcloud',
  'OAuth',
  'OpenStreetMap',
  'Settings',
  'Veloq',
  'WebDAV',
]);

// Whole subtrees and keys whose capitals are part of a name.
const EXEMPT_PREFIXES = ['activityTypes.'];
// A generated route name is stored with the route, so it keeps the shape the
// routes already named carry.
const EXEMPT_KEYS = new Set([
  'fitnessScreen.linkTSBManagement',
  'fitnessScreen.linkTrainingLoad',
  'routes.placeLoop',
]);

const SENTENCE_END = /[.!?]$/;
const SEPARATOR = /^[•→]$/;
const TITLE_WORD = /^[A-Z][a-z]/;

function titleCaseWords(value) {
  if (SENTENCE_END.test(value.trim())) return [];
  let text = value.replace(/\{\{[^}]*\}\}/g, 'x');
  for (const phrase of PROPER_PHRASES) text = text.split(phrase).join('x');
  const words = text.trim().split(/\s+/);
  const found = [];
  for (const word of words) {
    for (const part of word.split('-').slice(1)) {
      if (TITLE_WORD.test(part) && !PROPER_WORDS.has(part)) found.push(word);
    }
  }
  for (let i = 1; i < words.length; i++) {
    const previous = words[i - 1];
    if (SENTENCE_END.test(previous) || SEPARATOR.test(previous)) continue;
    const word = words[i].replace(/^[("'‘“]+|[)"'’”,;:.!?]+$/g, '');
    if (!TITLE_WORD.test(word) || PROPER_WORDS.has(word)) continue;
    found.push(word);
  }
  return found;
}

const failures = [];

function walk(node, path, file) {
  for (const [key, value] of Object.entries(node)) {
    const here = path ? `${path}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      walk(value, here, file);
    } else if (typeof value === 'string') {
      if (EXEMPT_KEYS.has(here) || EXEMPT_PREFIXES.some((p) => here.startsWith(p))) continue;
      const words = titleCaseWords(value);
      if (words.length > 0) {
        failures.push(`${file}  ${here} = "${value}"  (${words.join(', ')})`);
      }
    }
  }
}

const sources = treeSources(ROOT, ['src/i18n/locales']);
refuseEmptyListing(sources, 'Sentence-case guard');

for (const [file, bytes] of sources) {
  if (!LOCALES.test(file)) continue;
  walk(JSON.parse(bytes.toString('utf8')), '', file);
}

if (failures.length > 0) {
  console.error(
    'An English label is in title case. Write it in sentence case, or add a proper noun to the list in this script.\n'
  );
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Sentence-case guard: every English label is in sentence case.');
