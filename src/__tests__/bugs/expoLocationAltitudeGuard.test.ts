/**
 * Scenario: the Android half of the altitude fix is a patch to expo-location's
 * `LocationResults.kt`, applied by `postinstall` and by the worktree link step.
 * On 2026-09-26 the main checkout's copy was found unpatched after a landing.
 * The link step runs from `run-gates.sh` behind `|| true`, so a patch that
 * threw was swallowed, and a debug build recorded 0 m for a fix with no
 * altitude while every gate read green.
 *
 * Expected behaviour: `npm run audit` refuses a resolved `LocationResults.kt`
 * that is not patched, naming the file and the fix, and stays quiet when
 * expo-location is absent. A patch that throws fails the gate runner.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const projectRoot = join(__dirname, '../../..');
const GUARD = join(projectRoot, 'scripts/lint-expo-location-altitude.mjs');
const GATES = join(projectRoot, 'scripts/run-gates.sh');
const RELATIVE =
  'node_modules/expo-location/android/src/main/java/expo/modules/location/records/LocationResults.kt';

// The two altitude lines upstream carries: the coords record the patch targets,
// and the geocode response, which has no comma and must stay as it is.
const UNPATCHED = [
  '    altitude = location.altitude,',
  '          altitude = location.altitude',
].join('\n');
const PATCHED = [
  '    altitude = if (location.hasAltitude()) location.altitude else null,',
  '          altitude = location.altitude',
].join('\n');
const CHANGED = '    altitude = location.altitudeOrNull(),';

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A checkout whose expo-location carries `source`, or none at all. */
function checkout(source?: string): string {
  const root = mkdtempSync(join(tmpdir(), 'location-guard-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules'), { recursive: true });
  if (source !== undefined) {
    mkdirSync(dirname(join(root, RELATIVE)), { recursive: true });
    writeFileSync(join(root, RELATIVE), source);
  }
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
    expect(guard(checkout(PATCHED)).status).toBe(0);
  });

  it('refuses an unpatched file, naming it and the fix', () => {
    const root = checkout(UNPATCHED);
    const { status, output } = guard(root);

    expect(status).toBe(1);
    expect(output).toContain('LocationResults.kt');
    expect(output).toContain('node scripts/patch-expo-location.js');
  });

  it('refuses a file whose altitude line upstream changed', () => {
    const { status, output } = guard(checkout(CHANGED));

    expect(status).toBe(1);
    expect(output).toContain('LocationResults.kt');
  });

  it('stays quiet when expo-location is absent', () => {
    expect(guard(checkout()).status).toBe(0);
  });

  it('reads the main checkout through a whole-directory symlink', () => {
    expect(guard(linkedTree(checkout(PATCHED))).status).toBe(0);
    expect(guard(linkedTree(checkout(UNPATCHED))).status).toBe(1);
  });

  it('is registered with the audit', () => {
    expect(
      run('node', ['scripts/run-guards.mjs', '--set', 'commit', '--json'], projectRoot).output
    ).toContain('lint-expo-location-altitude.mjs');
  });
});

describe('the altitude checker', () => {
  const { altitudeState, applyPatch } = require('../../../scripts/patch-expo-location');

  it('tells the three states apart', () => {
    expect(altitudeState(PATCHED)).toBe('patched');
    expect(altitudeState(UNPATCHED)).toBe('unpatched');
    expect(altitudeState(CHANGED)).toBe('changed');
  });

  it('leaves a patched whole-directory symlink alone rather than throwing', () => {
    expect(() => applyPatch(linkedTree(checkout(PATCHED)))).not.toThrow();
  });

  it('refuses an unpatched whole-directory symlink, naming the main checkout', () => {
    expect(() => applyPatch(linkedTree(checkout(UNPATCHED)))).toThrow(/main checkout/);
  });
});

describe('the gate runner', () => {
  it('fails when the altitude patch cannot apply, rather than swallowing it', () => {
    const { status, output } = run('sh', [GATES, 'ok:true'], checkout(CHANGED));

    expect(status).not.toBe(0);
    // The patch's own error, not the runner's summary line, which names
    // altitude whatever failed.
    expect(output).toContain('Expo location altitude constructor changed');
  });
});

describe('the Android builds', () => {
  // A build started by hand runs no gate, and it is the build that ships.
  it.each(['android', 'android:debug', 'android:prod'])(
    '%s refuses an unpatched expo-location before Gradle runs',
    (name) => {
      const { scripts } = require(join(projectRoot, 'package.json')) as {
        scripts: Record<string, string>;
      };
      expect(scripts[name].startsWith('npm run lint:expo-location-altitude && ')).toBe(true);
    }
  );
});
