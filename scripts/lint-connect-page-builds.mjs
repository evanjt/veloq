#!/usr/bin/env node
// The connect page bundles app modules that import names from `@/theme`, which the build resolves
// to web/connect/theme.ts. A name the app's theme index exports and the subset lacks only fails
// when the page is bundled, so this builds it into a scratch directory and fails on any error.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = mkdtempSync(join(tmpdir(), 'connect-page-'));
const run = spawnSync(
  process.execPath,
  [join(ROOT, 'scripts/build-connect-page.mjs'), '--root', ROOT, '--out', out],
  { encoding: 'utf8' }
);
rmSync(out, { recursive: true, force: true });
if (run.error) {
  console.error(`the connect page build did not start: ${run.error.message}`);
  process.exit(1);
}
if (run.status !== 0) {
  console.error(`the connect page does not build:\n${run.stderr || run.stdout}`);
  process.exit(1);
}
