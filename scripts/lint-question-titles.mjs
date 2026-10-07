#!/usr/bin/env node
// A settings group header or an info title reads as a label, so it is a noun
// phrase: "Appearance", "Card ranking". A short English string that opens with
// a question word ("What it shows me", "Why this card was chosen") is a clause
// where a noun belongs. This fails on any such string in an English locale,
// whatever its key, so a title added later is held to the same shape.
//
// A sentence or a question is not a label and passes: the string must be at
// most six words and end without punctuation.
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
const QUESTION_WORD = /^(what|how|why|where|which|who|when)\b/i;
const MAX_WORDS = 6;

const failures = [];

function walk(node, path, file) {
  for (const [key, value] of Object.entries(node)) {
    const here = path ? `${path}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      walk(value, here, file);
    } else if (typeof value === 'string') {
      const text = value.trim();
      if (
        QUESTION_WORD.test(text) &&
        text.split(/\s+/).length <= MAX_WORDS &&
        !/[.?!:]$/.test(text)
      ) {
        failures.push(`${file}  ${here} = "${value}"`);
      }
    }
  }
}

const sources = treeSources(ROOT, ['src/i18n/locales']);
refuseEmptyListing(sources, 'Question-title guard');

for (const [file, bytes] of sources) {
  if (!LOCALES.test(file)) continue;
  walk(JSON.parse(bytes.toString('utf8')), '', file);
}

if (failures.length > 0) {
  console.error('A title, header or group label opens with a question word. Use a noun.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Question-title guard: no label opens with a question word.');
