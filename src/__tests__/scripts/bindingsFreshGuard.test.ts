import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, initFixtureRepo, runGit } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const RUNNER = join(ROOT, 'scripts/run-guards.mjs');
const MODULE = 'modules/veloqrs';
const SOURCE = `${MODULE}/rust/src/lib.rs`;
const BINDING = `${MODULE}/src/generated/sample.ts`;
const GENERATOR = `${MODULE}/generate.cjs`;
const ORIGINAL = '/// Clear the cache.\n#[uniffi::export]\npub fn clear_cache() {}\n';
const CHANGED = ORIGINAL.replace('Clear the cache.', 'Clear all cached entries.');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function put(root: string, file: string, contents: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), contents);
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'bindings-fresh-'));
  roots.push(root);
  put(root, SOURCE, ORIGINAL);
  put(root, BINDING, ORIGINAL);
  put(root, `${MODULE}/cpp/generated/sample.hpp`, 'void clear_cache();\n');
  const scripts = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).scripts;
  put(
    root,
    'package.json',
    JSON.stringify({ scripts: { 'ffi:generate': scripts['ffi:generate'] } })
  );
  put(
    root,
    `${MODULE}/package.json`,
    JSON.stringify({ scripts: { generate: 'node generate.cjs' } })
  );
  put(
    root,
    GENERATOR,
    `const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve('../..');
const output = process.argv[process.argv.indexOf('--out-dir') + 1];
fs.writeFileSync(path.join(root, 'output.path'), output);
fs.mkdirSync(path.join(output, 'src/generated'), { recursive: true });
fs.mkdirSync(path.join(output, 'cpp/generated'), { recursive: true });
fs.writeFileSync(path.join(output, 'src/generated/sample.ts'), fs.readFileSync(path.join(root, '${SOURCE}')));
fs.writeFileSync(path.join(output, 'cpp/generated/sample.hpp'), 'void clear_cache();\\n');
`
  );
  initFixtureRepo(root);
  return root;
}

function runGuard(root: string, set = 'land'): { status: number | null; output: string } {
  const listing = spawnSync(process.execPath, [RUNNER, '--set', set, '--json'], {
    cwd: root,
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
  const guards = (JSON.parse(listing.stdout) as { name: string; cmd: string[] }[])
    .filter((guard) => guard.name === 'check:bindings-fresh')
    .map((guard) => ({
      ...guard,
      cmd: guard.cmd.map((arg) => (arg.startsWith('scripts/') ? join(ROOT, arg) : arg)),
    }));
  const guardsFile = `${root}.guards.json`;
  roots.push(guardsFile);
  writeFileSync(guardsFile, JSON.stringify(guards));
  const run = spawnSync(process.execPath, [RUNNER, '--set', set, '--guards', guardsFile], {
    cwd: root,
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

it.each(['land', 'all'])(
  'refuses changed Rust documentation with stale indexed bindings in %s',
  (set) => {
    const root = fixture();
    put(root, SOURCE, CHANGED);
    runGit(['add', SOURCE], root);

    const result = runGuard(root, set);

    expect(result.status).toBe(1);
    expect(result.output).toContain(BINDING);
    expect(result.output).toContain('npm run ffi:generate');
    expect(readFileSync(join(root, BINDING), 'utf8')).toBe(ORIGINAL);
    expect(existsSync(readFileSync(join(root, 'output.path'), 'utf8'))).toBe(false);
  }
);

it('passes matching bindings on repeated checks and removes temporary output', () => {
  const root = fixture();

  expect(runGuard(root).status).toBe(0);
  expect(runGuard(root).status).toBe(0);
  expect(existsSync(readFileSync(join(root, 'output.path'), 'utf8'))).toBe(false);
});

it('requires regenerated bindings in the index and preserves unstaged edits', () => {
  const root = fixture();
  put(root, SOURCE, CHANGED);
  put(root, BINDING, CHANGED);

  expect(runGuard(root).status).toBe(1);
  expect(readFileSync(join(root, BINDING), 'utf8')).toBe(CHANGED);

  runGit(['add', SOURCE, BINDING], root);
  put(root, BINDING, 'local edit\n');

  expect(runGuard(root).status).toBe(0);
  expect(readFileSync(join(root, BINDING), 'utf8')).toBe('local edit\n');
});

it('refuses stale C++ bindings', () => {
  const root = fixture();
  const header = `${MODULE}/cpp/generated/sample.hpp`;
  put(root, header, 'void old_export();\n');
  runGit(['add', header], root);

  const result = runGuard(root);

  expect(result.status).toBe(1);
  expect(result.output).toContain(header);
});

it.each(['untracked', 'obsolete'])('refuses %s generated files', (scenario) => {
  const root = fixture();
  if (scenario === 'untracked') runGit(['rm', '--cached', BINDING], root);
  else {
    put(root, `${MODULE}/src/generated/obsolete.ts`, '');
    runGit(['add', `${MODULE}/src/generated/obsolete.ts`], root);
  }

  expect(runGuard(root).status).toBe(1);
});

it('refuses an empty indexed binding corpus before generation', () => {
  const root = fixture();
  runGit(['rm', '-r', '--cached', `${MODULE}/src/generated`, `${MODULE}/cpp/generated`], root);

  const result = runGuard(root);

  expect(result.status).toBe(1);
  expect(result.output).toMatch(/read nothing/);
  expect(existsSync(join(root, 'output.path'))).toBe(false);
});

it('reports failed generation and cleans its partial output', () => {
  const root = fixture();
  const generator = readFileSync(join(root, GENERATOR), 'utf8');
  put(root, GENERATOR, `${generator}\nprocess.exit(7);\n`);

  const result = runGuard(root);

  expect(result.status).toBe(1);
  expect(result.output).toMatch(/generation failed.*exit 7/);
  expect(existsSync(readFileSync(join(root, 'output.path'), 'utf8'))).toBe(false);
  expect(readFileSync(join(root, BINDING), 'utf8')).toBe(ORIGINAL);
});

it('refuses a generator that exits successfully without generating files', () => {
  const root = fixture();
  put(root, GENERATOR, '');

  expect(runGuard(root).status).toBe(1);
});

it('reports when the generator command cannot start', () => {
  const root = fixture();
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const gitPath = spawnSync('which', ['git'], {
    encoding: 'utf8',
    env: gitFreeEnv(),
  }).stdout.trim();
  symlinkSync(gitPath, join(bin, 'git'));

  const run = spawnSync(process.execPath, [join(ROOT, 'scripts/check-bindings-fresh.mjs')], {
    cwd: root,
    encoding: 'utf8',
    env: { ...gitFreeEnv(), PATH: bin },
  });

  expect(run.status).toBe(1);
  expect(run.stderr).toMatch(/could not start binding generation.*ENOENT/);
});
