/**
 * Scenario: forty job trees at one commit each run the bindings check, which
 * regenerates the bindings from a debug host build of the engine, so each tree
 * compiled the same engine into its own target directory at once.
 *
 * Expected behaviour: the library is kept once per machine under the hash of
 * the Rust inputs. A tree at a hash the machine has already built compiles
 * nothing and generates the same bindings, a changed Rust file builds exactly
 * once, and trees that miss together wait for one build rather than each
 * starting their own.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const moduleScripts = path.join(__dirname, '../../../modules/veloqrs/scripts');
const COPIED = ['generate-bindings.sh', 'host-library.sh', 'with-cargo-slot.sh', 'rust-inputs.js'];

let box: string;
let cache: string;
let slots: string;
let builds: string;

beforeEach(() => {
  box = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-cache-'));
  cache = path.join(box, 'machine cache');
  slots = path.join(box, 'slots');
  builds = path.join(box, 'builds.log');
  fs.mkdirSync(path.join(box, 'bin'));
  executable('bin/rustc', '#!/bin/sh\nprintf "rustc 1.95.0\\nhost: x86_64-unknown-linux-gnu\\n"\n');
  // Cargo as the generator reads it: one artifact line naming the library it
  // wrote into the tree's own target directory, which carries the tree's name.
  executable(
    'bin/cargo',
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
fs.appendFileSync(process.env.TEST_BUILDS, process.cwd() + '\\n');
if (process.env.TEST_BUILD_FAIL) process.exit(101);
const until = Date.now() + Number(process.env.TEST_BUILD_MS || 0);
while (Date.now() < until) {}
const dir = path.join(process.cwd(), 'target/x86_64-unknown-linux-gnu/debug');
fs.mkdirSync(dir, { recursive: true });
const library = path.join(dir, 'libveloqrs.so');
fs.writeFileSync(library, 'engine built in ' + process.cwd());
console.log(JSON.stringify({ reason: 'compiler-artifact', target: { name: 'veloqrs' }, filenames: [library] }));
`
  );
  // The generator writes bindings that are the library's own bytes, so two
  // trees agree only when they generated from the same library.
  executable(
    'bin/npx',
    `#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
if (args[0] === 'prettier') process.exit(0);
const library = args.find((arg) => /\\.(so|dylib)$/.test(arg));
const bytes = fs.readFileSync(library);
for (const [flag, file] of [['--ts-dir', 'veloqrs.ts'], ['--cpp-dir', 'veloqrs.cpp']]) {
  const dir = args[args.indexOf(flag) + 1];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), bytes);
}
`
  );
});

afterEach(() => fs.rmSync(box, { recursive: true, force: true }));

function executable(file: string, source: string) {
  fs.writeFileSync(path.join(box, file), source, { mode: 0o755 });
}

/** A module tree with the real generator scripts and a one-file engine. */
function tree(name: string, source = 'pub fn engine() {}\n'): string {
  const root = path.join(box, name);
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'rust/src'), { recursive: true });
  for (const file of COPIED) {
    fs.copyFileSync(path.join(moduleScripts, file), path.join(root, 'scripts', file));
    fs.chmodSync(path.join(root, 'scripts', file), 0o755);
  }
  fs.writeFileSync(path.join(root, 'scripts/fix-generated.sh'), '#!/bin/sh\nexit 0\n', {
    mode: 0o755,
  });
  fs.writeFileSync(path.join(root, 'rust/Cargo.toml'), '[workspace]\nmembers = []\n');
  fs.writeFileSync(path.join(root, 'rust/src/lib.rs'), source);
  const generator = path.join(root, 'node_modules/uniffi-bindgen-react-native');
  fs.mkdirSync(generator, { recursive: true });
  fs.writeFileSync(path.join(generator, 'package.json'), JSON.stringify({ version: '1.0.0' }));
  fs.writeFileSync(
    path.join(root, 'package-lock.json'),
    JSON.stringify({
      packages: { 'node_modules/uniffi-bindgen-react-native': { version: '1.0.0' } },
    })
  );
  return root;
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const base = { ...process.env };
  delete base.VELOQ_CARGO_SLOT_HELD;
  delete base.VELOQRS_CARGO_FEATURES;
  return {
    ...base,
    PATH: `${path.join(box, 'bin')}${path.delimiter}${process.env.PATH}`,
    VELOQ_ENGINE_CACHE: cache,
    VELOQ_CARGO_SLOT_DIR: slots,
    TEST_BUILDS: builds,
    ...extra,
  };
}

function generate(root: string, extra: Record<string, string> = {}) {
  return spawnSync('bash', ['scripts/generate-bindings.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: env(extra),
  });
}

function generateAsync(root: string, extra: Record<string, string> = {}): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('bash', ['scripts/generate-bindings.sh'], {
      cwd: root,
      env: env(extra),
      stdio: 'ignore',
    });
    child.on('close', (code) => resolve(code ?? -1));
  });
}

const buildCount = () =>
  fs.existsSync(builds) ? fs.readFileSync(builds, 'utf8').split('\n').filter(Boolean).length : 0;
const bindings = (root: string) => fs.readFileSync(path.join(root, 'src/generated/veloqrs.ts'));

it('builds nothing in a second tree at the same Rust source and gives it identical bindings', () => {
  const first = tree('first');
  const second = tree('second');

  expect(generate(first).status).toBe(0);
  expect(buildCount()).toBe(1);

  const result = generate(second);

  expect(result.status).toBe(0);
  expect(buildCount()).toBe(1);
  expect(bindings(second).equals(bindings(first))).toBe(true);
  expect(fs.existsSync(path.join(second, 'rust/target'))).toBe(false);
});

it('builds exactly once more when one Rust file changes', () => {
  const first = tree('first');
  const second = tree('second');
  expect(generate(first).status).toBe(0);
  fs.writeFileSync(path.join(second, 'rust/src/lib.rs'), 'pub fn engine() { changed() }\n');

  expect(generate(second).status).toBe(0);
  expect(generate(second).status).toBe(0);

  expect(buildCount()).toBe(2);
  expect(bindings(second).toString()).toContain(path.join(second, 'rust'));
});

it('builds once for trees that miss together, and the rest take that build', async () => {
  const trees = ['one', 'two', 'three'].map((name) => tree(name));

  const codes = await Promise.all(
    trees.map((root) => generateAsync(root, { TEST_BUILD_MS: '1500' }))
  );

  expect(codes).toEqual([0, 0, 0]);
  expect(buildCount()).toBe(1);
  expect(bindings(trees[1]).equals(bindings(trees[0]))).toBe(true);
  expect(bindings(trees[2]).equals(bindings(trees[0]))).toBe(true);
}, 30000);

it('keeps nothing from a failed build, so the next run builds again', () => {
  const root = tree('first');

  expect(generate(root, { TEST_BUILD_FAIL: '1' }).status).not.toBe(0);
  expect(generate(root).status).toBe(0);

  expect(buildCount()).toBe(2);
  expect(bindings(root).toString()).toContain(path.join(root, 'rust'));
});

it('builds in the tree every time when the cache is off', () => {
  const root = tree('first');

  expect(generate(root, { VELOQ_ENGINE_CACHE: 'off' }).status).toBe(0);
  expect(generate(root, { VELOQ_ENGINE_CACHE: 'off' }).status).toBe(0);

  expect(buildCount()).toBe(2);
  expect(fs.existsSync(cache)).toBe(false);
});
