#!/usr/bin/env node
// Build tracematch's docs the way its own CI does, so a dead intra-doc link fails
// where it is written rather than on the submodule's push.
//
// The command is the doc step in tracematch's `.github/workflows/ci.yml`: private
// items included, since most of the detector is in private modules, and warnings
// as errors, since an unresolved link is only a warning to rustdoc. It reads the
// submodule on disk, as cargo does.

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { gitFreeEnv } from './lib/indexedSources.mjs';

const CRATE = 'modules/veloqrs/rust/tracematch';

try {
  const at = process.argv.indexOf('--root');
  const root = at === -1 ? process.cwd() : resolve(process.argv[at + 1]);
  const run = spawnSync(
    'cargo',
    ['doc', '--no-deps', '--features', 'synthetic', '--document-private-items'],
    {
      cwd: resolve(root, CRATE),
      env: { ...gitFreeEnv(), RUSTDOCFLAGS: '-D warnings' },
      stdio: 'inherit',
    }
  );
  if (run.error) throw new Error(`could not start cargo doc: ${run.error.message}`);
  if (run.status !== 0) {
    throw new Error(`cargo doc failed (${run.signal ?? `exit ${run.status}`}), see rustdoc above`);
  }
  console.log('check-tracematch-docs: every tracematch intra-doc link resolves');
} catch (error) {
  console.error(`check-tracematch-docs: ${error.message}`);
  process.exitCode = 1;
}
