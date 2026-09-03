#!/usr/bin/env node
// style.md is Australian English, and the veloqrs crate carried both forms at
// once: `normalize_features` beside `normalised`, `materialized` beside
// `ensure_visit_count_denormalisation`. A grep for one form then misses the
// other, which is how the pair survived three readings.
//
// EXEMPT holds the words that are not ours to spell. They fall into four
// groups and each needs a reason, not just an entry.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'modules/veloqrs/rust/veloqrs/src';

// The two English locale files. Every user-facing string in the app is here,
// and `Reanalyze sections` shipped to en-AU because nothing outside the crate
// was ever scanned. Only the values are read: a key is a shared identifier
// across all seventeen locales and renaming one is not a spelling change.
const LOCALES = ['src/i18n/locales/en-AU.json', 'src/i18n/locales/en-GB.json'];

// American -> Australian, for words this project invented.
const BANNED = [
  ['normaliz', 'normalis'],
  ['materializ', 'materialis'],
  ['optimiz', 'optimis'],
  ['initializ', 'initialis'],
  ['rasteriz', 'rasteris'],
  ['recogniz', 'recognis'],
  ['behavior', 'behaviour'],
  ['color', 'colour'],
  ['analyz', 'analys'],
];

// Not ours to spell. Each entry is matched case-insensitively as a substring.
const EXEMPT = [
  // serde derives and its trait names.
  'serialize',
  'deserialize',
  'serialization',
  // HTTP, the header and the status are spelled by the RFC.
  'authorization',
  'unauthorized',
  // The UniFFI surface. A rename here is a breaking change for the generated
  // TypeScript and the FFI manifest, so it belongs to the FFI rename, not to
  // spelling.
  'notinitialized',
  'is_initialized',
  // android_logger's own error variant, quoted in a comment.
  'alreadyinitialized',
  // The tracematch submodule's own module path.
  'sections::optimized',
  // A phase token that crosses the FFI as data and is keyed on in
  // TypeScript at features/routes/lib/detectionProgress.ts.
  '"analyzing"',
];

// The crate's allowlist is not this one. `"analyzing"` is a phase token that
// crosses the FFI as data, and a string an athlete reads is never that.
const LOCALE_EXEMPT = [];

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];

function sources() {
  const out = execFileSync('git', ['ls-files', '-z', ROOT], { cwd: root, encoding: 'utf8' });
  return out.split('\0').filter((f) => f.endsWith('.rs'));
}

function withoutExempt(line) {
  let rest = line.toLowerCase();
  for (const word of EXEMPT) rest = rest.split(word).join(' ');
  return rest;
}

function offences(text, exempt) {
  let rest = text.toLowerCase();
  for (const word of exempt) rest = rest.split(word).join(' ');
  for (const [bad, good] of BANNED) {
    if (rest.includes(bad)) return [bad, good];
  }
  return null;
}

function localeFailures(root) {
  const found = [];
  for (const file of LOCALES) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(root, file), 'utf8'));
    } catch {
      continue;
    }
    const walk = (node, path) => {
      for (const [key, value] of Object.entries(node)) {
        if (typeof value === 'string') {
          const hit = offences(value, LOCALE_EXEMPT);
          if (hit) found.push(`${file}  ${path}${key}  ${hit[0]} -> ${hit[1]}  ${value}`);
        } else if (value && typeof value === 'object') {
          walk(value, `${path}${key}.`);
        }
      }
    };
    walk(parsed, '');
  }
  return found;
}

const failures = [];
for (const file of sources()) {
  let text;
  try {
    text = readFileSync(join(root, file), 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    const rest = withoutExempt(line);
    for (const [bad, good] of BANNED) {
      if (rest.includes(bad)) {
        failures.push(`${file}:${i + 1}  ${bad} -> ${good}  ${line.trim()}`);
        break;
      }
    }
  });
}

failures.push(...localeFailures(root));

if (failures.length > 0) {
  console.error(`style.md is Australian English. ${failures.length} lines are not.`);
  console.error('Add a word to EXEMPT only when it is not ours to spell, with the reason.\n');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}

console.log('Spelling guard: the crate and the English locales are Australian English throughout.');
