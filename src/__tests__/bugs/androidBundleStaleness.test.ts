/**
 * Scenario: the documented Android recipe was `npx expo export` then
 * `gradle assembleDebug`. Both succeed, the APK installs and launches, and it
 * runs whatever JavaScript was already embedded. `expo export` writes a
 * `dist/` directory nothing in the Android build reads, and `assembleDebug`
 * bundles no JS of its own because a debug build expects Metro.
 *
 * Expected behaviour: a guard reads the embedded bundle's timestamp against
 * the newest source file and refuses when the bundle is behind. The failure a
 * green build hides is the whole point, so the guard has to name the embed
 * command rather than only saying no.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-android-bundle.mjs');
const BUNDLE = 'android/app/src/main/assets/index.android.bundle';

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
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

/** A tree with one source file and, optionally, a bundle of a given age. */
function fixture(opts: { bundleAgeSeconds?: number }): string {
  const root = mkdtempSync(join(tmpdir(), 'android-bundle-'));
  roots.push(root);

  const now = Date.now() / 1000;
  mkdirSync(join(root, 'src/features'), { recursive: true });
  const source = join(root, 'src/features/a.ts');
  writeFileSync(source, 'export const a = 1;\n');
  utimesSync(source, now, now);

  if (opts.bundleAgeSeconds !== undefined) {
    const bundle = join(root, BUNDLE);
    mkdirSync(join(bundle, '..'), { recursive: true });
    writeFileSync(bundle, 'var __BUNDLE__;\n');
    const at = now - opts.bundleAgeSeconds;
    utimesSync(bundle, at, at);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('refuses a bundle older than the newest source file', () => {
  const { status, output } = runGuard(fixture({ bundleAgeSeconds: 86_400 }));

  expect(status).toBe(1);
  expect(output).toContain('index.android.bundle');
});

it('names the embed command, since a green build is the only other signal', () => {
  const { output } = runGuard(fixture({ bundleAgeSeconds: 86_400 }));

  expect(output).toContain('expo export:embed');
  expect(output).toContain('--bundle-output');
});

it('passes when the bundle is newer than every source file', () => {
  const root = fixture({ bundleAgeSeconds: -60 });

  expect(runGuard(root).status).toBe(0);
});

/**
 * No bundle at all is a tree that has never built, or one that runs against
 * Metro. Refusing there would fail every checkout that has not run a release
 * build, which is most of them.
 */
it('says nothing when there is no embedded bundle', () => {
  const { status, output } = runGuard(fixture({}));

  expect(status).toBe(0);
  expect(output).toBe('');
});

/**
 * The guard is about staleness, so a source tree that does not exist cannot
 * make it fail: that is a fixture or a partial checkout, not a stale build.
 */
it('says nothing when there is no source tree to compare against', () => {
  const root = mkdtempSync(join(tmpdir(), 'android-bundle-'));
  roots.push(root);
  const bundle = join(root, BUNDLE);
  mkdirSync(join(bundle, '..'), { recursive: true });
  writeFileSync(bundle, 'var __BUNDLE__;\n');

  expect(runGuard(root).status).toBe(0);
});
