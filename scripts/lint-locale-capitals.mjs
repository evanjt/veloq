#!/usr/bin/env node
// A label stored in capitals while the type scale sets it in capitals has two owners of its
// case. A screen reader spells it letter by letter, it cannot be reused inside a sentence, and it
// stays in capitals when the style it sits in no longer wants them. The uppercase roles in
// `src/theme/typography.ts` carry the case, so the string is written in sentence case.
//
// Refused in every bundle under `src/i18n/locales`: a value with no lower-case letter that holds
// a word of three or more capitals other than the acronyms listed below. A word of two capitals
// is an abbreviation (`PR`, `HF`), and a script without case (Japanese, Chinese) holds no lower
// case at all, so only its capitalised words are read, and an acronym among them passes.

import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

const LOCALES_DIR = 'src/i18n/locales';

// Acronyms every language writes in capitals, each with what it stands for. A translated acronym
// is listed under the language that writes it.
const ACRONYMS = new Map([
  ['TRIMP', 'training impulse'],
  ['HIIT', 'high-intensity interval training'],
  ['GPS', 'the satellite positioning system'],
  ['FTP', 'functional threshold power'],
  ['HRV', 'heart rate variability'],
  ['RHR', 'resting heart rate'],
  ['LTHR', 'lactate threshold heart rate'],
  ['CTL', 'chronic training load'],
  ['ATL', 'acute training load'],
  ['TSB', 'training stress balance'],
  ['CSS', 'critical swim speed'],
  ['SWOLF', "swim golf, a length's time in seconds plus its stroke count"],
  ['GAP', 'grade-adjusted pace'],
  ['RPE', 'rate of perceived exertion'],
  ['BPM', 'beats per minute'],
  ['GPX', 'a file format name'],
  ['FIT', 'a file format name'],
  ['SUP', 'stand-up paddling'],
  ['REC', 'the recording indicator, written in capitals on recorders in every language'],
  ['API', 'application programming interface, beside the data service key'],
  ['URL', 'a web address'],
  ['FFI', 'the engine call boundary on the developer dashboard'],
  ['RHF', 'resting heart rate, in German'],
  ['AGB', 'terms and conditions, in German'],
  ['FCR', 'resting heart rate, in Spanish, French, Italian and Portuguese'],
  ['VFC', 'heart rate variability, in Spanish, French and Portuguese'],
  ['VNC', 'critical swim speed, in Spanish'],
  ['VCC', 'critical swim speed, in French'],
  ['DPA', 'grade-adjusted pace, in Spanish'],
  ['DAP', 'grade-adjusted pace, in French'],
  ['VTT', 'mountain bike, in French'],
  ['BTT', 'mountain bike, in Portuguese'],
]);

function flatten(value, prefix = '', out = new Map()) {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, path, out);
    else out.set(path, child);
  }
  return out;
}

/** Whether `value` is written entirely in capitals, beyond the acronyms it may carry. */
export function storedInCapitals(value) {
  if (typeof value !== 'string') return false;
  const text = value.replace(/\{\{[^}]*\}\}/g, ' ');
  if (/\p{Ll}/u.test(text)) return false;
  const words = text.match(/\p{Lu}+/gu) ?? [];
  return words.some((word) => [...word].length >= 3 && !ACRONYMS.has(word));
}

const sources = treeSources(root, [LOCALES_DIR]);
refuseEmptyListing(sources, 'Locale capitals guard');

const failures = [];
for (const [file, bytes] of sources) {
  const match = file.match(/^src\/i18n\/locales\/([\w-]+)\.json$/);
  if (!match) continue;
  for (const [key, value] of flatten(JSON.parse(bytes.toString('utf8')))) {
    if (storedInCapitals(value)) failures.push(`${match[1]}: ${key} ${JSON.stringify(value)}`);
  }
}

if (failures.length > 0) {
  console.error(
    'A label stored in capitals. Write it in sentence case and let an uppercase type role set the capitals:\n'
  );
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}
console.log(`Locale capitals: no label is stored in capitals in ${sources.size} bundles.`);
