import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');
const SCRIPT = join(ROOT, 'scripts/lint-exhaustive-deps-disables.mjs');
const SOURCES = join(ROOT, 'scripts/lib/indexedSources.mjs');
const roots: string[] = [];

function runGuard(source: string, file = 'src/effect.ts'): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'exhaustive-deps-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts/lib'), { recursive: true });
  mkdirSync(join(root, file, '..'), { recursive: true });
  writeFileSync(join(root, 'scripts/lint-exhaustive-deps-disables.mjs'), readFileSync(SCRIPT));
  writeFileSync(join(root, 'scripts/lib/indexedSources.mjs'), readFileSync(SOURCES));
  writeFileSync(join(root, file), source);
  initFixtureRepo(root);
  try {
    return {
      status: 0,
      output: execFileSync('node', [join(root, 'scripts/lint-exhaustive-deps-disables.mjs')], {
        cwd: root,
        env: gitFreeEnv(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    };
  } catch (error) {
    const failure = error as { status: number; stdout?: string; stderr?: string };
    return { status: failure.status, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

it.each([
  '// eslint-disable-next-line react-hooks/exhaustive-deps\nuseEffect(() => {}, []);',
  'useEffect(() => {}, []); // eslint-disable-line react-hooks/exhaustive-deps',
  '/* eslint-disable react-hooks/exhaustive-deps */\nuseEffect(() => {}, []);',
  '// eslint-disable-next-line react-hooks/refs, react-hooks/exhaustive-deps\nuseEffect(() => {}, []);',
])('refuses an exhaustive-deps disable without a reason', (source) => {
  const result = runGuard(source);
  expect(result.status).toBe(1);
  expect(result.output).toContain('src/effect.ts:1');
});

it.each([
  '// eslint-disable-next-line react-hooks/exhaustive-deps -- The key is stable.\nuseEffect(() => {}, []);',
  'useEffect(() => {}, []); // eslint-disable-line react-hooks/exhaustive-deps -- The key is stable.',
  '/* eslint-disable react-hooks/exhaustive-deps -- The key is stable. */\nuseEffect(() => {}, []);',
])('accepts an exhaustive-deps disable with a reason', (source) => {
  expect(runGuard(source).status).toBe(0);
});

// These effects rebuild what they depend on from a key, so the dependency list
// is whole and the rule has nothing to be silenced about, reason or not.
it.each([
  'src/shared/native/useEngineSubscription.ts',
  'src/shared/native/useRangeCoverage.ts',
  'src/shared/native/useLibraryCoverage.ts',
])('refuses any exhaustive-deps disable in %s, even with a reason', (file) => {
  const result = runGuard(
    '// eslint-disable-next-line react-hooks/exhaustive-deps -- The key is stable.\nuseEffect(() => {}, []);',
    file
  );
  expect(result.status).toBe(1);
  expect(result.output).toContain(`${file}:1`);
});
