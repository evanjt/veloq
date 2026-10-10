#!/usr/bin/env node
// Typecheck the OAuth proxy as the index holds it.
//
// The proxy is its own package with its own tsconfig and install, so neither the
// root `tsc` nor any other gate reads it, and a type error in it reached main
// with every local gate green. This writes the indexed `oauth-proxy/` into a
// temporary directory and runs the proxy's own compiler over it, so an unstaged
// edit in a shared checkout is not judged and a staged one is.
//
// The compiler and the Workers types come from the proxy's install: this tree's
// `oauth-proxy/node_modules`, else the main checkout's, since a worktree has
// none of its own. With neither, it fails and names the install, because a
// typecheck that skips when it cannot run is the gap it closes.
//
// Usage: node scripts/check-oauth-proxy-types.mjs [--root <repo>] [--modules <node_modules>]

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, indexedSources } from './lib/indexedSources.mjs';

const PROXY = 'oauth-proxy';

const argv = process.argv.slice(2);
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const root = resolve(flag('--root') ?? process.cwd());

function mainCheckout(tree) {
  try {
    const common = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd: tree,
        env: gitFreeEnv(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim();
    return dirname(common);
  } catch {
    return undefined;
  }
}

function proxyModules() {
  if (flag('--modules')) return [resolve(flag('--modules'))];
  const main = mainCheckout(root);
  return [join(root, PROXY, 'node_modules'), ...(main ? [join(main, PROXY, 'node_modules')] : [])];
}

const candidates = proxyModules();
const modules = candidates.find((dir) => existsSync(join(dir, 'typescript/bin/tsc')));
if (!modules) {
  console.error(
    `check-oauth-proxy-types: no TypeScript compiler in ${candidates.join(' or ')}. ` +
      `Install the proxy's dependencies with npm --prefix oauth-proxy ci, in the main checkout.`
  );
  process.exit(1);
}

const sources = indexedSources(root, [PROXY]);
if (!sources.has(`${PROXY}/tsconfig.json`)) {
  console.error(`check-oauth-proxy-types: the index holds no ${PROXY}/tsconfig.json`);
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), 'oauth-proxy-types-'));
let status = 1;
try {
  for (const [path, bytes] of sources) {
    mkdirSync(dirname(join(scratch, path)), { recursive: true });
    writeFileSync(join(scratch, path), bytes);
  }
  // `types` resolves from the tsconfig's ancestors, and the scratch tree has no
  // install, so the type roots point at the one that was found.
  const run = spawnSync(
    process.execPath,
    [
      join(modules, 'typescript/bin/tsc'),
      '--noEmit',
      '--pretty',
      'false',
      '-p',
      PROXY,
      '--typeRoots',
      modules,
    ],
    { cwd: scratch, encoding: 'utf8' }
  );
  if (run.error)
    console.error(`check-oauth-proxy-types: could not start tsc: ${run.error.message}`);
  process.stdout.write(run.stdout ?? '');
  process.stderr.write(run.stderr ?? '');
  status = run.status ?? 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (status !== 0) {
  console.error(`check-oauth-proxy-types: ${PROXY} fails its typecheck`);
}
process.exit(status);
