/**
 * Scenario: the forced render crash is requested by a receiver in the Android
 * debug source set or a launch argument read inside `#if DEBUG` on iOS, and
 * either reaching a release build would let any launch put the app on its
 * crash screen.
 *
 * Expected behaviour: the guard passes the repository's own trigger files, and
 * refuses the receiver in a release or main manifest, its class in the main
 * source set, a debug manifest that does not export it, and the launch
 * argument read outside an `#if DEBUG` branch.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/check-debug-crash-trigger.mjs');
const MODULE = 'modules/veloq-debug-crash';
const DEBUG_MANIFEST = `${MODULE}/android/src/debug/AndroidManifest.xml`;
const RECEIVER = `${MODULE}/android/src/debug/java/com/veloq/debugcrash/DebugCrashReceiver.kt`;
const REQUEST = `${MODULE}/android/src/debug/java/com/veloq/debugcrash/DebugCrashRequest.kt`;
const RELEASE_REQUEST = `${MODULE}/android/src/release/java/com/veloq/debugcrash/DebugCrashRequest.kt`;
const MAIN_MODULE = `${MODULE}/android/src/main/java/com/veloq/debugcrash/VeloqDebugCrashModule.kt`;
const SWIFT = `${MODULE}/ios/VeloqDebugCrashModule.swift`;
const REAL = [DEBUG_MANIFEST, RECEIVER, REQUEST, RELEASE_REQUEST, MAIN_MODULE, SWIFT];

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function real(path: string): string {
  return readFileSync(join(REPO, path), 'utf8');
}

/** A git root holding the repository's trigger files, with `changes` laid over them. */
function fixture(changes: Record<string, string | null> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'debug-crash-trigger-'));
  roots.push(root);
  const files: Record<string, string | null> = {
    ...Object.fromEntries(REAL.map((path) => [path, real(path)])),
    ...changes,
  };
  for (const [path, contents] of Object.entries(files)) {
    if (contents === null) continue;
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, env: gitFreeEnv(), stdio: 'ignore' });
  git(['init', '-q']);
  git(['add', '-A']);
  return root;
}

function run(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      cwd: REPO,
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

it('passes the repository trigger files', () => {
  expect(run(fixture())).toEqual({ status: 0, output: '' });
});

it('refuses the receiver declared in a release manifest', () => {
  const path = `${MODULE}/android/src/release/AndroidManifest.xml`;
  const { status, output } = run(fixture({ [path]: real(DEBUG_MANIFEST) }));

  expect(status).toBe(1);
  expect(output).toContain(`${path} names DebugCrashReceiver outside a debug source set`);
});

it('refuses the receiver declared in the app manifest', () => {
  const path = 'android/app/src/main/AndroidManifest.xml';
  const { status, output } = run(fixture({ [path]: real(DEBUG_MANIFEST) }));

  expect(status).toBe(1);
  expect(output).toContain(path);
});

it('refuses the receiver class moved into the main source set', () => {
  const moved = RECEIVER.replace('/src/debug/', '/src/main/');
  const { status, output } = run(fixture({ [RECEIVER]: null, [moved]: real(RECEIVER) }));

  expect(status).toBe(1);
  expect(output).toContain(`${moved} names DebugCrashReceiver`);
});

it('refuses a release request that reads the debug preferences', () => {
  const { status, output } = run(fixture({ [RELEASE_REQUEST]: real(REQUEST) }));

  expect(status).toBe(1);
  expect(output).toContain(`${RELEASE_REQUEST} names veloq_debug_crash`);
});

it('refuses a debug manifest that does not export the receiver', () => {
  const closed = real(DEBUG_MANIFEST).replace(
    'android:exported="true"',
    'android:exported="false"'
  );
  const { status, output } = run(fixture({ [DEBUG_MANIFEST]: closed }));

  expect(status).toBe(1);
  expect(output).toContain('does not declare an exported DebugCrashReceiver');
});

it('refuses the launch argument read outside an #if DEBUG branch', () => {
  const open = [
    'import ExpoModulesCore',
    'func requested() -> Bool {',
    '  #if DEBUG',
    '  return false',
    '  #else',
    '  return UserDefaults.standard.bool(forKey: "VeloqForceRenderCrash")',
    '  #endif',
    '}',
  ].join('\n');
  const { status, output } = run(fixture({ [SWIFT]: open }));

  expect(status).toBe(1);
  expect(output).toContain(`${SWIFT}:6 reads VeloqForceRenderCrash outside an #if DEBUG branch`);
});

it('refuses the launch argument read with no conditional at all', () => {
  const path = 'push/ios/Extension/Reader.swift';
  const { status, output } = run(
    fixture({ [path]: 'let asked = UserDefaults.standard.bool(forKey: "VeloqForceRenderCrash")\n' })
  );

  expect(status).toBe(1);
  expect(output).toContain(`${path}:1 reads VeloqForceRenderCrash`);
});
