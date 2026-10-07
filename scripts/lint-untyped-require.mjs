#!/usr/bin/env node
// A destructured `require('@/…')` is typed `any`, so a name the module does not
// export typechecks and throws on first call. The cast to `typeof import(…)`
// makes `tsc` refuse the name. Applies to feature barrels, `@/features/<name>`. `--root` points the lint at another tree.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const rootArg = process.argv.indexOf('--root');
const root = rootArg === -1 ? process.cwd() : resolve(process.argv[rootArg + 1]);

const DESTRUCTURE = /=\s*require\(\s*(['"])(@\/features\/[a-z]+)\1\s*\)(\s*as\s+typeof\s+import\()?/g;

function* sources(dir) {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* sources(path);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield path;
  }
}

const found = [];
for (const file of sources(join(root, 'src'))) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(DESTRUCTURE)) {
    if (m[3]) continue;
    // Only a destructure, `const { … } = require(…)`, loses names silently.
    const before = text.slice(0, m.index).trimEnd();
    if (!before.endsWith('}')) continue;
    const line = text.slice(0, m.index).split('\n').length;
    found.push(`${relative(root, file)}:${line} require('${m[2]}') is not cast to typeof import`);
  }
}

if (found.length > 0) {
  console.error(found.join('\n'));
  process.exit(1);
}
