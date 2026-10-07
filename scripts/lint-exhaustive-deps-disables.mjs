#!/usr/bin/env node

import { indexedSources, refuseEmptyListing } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : process.argv[rootFlag + 1];
const tracked = indexedSources(root, ['src', 'modules/veloqrs/src']);
refuseEmptyListing(tracked, 'Exhaustive-deps disable guard');

// Effects that rebuild what they depend on from a key, so the dependency list
// is whole and a disable in them, reasoned or not, is a stale read coming back.
const NONE_ALLOWED = {
  'src/shared/native/useEngineSubscription.ts': 'the effect rebuilds its event list from the key',
  'src/shared/native/useRangeCoverage.ts': 'the read is keyed on the reader the body calls',
  'src/shared/native/useLibraryCoverage.ts': 'the read is keyed on the reader the body calls',
};

const disable = /\beslint-disable(?:-next-line|-line)?\b/;
const rule = /(?:^|[\s,])react-hooks\/exhaustive-deps(?:$|[\s,])/;
const failures = [];
for (const [file, bytes] of tracked) {
  if (!/\.tsx?$/.test(file) || /(^|\/)(?:generated|__tests__)\//.test(file)) continue;
  bytes.toString('utf8').split('\n').forEach((line, index) => {
    const markers = [line.indexOf('//'), line.indexOf('/*')].filter((position) => position !== -1);
    if (markers.length === 0) return;
    const text = line.slice(Math.min(...markers)).replace(/\*\/\s*$/, '');
    const match = disable.exec(text);
    if (!match) return;
    const directive = text.slice(match.index + match[0].length);
    const separator = directive.indexOf('--');
    const rules = separator === -1 ? directive : directive.slice(0, separator);
    if (!rule.test(rules)) return;
    if (file in NONE_ALLOWED) {
      failures.push(`${file}:${index + 1}  allows no disable: ${NONE_ALLOWED[file]}`);
    } else if (separator === -1 || !directive.slice(separator + 2).trim()) {
      failures.push(`${file}:${index + 1}  ${line.trim()}`);
    }
  });
}

if (failures.length > 0) {
  console.error(
    `An exhaustive-deps disable needs a reason, and some files allow none. ${failures.length} fail.`
  );
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('Exhaustive-deps disable guard: no unreasoned disables.');
