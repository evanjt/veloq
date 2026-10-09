/**
 * Scenario: the Android half of the altitude fix is a patch to expo-location,
 * applied by `postinstall` and by the worktree link step.
 * On 2026-09-26 the main checkout's copy was found unpatched after a landing.
 * The link step runs from `run-gates.sh` behind `|| true`, so a patch that
 * threw was swallowed, and a debug build recorded 0 m for a fix with no
 * altitude while every gate read green.
 *
 * Expected behaviour: `npm run audit` refuses a resolved expo-location that is
 * not patched, naming the file and the fix, and stays quiet when
 * expo-location is absent. A patch that throws fails the gate runner.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { writeExpoLocation } from '../__shared__/expoLocationFixture';
import { gitFreeEnv } from '../__shared__/gitFixture';

const projectRoot = join(__dirname, '../../..');
const GUARD = join(projectRoot, 'scripts/lint-expo-location-altitude.mjs');
const GATES = join(projectRoot, 'scripts/run-gates.sh');

const { applyPatch, locationState } = require('../../../scripts/patch-expo-location');

type Copy = 'patched' | 'unpatched' | 'changed';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A checkout whose expo-location is in the state given, or has none at all. */
function checkout(copy?: Copy): string {
  const root = mkdtempSync(join(tmpdir(), 'location-guard-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  if (copy === undefined) return root;
  writeExpoLocation(
    root,
    copy === 'changed' ? { results: '    altitude = location.altitudeOrNull(),\n' } : {}
  );
  if (copy === 'patched') applyPatch(root);
  return root;
}

/** A worktree whose whole `node_modules` is a symlink to `main`'s. */
function linkedTree(main: string): string {
  const root = mkdtempSync(join(tmpdir(), 'location-tree-'));
  roots.push(root);
  symlinkSync(join(main, 'node_modules'), join(root, 'node_modules'));
  return root;
}

function run(cmd: string, args: string[], cwd?: string): { status: number; output: string } {
  try {
    const output = execFileSync(cmd, args, {
      cwd,
      env: { ...gitFreeEnv(), VELOQ_SKIP_GATES: '' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const guard = (root: string) => run('node', [GUARD, '--root', root]);

describe('the expo-location altitude guard', () => {
  it('passes a patched file', () => {
    expect(guard(checkout('patched')).status).toBe(0);
  });

  it('refuses an unpatched file, naming it and the fix', () => {
    const root = checkout('unpatched');
    const { status, output } = guard(root);

    expect(status).toBe(1);
    expect(output).toContain('LocationResults.kt');
    expect(output).toContain('node scripts/patch-expo-location.js');
  });

  it('refuses a file whose altitude line upstream changed', () => {
    const { status, output } = guard(checkout('changed'));

    expect(status).toBe(1);
    expect(output).toContain('LocationResults.kt');
  });

  it('stays quiet when expo-location is absent', () => {
    expect(guard(checkout()).status).toBe(0);
  });

  it('reads the main checkout through a whole-directory symlink', () => {
    expect(guard(linkedTree(checkout('patched'))).status).toBe(0);
    expect(guard(linkedTree(checkout('unpatched'))).status).toBe(1);
  });

  it('is registered with the audit', () => {
    expect(
      run('node', ['scripts/run-guards.mjs', '--set', 'commit', '--json'], projectRoot).output
    ).toContain('lint-expo-location-altitude.mjs');
  });
});

describe('the altitude checker', () => {
  const state = (root: string) => locationState(join(root, 'node_modules/expo-location')).state;

  it('tells the three states apart', () => {
    expect(state(checkout('patched'))).toBe('patched');
    expect(state(checkout('unpatched'))).toBe('unpatched');
    expect(state(checkout('changed'))).toBe('changed');
  });

  it('leaves a patched whole-directory symlink alone rather than throwing', () => {
    expect(() => applyPatch(linkedTree(checkout('patched')))).not.toThrow();
  });

  it('refuses an unpatched whole-directory symlink, naming the main checkout', () => {
    expect(() => applyPatch(linkedTree(checkout('unpatched')))).toThrow(/main checkout/);
  });
});

describe('the gate runner', () => {
  it('fails when the altitude patch cannot apply, rather than swallowing it', () => {
    const { status, output } = run('sh', [GATES, 'ok:true'], checkout('changed'));

    expect(status).not.toBe(0);
    // The patch's own error, not the runner's summary line, which names
    // altitude whatever failed.
    expect(output).toContain('expo-location changed the line patched');
  });
});

describe('the Android builds', () => {
  // A build started by hand runs no gate, and it is the build that ships.
  it.each(['android', 'android:standalone', 'android:debug', 'android:prod'])(
    '%s refuses an unpatched expo-location before Gradle runs',
    (name) => {
      const { scripts } = require(join(projectRoot, 'package.json')) as {
        scripts: Record<string, string>;
      };
      expect(scripts[name].startsWith('npm run lint:expo-location-altitude && ')).toBe(true);
    }
  );
});
