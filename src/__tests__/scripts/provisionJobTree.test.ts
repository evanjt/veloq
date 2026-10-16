/**
 * Scenario: a lead starts dozens of jobs on one host, each in a fresh worktree
 * with no `node_modules` and an empty target directory. Each job installed its
 * own packages and its gates compiled the engine, the same compile once per
 * tree.
 *
 * Expected behaviour: `scripts/provision-job-tree.sh`, run in the new tree,
 * links the main checkout's install one entry at a time with `veloqrs` the
 * tree's own, and fills the machine's engine library cache for the tree's Rust
 * source, so the second tree at that source compiles nothing. A tree on another
 * lockfile, or beside a main checkout with no install, installs its own.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/provision-job-tree.sh');
const MODULE_SCRIPTS = ['host-library.sh', 'with-cargo-slot.sh', 'rust-inputs.js'];

let box: string;

beforeEach(() => {
  box = realpathSync(mkdtempSync(join(tmpdir(), 'provision-job-')));
});

afterEach(() => rmSync(box, { recursive: true, force: true }));

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, env: gitFreeEnv(), encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout;
}

function write(root: string, file: string, contents: string, mode = 0o644): void {
  const full = join(root, file);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents, { mode });
}

/** Stand-ins for the toolchain and npm, each recording that it ran. */
function tools(): string {
  const bin = join(box, 'bin');
  write(
    bin,
    'rustc',
    '#!/bin/sh\nprintf "rustc 1.95.0\\nhost: x86_64-unknown-linux-gnu\\n"\n',
    0o755
  );
  write(
    bin,
    'cargo',
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.appendFileSync(process.env.TEST_BUILDS, process.cwd() + '\\n');
const dir = path.join(process.cwd(), 'target/x86_64-unknown-linux-gnu/debug');
fs.mkdirSync(dir, { recursive: true });
const library = path.join(dir, 'libveloqrs.so');
fs.writeFileSync(library, 'engine');
console.log(JSON.stringify({ reason: 'compiler-artifact', target: { name: 'veloqrs' }, filenames: [library] }));
`,
    0o755
  );
  write(
    bin,
    'npm',
    `#!/bin/sh
echo "$*" >> "$TEST_NPM"
if [ "$1" = ci ]; then
  mkdir -p node_modules/own-install
  echo '{}' > node_modules/.package-lock.json
fi
`,
    0o755
  );
  return bin;
}

/** A main checkout with an installed `node_modules`, and two job trees made from it. */
function fixture() {
  const main = join(box, 'veloq');
  mkdirSync(main);
  git(main, 'init', '-q', '-b', 'main');
  write(main, '.gitignore', 'node_modules/\ntarget/\n');
  write(main, 'package.json', '{ "name": "fixture", "private": true }\n');
  write(main, 'package-lock.json', '{ "lockfileVersion": 3, "packages": {} }\n');
  write(main, 'modules/veloqrs/index.ts', 'export const engine = 1;\n');
  write(main, 'modules/veloqrs/rust/Cargo.toml', '[workspace]\nmembers = []\n');
  write(main, 'modules/veloqrs/rust/src/lib.rs', 'pub fn engine() {}\n');
  for (const file of MODULE_SCRIPTS) {
    const target = join(main, 'modules/veloqrs/scripts', file);
    mkdirSync(join(target, '..'), { recursive: true });
    copyFileSync(join(REPO, 'modules/veloqrs/scripts', file), target);
    chmodSync(target, 0o755);
  }
  git(main, 'add', '-A');
  git(main, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');

  write(main, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
  symlinkSync(join(main, 'modules/veloqrs'), join(main, 'node_modules/veloqrs'));

  const first = join(box, 'job-first');
  const second = join(box, 'job-second');
  git(main, 'worktree', 'add', '-q', '-b', 'job-first', first);
  git(main, 'worktree', 'add', '-q', '-b', 'job-second', second);
  return { main, first, second };
}

const bin = () => join(box, 'bin');
const builds = () => join(box, 'builds.log');
const npmLog = () => join(box, 'npm.log');
const count = (file: string) =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;

function provision(tree: string) {
  const result = spawnSync('bash', [SCRIPT], {
    cwd: tree,
    encoding: 'utf8',
    env: {
      ...gitFreeEnv(),
      PATH: `${bin()}:${process.env.PATH}`,
      VELOQ_ENGINE_CACHE: join(box, 'engine cache'),
      VELOQ_CARGO_SLOT_DIR: join(box, 'slots'),
      VELOQ_CARGO_SLOT_HELD: '',
      TEST_BUILDS: builds(),
      TEST_NPM: npmLog(),
    },
  });
  return { status: result.status ?? -1, output: `${result.stdout}${result.stderr}` };
}

beforeEach(() => {
  tools();
});

it('links the main checkout’s install with veloqrs the tree’s own, and installs nothing', () => {
  const { main, first } = fixture();

  const { status, output } = provision(first);

  expect(output).not.toMatch(/fatal/);
  expect(status).toBe(0);
  expect(lstatSync(join(first, 'node_modules')).isSymbolicLink()).toBe(false);
  expect(readlinkSync(join(first, 'node_modules/left-pad'))).toBe(
    join(main, 'node_modules/left-pad')
  );
  expect(readlinkSync(join(first, 'node_modules/veloqrs'))).toBe(join(first, 'modules/veloqrs'));
  expect(count(npmLog())).toBe(0);
});

it('builds the engine for the first tree at a Rust source and none for the second', () => {
  const { first, second } = fixture();

  expect(provision(first).status).toBe(0);
  expect(count(builds())).toBe(1);

  expect(provision(second).status).toBe(0);

  expect(count(builds())).toBe(1);
  expect(existsSync(join(second, 'modules/veloqrs/rust/target'))).toBe(false);
});

it('gives a tree on another lockfile an install of its own, with nothing linked into it', () => {
  const { first } = fixture();
  write(first, 'package-lock.json', '{ "lockfileVersion": 3, "packages": { "x": {} } }\n');

  const { status, output } = provision(first);

  expect(status).toBe(0);
  expect(output).toContain('lockfile');
  expect(readFileSync(npmLog(), 'utf8')).toMatch(/^ci/m);
  expect(existsSync(join(first, 'node_modules/own-install'))).toBe(true);
  expect(existsSync(join(first, 'node_modules/left-pad'))).toBe(false);
});

it('installs in the tree when the main checkout has no install, and says how to spare the next', () => {
  const { main, first } = fixture();
  rmSync(join(main, 'node_modules'), { recursive: true });

  const { status, output } = provision(first);

  expect(status).toBe(0);
  expect(readFileSync(npmLog(), 'utf8')).toMatch(/^ci/m);
  expect(output).toContain('npm ci');
});

it('leaves an install of its own alone when run again', () => {
  const { first } = fixture();
  write(first, 'package-lock.json', '{ "lockfileVersion": 3, "packages": { "x": {} } }\n');
  expect(provision(first).status).toBe(0);

  expect(provision(first).status).toBe(0);

  expect(count(npmLog())).toBe(1);
});

it('does nothing in the main checkout', () => {
  const { main } = fixture();

  const { status } = provision(main);

  expect(status).toBe(0);
  expect(count(builds())).toBe(0);
  expect(count(npmLog())).toBe(0);
});
