/**
 * Scenario: Metro's inline requires evaluate a module on first use, so a task
 * module the entry imports for a binding is not evaluated at launch. A headless
 * background launch never touches the binding, so the task is never defined.
 *
 * Expected behaviour: the guard passes only when the entry reaches each module
 * that defines a task through a bare side-effect import, and fails a module the
 * entry imports by name, by default, or not at all.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/check-background-task-entry.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(entry: string): string {
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ main: 'entry.ts' }),
    'entry.ts': entry,
    'src/ferry/lib/ferryTask.ts': [
      "import * as TaskManager from 'expo-task-manager';",
      "export const FERRY_TASK = 'ferry';",
      'TaskManager.defineTask(FERRY_TASK, async () => {});',
    ].join('\n'),
  };
  const root = mkdtempSync(join(tmpdir(), 'background-task-entry-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

function runGuard(root: string): { status: number | null; output: string } {
  const run = spawnSync('node', [SCRIPT, '--root', root], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

it('passes a task module imported for its side effect', () => {
  const run = runGuard(fixture("import './src/ferry/lib/ferryTask';\n"));
  expect(run.status).toBe(0);
});

it('fails a task module the entry imports by name', () => {
  const run = runGuard(fixture("import { FERRY_TASK } from './src/ferry/lib/ferryTask';\n"));
  expect(run.status).not.toBe(0);
  expect(run.output).toContain('ferryTask.ts');
});

it('fails a task module the entry imports as a namespace or default', () => {
  expect(
    runGuard(fixture("import * as ferry from './src/ferry/lib/ferryTask';\n")).status
  ).not.toBe(0);
  expect(runGuard(fixture("import ferry from './src/ferry/lib/ferryTask';\n")).status).not.toBe(0);
});

it('fails a task module the entry does not import', () => {
  const run = runGuard(fixture("import 'expo-router/entry';\n"));
  expect(run.status).not.toBe(0);
  expect(run.output).toContain('ferryTask.ts');
});
