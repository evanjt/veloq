#!/usr/bin/env node
// `EngineClient` calls the engine through the generated handle, which `tsc` checks. A cast
// through `unknown` on that handle or on the generated namespace swaps in a hand-written
// shape, so a renamed export or field passes the typecheck and fails on the device.

import { resolve } from 'node:path';
import { treeSources } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(process.argv[rootFlag + 1]);
const file = 'modules/veloqrs/src/EngineClient.ts';

const source = treeSources(root, [file]).get(file)?.toString('utf8') ?? '';
const offenders = source
  .split('\n')
  .map((text, index) => ({ text, line: index + 1 }))
  .filter(({ text }) => /\b(this\.engine|generated)\s+as\s+unknown\s+as\b/.test(text));

if (offenders.length > 0) {
  console.error(`${file} casts the engine handle or the bindings through unknown:`);
  for (const { line } of offenders) console.error(`  ${file}:${line}`);
  console.error('call the generated export directly so tsc checks its name and types.');
  process.exit(1);
}
