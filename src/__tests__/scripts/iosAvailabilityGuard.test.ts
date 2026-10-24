/**
 * Scenario: the app's iOS deployment target is 16.4, so an availability check
 * for 16.4 or an older version is true on every device that can install the
 * app, and the fallback beside it never runs. Those checks sat in the Live
 * Activity module, the widget and the shortcuts, each with an unreachable path.
 *
 * Expected behaviour: the guard fails on a Swift check at or below the target
 * under widget/, push/ and modules/<name>/ios/, names the line, passes on a
 * check above the target, and reads the target from app.json.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-ios-availability.mjs');

const roots: string[] = [];

function appJson(target: string | null): string {
  const build = target === null ? {} : { ios: { deploymentTarget: target } };
  return JSON.stringify({
    expo: { plugins: [['expo-build-properties', build]] },
  });
}

function fixture(target: string | null, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ios-availability-'));
  roots.push(root);
  const all = { 'app.json': appJson(target), ...files };
  for (const [path, contents] of Object.entries(all)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  initFixtureRepo(root);
  return root;
}

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

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const SWIFT = 'widget/ios/VeloqWidget/Thing.swift';

it('fails on a check at the deployment target and names the file and line', () => {
  const root = fixture('16.4', {
    [SWIFT]: 'import SwiftUI\n@available(iOS 16.2, *)\nstruct Thing {}\n',
  });
  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain(`${SWIFT}:2`);
});

it.each([
  ['a check on the target', '@available(iOS 16.4, *)'],
  ['a check below the target', '@available(iOS 16.0, *)'],
  ['a check written without a minor version', '@available(iOS 16, *)'],
  ['an attribute with introduced:', '@available(iOS, introduced: 16.2)'],
  ['a check listing another platform first', 'if #available(macOS 13, iOS 16.0, *) {}'],
  ['a guard-form check', 'guard #available(iOS 16.2, *) else { return }'],
])('refuses %s', (_, line) => {
  const root = fixture('16.4', { [SWIFT]: `${line}\n` });

  expect(runGuard(root).status).toBe(1);
});

it('passes a check one minor above the target, which a device can run without it', () => {
  const root = fixture('16.4', { [SWIFT]: '@available(iOS 16.5, *)\nstruct Thing {}\n' });

  expect(runGuard(root).status).toBe(0);
});

it('passes checks above the target, which gate features by OS', () => {
  const root = fixture('16.4', {
    [SWIFT]: '@available(iOS 17.0, *)\nstruct Thing {}\nif #available(iOS 18.0, *) {}\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('reads the target from app.json, so a raised floor moves the line', () => {
  const files = { [SWIFT]: '@available(iOS 17.0, *)\nstruct Thing {}\n' };

  expect(runGuard(fixture('16.4', files)).status).toBe(0);
  expect(runGuard(fixture('17.0', files)).status).toBe(1);
});

it('refuses an app.json with no deployment target rather than passing', () => {
  const root = fixture(null, { [SWIFT]: '@available(iOS 16.2, *)\n' });
  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('deployment target is missing');
});

it('refuses an empty Swift listing rather than reporting clean', () => {
  const root = fixture('16.4', { 'README.md': 'no swift here\n' });
  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('read nothing');
});
