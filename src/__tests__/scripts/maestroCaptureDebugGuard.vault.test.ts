/**
 * Scenario: the store capture turns debug mode on for the section shot and off
 * again after it. A shot taken with debug mode on carries the repost buttons
 * into the store set, and a missed switch used to skip the switch-off silently.
 *
 * Expected behaviour: the guard passes when every shot runs the helper that
 * asserts both repost buttons are absent and the switch-off is followed by an
 * assertion that the switch reads off. It fails, naming the step, when a shot
 * has no such helper before it, when the helper leaves a button out, and when
 * the switch-off is not asserted.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-maestro-capture-debug.mjs');

const roots: string[] = [];

const HELPER = `appId: com.veloq.app.dev
---
- assertNotVisible:
    id: "activity-regenerate-notification"
- assertNotVisible:
    id: "activity-regenerate-notification-delayed"
`;

const HELPER_ONE_BUTTON = `appId: com.veloq.app.dev
---
- assertNotVisible:
    id: "activity-regenerate-notification"
`;

const SHOT = `- runFlow:
    file: helpers/assert-debug-ui-absent.yaml
- takeScreenshot: "screenshots/store-capture/01-feed"
`;

const SWITCH_OFF = `- runFlow:
    when:
      visible:
        id: "settings-debug-switch"
        checked: true
    commands:
      - tapOn:
          id: "settings-debug-switch"
- assertVisible:
    id: "settings-debug-switch"
    checked: false
`;

function fixture(flow: string, helper: string): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-capture-debug-'));
  roots.push(root);
  mkdirSync(join(root, '.maestro/helpers'), { recursive: true });
  writeFileSync(join(root, '.maestro/store-capture.yaml'), flow);
  writeFileSync(join(root, '.maestro/helpers/assert-debug-ui-absent.yaml'), helper);
  return root;
}

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

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const HEADER = 'appId: com.veloq.app.dev\nname: Store capture\n---\n';

it('passes when every shot runs the helper and the switch-off is asserted', () => {
  const root = fixture(HEADER + SHOT + SWITCH_OFF, HELPER);
  expect(runGuard(root).status).toBe(0);
});

it('fails on a shot with no debug-absent check before it, and names the step', () => {
  const root = fixture(
    HEADER + SWITCH_OFF + '- takeScreenshot: "screenshots/store-capture/01-feed"\n',
    HELPER
  );
  const run = runGuard(root);
  expect(run.status).toBe(1);
  expect(run.output).toContain(
    'the shot at step 3 is not preceded by helpers/assert-debug-ui-absent.yaml'
  );
});

it('fails when the helper does not assert the delayed repost button is absent', () => {
  const root = fixture(HEADER + SHOT + SWITCH_OFF, HELPER_ONE_BUTTON);
  const run = runGuard(root);
  expect(run.status).toBe(1);
  expect(run.output).toContain(
    'does not assert activity-regenerate-notification-delayed is absent'
  );
});

it('fails when debug mode is switched off without asserting the switch reads off', () => {
  const unasserted = SWITCH_OFF.replace(/- assertVisible[\s\S]*$/, '');
  const root = fixture(HEADER + SHOT + unasserted, HELPER);
  const run = runGuard(root);
  expect(run.status).toBe(1);
  expect(run.output).toContain('switches debug mode off without asserting the switch reads off');
});
