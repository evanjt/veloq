#!/usr/bin/env node
// App code calls no synchronous generated free function as a value imported from
// `veloqrs`: it goes through the engine client, which times it.
//
// `modules/veloqrs/src/index.ts` re-exports the whole generated file, so a
// screen can import `startFetchAndStore` and call it with nothing between it and
// Rust. Every synchronous engine call blocks the JS thread, and the Developer
// Dashboard's FFI table is filled only by the client's `timed`, so a call made
// that way ran on the thread and left no row. The asynchronous exports return a
// Promise and do not block, so they stay importable. A type import is erased and
// is not a call.
//
// The synchronous names are read off the generated bindings, so a new export is
// covered the day it is generated. The module's own sources and the tests, which
// mock the module, are not counted.

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeSources, trackedText } from './lib/indexedSources.mjs';

// `--root` points the guard at another tree, so the rule itself can be tested.
const rootFlag = process.argv.indexOf('--root');
const ROOT =
  rootFlag === -1
    ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
    : resolve(process.argv[rootFlag + 1]);
const GENERATED = 'modules/veloqrs/src/generated/veloqrs.ts';

const generated = trackedText(ROOT, GENERATED);
if (generated === undefined) {
  console.error(`lint-generated-free-functions: ${GENERATED} is not in the tree`);
  process.exit(2);
}

// `export function` and not `export async function`: only the first blocks.
const SYNC = new Set([...generated.matchAll(/^export function (\w+)\(/gm)].map((m) => m[1]));

const VALUE_IMPORT = /import\s+(?!type\b)\{([^}]*)\}\s+from\s+'veloqrs'/g;
const REQUIRE = /(?:const|let)\s+\{([^}]*)\}\s*=\s*require\('veloqrs'\)/g;

const names = (list) =>
  list
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !part.startsWith('type '))
    .map((part) => part.split(/\s+as\s+|\s*:\s*/)[0]);

const offences = [];
for (const [rel, buffer] of treeSources(ROOT, ['src'])) {
  if (!/\.tsx?$/.test(rel) || rel.startsWith('src/__tests__/')) continue;
  const text = buffer.toString('utf8');
  for (const pattern of [VALUE_IMPORT, REQUIRE]) {
    for (const match of text.matchAll(pattern)) {
      for (const name of names(match[1])) {
        if (SYNC.has(name)) offences.push(`${rel}: ${name}`);
      }
    }
  }
}

if (offences.length > 0) {
  console.error(
    'A synchronous generated function is imported as a value from veloqrs, so its calls skip\n' +
      "the engine client's timing and never reach the FFI table. Call it through `engine`:\n" +
      offences.map((line) => `  ${line}`).join('\n')
  );
  process.exit(1);
}
console.log(`No app file imports one of the ${SYNC.size} synchronous generated functions.`);
