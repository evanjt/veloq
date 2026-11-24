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

function plannedLanes(root: string, base: string): string[] {
  const run = spawnSync('sh', ['scripts/land-gate.sh', '--list-lanes', base], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
    timeout: 60_000,
  });
  expect(run.status).toBe(0);
  return run.stdout.split('\n').filter(Boolean);
}

describe('the landing gate plans a lane per CI check the landing touches', () => {
  const ALWAYS = ['types', 'guards', 'format'];
  const OPTIONAL = ['rust', 'nextest', 'android-jvm', 'tracematch-hash-order', 'ios-project'];

  it('lists the Android JVM lane for a change under a module android directory', () => {
    const { root, base } = fixture();
    write(root, 'modules/widget/android/src/Worker.kt', 'class Worker\n');
    commit(root, 'Change the worker');

    const names = plannedLanes(root, base);

    expect(names).toContain('android-jvm');
    expect(names).not.toContain('ios-project');
    expect(names).not.toContain('tracematch-hash-order');
  });

  it('lists the Rust suites and the iOS project check for the paths that feed them', () => {
    const { root, base } = fixture();
    write(root, 'modules/veloqrs/rust/veloqrs/src/lib.rs', '// engine\n');
    write(root, 'src/plugins/withWidget.js', 'module.exports = {};\n');
    commit(root, 'Change the engine and a plugin');

    const names = plannedLanes(root, base);

    expect(names).toEqual(expect.arrayContaining([...ALWAYS, 'rust', 'nextest', 'ios-project']));
    expect(names).not.toContain('android-jvm');
  });

  it('lists the detector hash-order lint when the tracematch pointer moves', () => {
    const { root, base } = fixture();
    write(root, 'modules/veloqrs/rust/tracematch/src/lib.rs', '// detector\n');
    commit(root, 'Move the detector');

    expect(plannedLanes(root, base)).toContain('tracematch-hash-order');
  });

  it('lists only the always-on lanes for a change that reaches none of them', () => {
    const { root, base } = fixture();
    write(root, 'src/features/feature.ts', 'export const feature = 2;\n');
    commit(root, 'Change the feature');

    const names = plannedLanes(root, base);

    expect(names).toEqual(ALWAYS);
    for (const lane of OPTIONAL) expect(names).not.toContain(lane);
  });
});
