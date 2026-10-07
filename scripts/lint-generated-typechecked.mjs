#!/usr/bin/env node
// The generated bindings are typechecked with the app, by `tsconfig.generated.json`. A
// `@ts-nocheck` in one of them takes it back out, so a generator change that breaks a
// caller's types passes `tsc`. The generator emits it unless `strictTypeChecking` is on in
// `modules/veloqrs/rust/veloqrs/uniffi.toml`.

import { resolve } from 'node:path';
import { treeSources } from './lib/indexedSources.mjs';

const rootFlag = process.argv.indexOf('--root');
const root = rootFlag === -1 ? process.cwd() : resolve(process.argv[rootFlag + 1]);
const dir = 'modules/veloqrs/src/generated';

const offenders = [...treeSources(root, [dir])]
  .filter(([file]) => /^[^/]+\.tsx?$/.test(file.slice(dir.length + 1)))
  .filter(([, bytes]) => /^\s*\/\/\s*@ts-nocheck\b/m.test(bytes.toString('utf8')))
  .map(([file]) => file.slice(dir.length + 1));

if (offenders.length > 0) {
  console.error('generated bindings opt out of the typecheck with @ts-nocheck:');
  for (const name of offenders) console.error(`  modules/veloqrs/src/generated/${name}`);
  console.error('set strictTypeChecking = true in modules/veloqrs/rust/veloqrs/uniffi.toml and regenerate.');
  process.exit(1);
}
