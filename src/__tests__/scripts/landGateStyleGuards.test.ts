/**
 * Scenario: a landing that writes a bare control into a connect page, or a pixel height into
 * its stylesheet, passed the landing gate, which ran only the correctness guards, and failed the
 * style guard in CI after it had landed.
 * Expected behaviour: `scripts/land-gate.sh --list-guards` names the style guards a landing
 * touches and no others. A landing under web/connect/ lists the connect guards, a landing that
 * touches only src/features/ lists neither, and a job's uncommitted edit under web/connect/ is
 * judged the same way as a committed landing.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const CONNECT_GUARDS = ['lint:connect-bare-controls', 'lint:connect-css'];
const WHOLE_TREE_STYLE_GUARD = 'lint:em-dashes';

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

function commit(root: string, message: string): void {
  runGit(['add', '-A'], root);
  runGit(['commit', '-q', '-m', message], root);
}

/**
 * A repository holding the landing gate and the guard runner, a `main` branch, and a `landing`
 * branch checked out at the base commit. Returns the root and that commit.
 */
function fixture(): { root: string; base: string } {
  const root = mkdtempSync(join(tmpdir(), 'land-gate-'));
  roots.push(root);
  mkdirSync(join(root, 'scripts'));
  cpSync(join(ROOT, 'scripts/land-gate.sh'), join(root, 'scripts/land-gate.sh'));
  cpSync(join(ROOT, 'scripts/run-guards.mjs'), join(root, 'scripts/run-guards.mjs'));
  cpSync(join(ROOT, 'scripts/lib'), join(root, 'scripts/lib'), { recursive: true });
  write(root, 'web/connect/pages/Page.tsx', 'export const Page = () => null;\n');
  write(root, 'src/features/feature.ts', 'export const feature = 1;\n');
  runGit(['init', '-q', '-b', 'main'], root);
  commit(root, 'Base');
  const base = runGit(['rev-parse', 'HEAD'], root).trim();
  runGit(['checkout', '-q', '-b', 'landing'], root);
  return { root, base };
}

function plannedGuards(root: string, base: string): string[] {
  const run = spawnSync('sh', ['scripts/land-gate.sh', '--list-guards', base], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(run.status).toBe(0);
  return run.stdout.split('\n').filter(Boolean);
}

describe('the landing gate plans the style guards a landing touches', () => {
  it('lists the connect guards for a landing under web/connect', () => {
    const { root, base } = fixture();
    write(root, 'web/connect/pages/Page.tsx', 'export const Page = () => <button />;\n');
    commit(root, 'Add a control to the page');

    const names = plannedGuards(root, base);

    expect(names).toEqual(expect.arrayContaining([...CONNECT_GUARDS, WHOLE_TREE_STYLE_GUARD]));
  });

  it('lists neither connect guard for a landing that touches only src/features', () => {
    const { root, base } = fixture();
    write(root, 'src/features/feature.ts', 'export const feature = 2;\n');
    commit(root, 'Change the feature');

    const names = plannedGuards(root, base);

    expect(names).toContain(WHOLE_TREE_STYLE_GUARD);
    for (const guard of CONNECT_GUARDS) expect(names).not.toContain(guard);
  });

  it("judges a job's uncommitted edit under web/connect as a landing would", () => {
    const { root, base } = fixture();
    write(root, 'web/connect/pages/Page.tsx', 'export const Page = () => <button />;\n');

    const names = plannedGuards(root, base);

    expect(names).toEqual(expect.arrayContaining(CONNECT_GUARDS));
  });
});
