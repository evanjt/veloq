/**
 * Scenario: a connect page drew its own screen name as an h2 under the top bar, which already
 * names the screen, so the page showed its title twice.
 *
 * Expected behaviour: a heading of the page's own name, keyed by a `connectPage.*.heading` or a
 * `connectPage.screens.*` key, is refused at h1 and h2. The same key at h3 is a panel title and
 * is accepted, and so is an h2 whose key names something other than a screen.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initFixtureRepo, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-connect-page-titles.mjs');
const roots: string[] = [];

function run(page: string): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'connect-titles-'));
  roots.push(root);
  mkdirSync(join(root, 'web/connect/pages'), { recursive: true });
  writeFileSync(join(root, 'web/connect/pages/Page.tsx'), page);
  initFixtureRepo(root);
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

it('refuses a page heading keyed by a connectPage heading key at h2', () => {
  const { status, output } = run(
    `export function Live() {\n  return <h2>{t('connectPage.live.heading')}</h2>;\n}\n`
  );

  expect(status).toBe(1);
  expect(output).toContain('web/connect/pages/Page.tsx:2 a page heading');
});

it('refuses a page heading keyed by a screens key at h1, across lines', () => {
  const { status, output } = run(
    `export function Fitness() {\n  return (\n    <h1\n      id="x"\n    >\n      {t('connectPage.screens.fitness')}\n    </h1>\n  );\n}\n`
  );

  expect(status).toBe(1);
  expect(output).toContain('web/connect/pages/Page.tsx:3 a page heading');
});

it('accepts the same key as a panel title at h3', () => {
  expect(
    run(`export function Panel() {\n  return <h3>{t('connectPage.screens.insights')}</h3>;\n}\n`)
      .status
  ).toBe(0);
});

it('accepts an h2 whose key names a group rather than a screen', () => {
  expect(
    run(`export function Nav() {\n  return <h2>{t('connectPage.settings.onThePhone')}</h2>;\n}\n`)
      .status
  ).toBe(0);
});
