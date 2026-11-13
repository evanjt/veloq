/**
 * Scenario: a new top-level directory, or a new home for native iOS source,
 * lands without being added to the source hash's directory list or to the
 * change classifier's native rules. The simulator-app cache then restores a
 * build that never compiled the change, and a pull request touching only that
 * directory skips the native builds altogether.
 *
 * Expected behaviour: the guard refuses a tracked top-level directory that is
 * neither a build input nor deliberately left out, and an iOS native source
 * the classifier reads as no native change, naming each.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/check-build-inputs.mjs');

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-build-inputs-'));
  runGit(['init', '--quiet'], root);
  write('src/app.ts', 'export {};');
  write('widget/ios/Widget.swift', '');
  write('push/ios/Extension/NotificationService.swift', '');
  write('docs/guide.txt', '');
  write('package.json', '{}');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  runGit(['add', file], root);
}

function guard() {
  return spawnSync('node', [script, '--root', root], { encoding: 'utf8', env: gitFreeEnv() });
}

it('passes a tree whose directories are classified and whose iOS sources are filtered', () => {
  const run = guard();
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
});

it('refuses a tracked top-level directory that is neither a build input nor left out', () => {
  write('extensions/ios/Share.swift', '');
  const run = guard();
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('extensions');
});

it('refuses an iOS native source the classifier reads as app code alone', () => {
  write('src/features/lantern/GlowBridge.swift', '');
  const run = guard();
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('src/features/lantern/GlowBridge.swift');
  expect(run.stderr).not.toContain('widget/ios/Widget.swift');
  expect(run.stderr).not.toContain('push/ios/Extension/NotificationService.swift');
});

it('leaves a native-looking file under a directory kept out of the build alone', () => {
  write('docs/sample/Example.swift', '');
  expect(guard().status).toBe(0);
});
