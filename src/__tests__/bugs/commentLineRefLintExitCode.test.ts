/**
 * Scenario: two file headers grew into design diaries, and every line number
 * and line count they cited had drifted by 30 to 200 per cent.
 *
 * Expected behaviour: the guard fails on a comment that cites one, so the
 * diaries cannot grow back.
 */

import { execFileSync } from 'node:child_process';
import { initFixtureRepo, gitFreeEnv } from '../__shared__/gitFixture';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-comment-line-refs.mjs');

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'line-refs-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails on a cited line range', () => {
  const root = fixture({
    'src/a.ts': ' * 1. Training load (lines 62-130):\nexport const a = 1;\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/a.ts:1');
});

it('fails on a cited line count', () => {
  const root = fixture({
    'src/b.ts': '// useGpsDataFetcher.ts (270 lines)\nexport const b = 1;\n',
  });

  expect(runGuard(root).status).toBe(1);
});

it('fails on a single cited line', () => {
  const root = fixture({ 'src/c.ts': '// wind threshold (line 246)\nexport const c = 1;\n' });

  expect(runGuard(root).status).toBe(1);
});

it('leaves code alone, only comments are read', () => {
  const root = fixture({ 'src/d.ts': "export const label = 'lines 62-130';\n" });

  expect(runGuard(root).status).toBe(0);
});

it('leaves a citation quoted in a test fixture string alone', () => {
  const root = fixture({
    'src/__tests__/e.test.ts': "const quoted = '// the header used to say (lines 1-133)';\n",
  });

  expect(runGuard(root).status).toBe(0);
});

it('passes prose that mentions lines without a number', () => {
  const root = fixture({ 'src/f.ts': '// Drawn as lines on the map.\nexport const f = 1;\n' });

  expect(runGuard(root).status).toBe(0);
});

it('fails on a file:line citation in a Rust comment', () => {
  const root = fixture({
    'modules/veloqrs/rust/veloqrs/src/lib.rs':
      '/// The notify is at objects/strength.rs:494.\nfn a() {}\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('modules/veloqrs/rust/veloqrs/src/lib.rs:1');
});

it('fails on a file:line citation of a JavaScript file', () => {
  const root = fixture({
    'src/plugins/a.ts': '// The slice is built at with-veloqrs.js:473.\nexport const a = 1;\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/plugins/a.ts:1');
});

it('fails on a file:line citation in a script', () => {
  const root = fixture({
    'scripts/lint-x.mjs':
      '// The vtable install is at EngineClient.ts:293-303.\nexport const x = 1;\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('scripts/lint-x.mjs:1');
});

it.each([
  ['a crate test', 'modules/veloqrs/rust/veloqrs/tests/a.rs', '//! Mirrors ffi.rs:1443.\n'],
  ['a crate bench', 'modules/veloqrs/rust/veloqrs/benches/b.rs', '// Cost of sync.rs:1078.\n'],
  [
    'an app test',
    'src/__tests__/c.test.ts',
    '// the header used to say (lines 1-133)\nit.todo("x");\n',
  ],
  ['a sql citation', 'src/d.ts', '// The index from 030_metrics.sql:4.\nexport const d = 1;\n'],
  ['a kotlin citation', 'src/e.ts', '// Set in MainApplication.kt:52.\nexport const e = 1;\n'],
  ['a swift citation', 'src/f.tsx', '// Read by Widget.swift:10.\nexport const f = 1;\n'],
  ['a tsx citation', 'src/g.ts', ' * Mounted at MapScreen.tsx:88.\nexport const g = 1;\n'],
])('fails on a citation in %s', (_what, path, body) => {
  const { status, output } = runGuard(fixture({ [path]: body }));

  expect(status).toBe(1);
  expect(output).toContain(`${path}:1`);
});

it('passes a file named without a line', () => {
  const root = fixture({
    'src/h.ts':
      '// The notify lives in objects/strength.rs, at 10:30 every day.\nexport const h = 1;\n',
  });

  expect(runGuard(root).status).toBe(0);
});

/**
 * Scenario: the guard read TypeScript, JavaScript and Rust under three trees,
 * and a Maestro flow and the push extension each cited a line in a file the
 * next edit moves.
 * Expected behaviour: every tracked file whose comments it can read in their
 * own syntax is read, hash comments included.
 */
it.each([
  ['a Maestro flow', '.maestro/a.yaml', '# The banner (login.tsx:54-60).\nappId: x\n', 1],
  [
    'a Swift extension',
    'push/ios/Ext/Payload.swift',
    '/// Read there (`Records.swift:331`).\nstruct P {}\n',
    1,
  ],
  ['a Kotlin module', 'modules/veloq-x/android/X.kt', '// Posted from Module.kt:41.\nclass X\n', 1],
  ['a shell script', 'scripts/a.sh', '#!/bin/sh\n# Mirrors run-gates.sh:57.\necho a\n', 2],
  ['a hook', '.husky/pre-commit', '#!/bin/sh\n# See lines 12-20 above.\n', 2],
  ['a workflow', '.github/workflows/ci.yml', 'jobs:\n  # Set at test.yml:109.\n  a: {}\n', 2],
  [
    'a TOML manifest',
    'modules/veloqrs/rust/veloqrs/Cargo.toml',
    '# Read at lib.rs:40.\n[deps]\n',
    1,
  ],
  [
    'the binding module',
    'modules/veloqrs/src/EngineClient.ts',
    '// Installed at line 293.\nexport {};\n',
    1,
  ],
])('fails on a citation in %s', (_what, path, body, line) => {
  const { status, output } = runGuard(fixture({ [path]: body }));

  expect(status).toBe(1);
  expect(output).toContain(`${path}:${line}`);
});

it('passes a coverage figure, which is a percentage and not a line', () => {
  const root = fixture({
    'config/jest.config.js':
      '// Measured: statements 72.43, branches 63.19, functions 70.22, lines 73.71.\nmodule.exports = {};\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('passes a citation outside a comment in a hash-commented file', () => {
  const root = fixture({ '.maestro/b.yaml': 'appId: x\n---\n- assertVisible: "login.tsx:54"\n' });

  expect(runGuard(root).status).toBe(0);
});
