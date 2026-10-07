/**
 * Scenario: "retention by `created_at`" was cited as one of the ways an
 * activity leaves the device. It never ran: the engine function had no export
 * and no caller outside two tests, the store field had a validating setter and
 * no screen, and a doc comment beside the stream window asserted the opposite,
 * which is what kept the belief alive.
 *
 * Expected behaviour: the guard fails any of those names coming back where it
 * was removed from, and leaves tests and generated bindings alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-retired-names.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'retired-names-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const CLEAN = { 'src/features/settings/lib/streamRetention.ts': 'export const DAYS = 30;\n' };

it('fails the activity retention setting coming back in TypeScript', () => {
  const root = fixture({
    ...CLEAN,
    'src/features/routes/stores/Settings.ts': 'export const s = { retentionDays: 90 };\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/routes/stores/Settings.ts:1');
  expect(output).toContain('retentionDays');
});

it('fails it in the engine module’s TypeScript too', () => {
  const root = fixture({
    ...CLEAN,
    'modules/veloqrs/src/index.ts': 'export function set(retentionDays: number) {}\n',
  });

  expect(runGuard(root).output).toContain('modules/veloqrs/src/index.ts:1');
});

it('fails the engine function coming back in the crate or its tests', () => {
  const root = fixture({
    ...CLEAN,
    'modules/veloqrs/rust/veloqrs/src/persistence/mod.rs': 'pub fn cleanup_old_activities() {}\n',
    'modules/veloqrs/rust/veloqrs/tests/retention.rs': 'fn t() { cleanup_old_activities(); }\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('modules/veloqrs/rust/veloqrs/src/persistence/mod.rs:1');
  expect(output).toContain('modules/veloqrs/rust/veloqrs/tests/retention.rs:1');
});

it('fails the stream window pointing at the route settings store again', () => {
  const root = fixture({
    'src/features/settings/lib/streamRetention.ts':
      '// Activities themselves are pruned by RouteSettingsStore.\nexport const DAYS = 30;\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/settings/lib/streamRetention.ts:1');
});

it('leaves tests, generated bindings and other file types alone', () => {
  const root = fixture({
    ...CLEAN,
    'src/__tests__/bugs/retention.test.ts': "expect(x).not.toContain('retentionDays');\n",
    'modules/veloqrs/src/generated/veloqrs.ts': '// cleanup_old_activities retentionDays\n',
    'src/features/routes/notes.md': 'retentionDays\n',
    'src/app/settings.tsx': "import { useRouteSettings } from './RouteSettingsStore';\n",
  });

  expect(runGuard(root).status).toBe(0);
});

it('refuses an empty listing rather than reporting it clean', () => {
  const root = mkdtempSync(join(tmpdir(), 'retired-names-empty-'));
  roots.push(root);
  writeFileSync(join(root, 'README.md'), 'x\n');
  execFileSync('git', ['init', '-q'], { cwd: root, env: gitFreeEnv() });

  expect(runGuard(root).status).toBe(1);
});
