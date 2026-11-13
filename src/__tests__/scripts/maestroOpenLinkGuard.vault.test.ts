/**
 * Scenario: iOS raises its open-in-app sheet after a deep link is followed. A
 * flow that follows the link with `openLink:` and taps the sheet once, only if
 * it is already showing, asserts the link's screen behind a sheet that arrived
 * late.
 *
 * Expected behaviour: the guard fails on a bare `openLink:` in any flow or
 * helper except the open-link helper, names the line, and passes once the flow
 * calls the helper.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-maestro-open-link.mjs');

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'maestro-open-link-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
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

const HELPER = '.maestro/helpers/open-link.yaml';
const HELPER_BODY = 'appId: x\n---\n- openLink: ${LINK}\n';
const THROUGH_HELPER =
  'appId: x\n---\n- runFlow:\n    file: helpers/open-link.yaml\n    env:\n      LINK: "veloq://map"\n      TARGET: "map-screen"\n';

it('fails on a bare openLink in a flow and names the file and line', () => {
  const root = fixture({
    [HELPER]: HELPER_BODY,
    '.maestro/a.yaml': 'appId: x\n---\n- openLink: "veloq://map"\n',
  });
  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('.maestro/a.yaml:3');
});

it('fails on a bare openLink nested inside a repeat and in another helper', () => {
  const root = fixture({
    [HELPER]: HELPER_BODY,
    '.maestro/a.yaml':
      'appId: x\n---\n- repeat:\n    times: 2\n    commands:\n      - openLink: "veloq://"\n',
    '.maestro/helpers/nav.yaml': 'appId: x\n---\n- openLink: "veloq://map"\n',
  });
  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('.maestro/a.yaml:6');
  expect(output).toContain('.maestro/helpers/nav.yaml:3');
});

it('passes when every flow calls the helper, which alone holds the openLink', () => {
  const root = fixture({
    [HELPER]: HELPER_BODY,
    '.maestro/a.yaml': THROUGH_HELPER,
  });

  expect(runGuard(root).status).toBe(0);
});
