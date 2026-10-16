import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'host-bindings-'));
  for (const dir of ['bin', 'scripts', 'rust/target/release', 'external target/release']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  for (const script of [
    'generate-bindings.sh',
    'host-library.sh',
    'with-cargo-slot.sh',
    'rust-inputs.js',
  ]) {
    fs.copyFileSync(
      path.join(projectRoot, 'modules/veloqrs/scripts', script),
      path.join(root, 'scripts', script)
    );
    fs.chmodSync(path.join(root, 'scripts', script), 0o755);
  }
  executable('scripts/fix-generated.sh', '#!/bin/sh\nexit 0\n');
  install('1.4.0-3');
  lock('1.4.0-3');
  executable('bin/rustc', '#!/bin/sh\nprintf "host: %s\\n" "$TEST_HOST"\n');
  executable(
    'bin/cargo',
    `#!/usr/bin/env node
const fs = require('fs');
fs.writeFileSync(process.env.TEST_BUILD_ARGS, JSON.stringify(process.argv.slice(2)));
console.log(JSON.stringify({reason:'compiler-artifact', target:{name:'veloqrs', kind:['cdylib']}, filenames:[process.env.TEST_LIBRARY]}));
`
  );
  executable(
    'bin/npx',
    `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
if (args[0] === 'prettier') process.exit(0);
const library = args.find(arg => /\\.(so|dylib)$/.test(arg));
fs.writeFileSync(process.env.TEST_SELECTED_LIBRARY, library || '');
if (!library || !fs.existsSync(library)) process.exit(1);
`
  );
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function executable(file: string, source: string) {
  fs.writeFileSync(path.join(root, file), source, { mode: 0o755 });
}

function install(version: string) {
  const dir = path.join(root, 'node_modules/uniffi-bindgen-react-native');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
}

function lock(version: string | null) {
  const packages: Record<string, { version: string }> = { '': { version: '0.0.0' } };
  if (version) packages['node_modules/uniffi-bindgen-react-native'] = { version };
  fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify({ packages }));
}

function generate(host: string, library: string, cache = path.join(root, 'engine cache')) {
  return spawnSync('bash', ['scripts/generate-bindings.sh'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      VELOQ_ENGINE_CACHE: cache,
      VELOQ_CARGO_SLOT_DIR: path.join(root, 'slots'),
      VELOQ_CARGO_SLOT_HELD: '',
      PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH}`,
      CARGO_TARGET_DIR: path.join(root, 'external target'),
      TEST_HOST: host,
      TEST_LIBRARY: library,
      TEST_BUILD_ARGS: path.join(root, 'build-args.json'),
      TEST_SELECTED_LIBRARY: path.join(root, 'selected-library'),
    },
  });
}

it.each([
  ['aarch64-apple-darwin', 'dylib'],
  ['x86_64-unknown-linux-gnu', 'so'],
])('uses the artifact Cargo reports for host %s', (host, extension) => {
  const library = path.join(root, `external target/release/libveloqrs.${extension}`);
  fs.writeFileSync(library, 'host metadata');
  fs.writeFileSync(path.join(root, 'rust/target/release/libveloqrs.so'), 'stale metadata');

  const result = generate(host, library);

  expect(result.status).toBe(0);
  const selected = fs.readFileSync(path.join(root, 'selected-library'), 'utf8');
  expect(selected.endsWith(`libveloqrs.${extension}`)).toBe(true);
  expect(fs.readFileSync(selected, 'utf8')).toBe('host metadata');
  const args = JSON.parse(fs.readFileSync(path.join(root, 'build-args.json'), 'utf8'));
  expect(args.slice(args.indexOf('--target'), args.indexOf('--target') + 2)).toEqual([
    '--target',
    host,
  ]);
});

it('hands the generator the artifact itself when the machine cache is off', () => {
  const library = path.join(root, 'external target/release/libveloqrs.so');
  fs.writeFileSync(library, 'host metadata');
  fs.writeFileSync(path.join(root, 'rust/target/release/libveloqrs.so'), 'stale metadata');

  const result = generate('x86_64-unknown-linux-gnu', library, 'off');

  expect(result.status).toBe(0);
  expect(fs.readFileSync(path.join(root, 'selected-library'), 'utf8')).toBe(library);
});

it('builds the host library in debug, which carries the same metadata as release', () => {
  const library = path.join(root, 'external target/debug/libveloqrs.so');
  fs.mkdirSync(path.dirname(library), { recursive: true });
  fs.writeFileSync(library, 'host metadata');

  const result = generate('x86_64-unknown-linux-gnu', library);

  expect(result.status).toBe(0);
  const args = JSON.parse(fs.readFileSync(path.join(root, 'build-args.json'), 'utf8'));
  expect(args).not.toContain('--release');
});

it('rejects missing host output before running the generator', () => {
  const result = generate('aarch64-apple-darwin', path.join(root, 'missing.dylib'));

  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('Host library not found');
  expect(fs.existsSync(path.join(root, 'selected-library'))).toBe(false);
});

describe('the installed generator', () => {
  const library = () => {
    const file = path.join(root, 'external target/debug/libveloqrs.so');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'host metadata');
    return file;
  };

  it('refuses an install older than the lockfile before building or writing anything', () => {
    install('1.4.0-1');

    const result = generate('x86_64-unknown-linux-gnu', library());

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('1.4.0-1');
    expect(result.stderr).toContain('1.4.0-3');
    expect(fs.existsSync(path.join(root, 'build-args.json'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'selected-library'))).toBe(false);
  });

  it('refuses an install newer than the lockfile', () => {
    install('1.5.0');

    const result = generate('x86_64-unknown-linux-gnu', library());

    expect(result.status).not.toBe(0);
    expect(fs.existsSync(path.join(root, 'selected-library'))).toBe(false);
  });

  it('refuses when the lockfile records no generator', () => {
    lock(null);

    const result = generate('x86_64-unknown-linux-gnu', library());

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('uniffi-bindgen-react-native');
    expect(fs.existsSync(path.join(root, 'selected-library'))).toBe(false);
  });

  it('refuses when no generator is installed', () => {
    fs.rmSync(path.join(root, 'node_modules'), { recursive: true });

    const result = generate('x86_64-unknown-linux-gnu', library());

    expect(result.status).not.toBe(0);
    expect(fs.existsSync(path.join(root, 'selected-library'))).toBe(false);
  });

  it('runs the generator when the install matches the lockfile', () => {
    const result = generate('x86_64-unknown-linux-gnu', library());

    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(root, 'selected-library'))).toBe(true);
  });
});
