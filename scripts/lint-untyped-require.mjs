#!/usr/bin/env node
// A destructured `require('@/…')` is typed `any`, so a name the module does not
// export typechecks and throws on first call. The cast to `typeof import(…)`
// makes `tsc` refuse the name. Applies to feature barrels, `@/features/<name>`. `--root` points the lint at another tree.

import { resolve } from 'node:path';
import { refuseEmptyListing, treeSources } from './lib/indexedSources.mjs';

const rootArg = process.argv.indexOf('--root');
const root = rootArg === -1 ? process.cwd() : resolve(process.argv[rootArg + 1]);

const DESTRUCTURE = /=\s*require\(\s*(['"])(@\/features\/[a-z]+)\1\s*\)(\s*as\s+typeof\s+import\()?/g;

const tracked = treeSources(root, ['src']);
refuseEmptyListing(tracked, 'lint:untyped-require');

function* sources() {
  for (const [file, bytes] of tracked) {
    if (file.split('/').some((part) => part === '__tests__' || part === 'node_modules')) continue;
    if (/\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file)) yield [file, bytes.toString('utf8')];
  }
}

const found = [];
for (const [file, text] of sources()) {
  for (const m of text.matchAll(DESTRUCTURE)) {
    if (m[3]) continue;
    // Only a destructure, `const { … } = require(…)`, loses names silently.
    const before = text.slice(0, m.index).trimEnd();
    if (!before.endsWith('}')) continue;
    const line = text.slice(0, m.index).split('\n').length;
    found.push(`${file}:${line} require('${m[2]}') is not cast to typeof import`);
  }
}

if (found.length > 0) {
  console.error(found.join('\n'));
  process.exit(1);
}
