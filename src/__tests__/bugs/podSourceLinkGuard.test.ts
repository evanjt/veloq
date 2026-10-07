/**
 * Scenario: CocoaPods lists a pod's files from its own directory and does not
 * descend into a link, so a tracked link under `modules/veloqrs/ios` bundles
 * nothing and every sprite and glyph request on iOS answers 404.
 *
 * Expected behaviour: the guard fails on a tracked link under that directory
 * and passes on a tree with real files there.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initFixtureRepo, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-pod-source-links.mjs');

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
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

function fixture(link: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'pod-link-'));
  roots.push(root);
  mkdirSync(join(root, 'modules/veloqrs/assets/basemap'), { recursive: true });
  mkdirSync(join(root, 'modules/veloqrs/ios'), { recursive: true });
  writeFileSync(join(root, 'modules/veloqrs/assets/basemap/a.json'), '{}');
  writeFileSync(join(root, 'modules/veloqrs/ios/Veloqrs.h'), '');
  if (link) symlinkSync('../assets/basemap', join(root, 'modules/veloqrs/ios/BasemapAssets'));
  initFixtureRepo(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails on a tracked link under the pod directory and names it', () => {
  const { status, output } = runGuard(fixture(true));

  expect(status).toBe(1);
  expect(output).toContain('modules/veloqrs/ios/BasemapAssets');
});

it('passes when the pod directory holds only real files', () => {
  expect(runGuard(fixture(false)).status).toBe(0);
});
