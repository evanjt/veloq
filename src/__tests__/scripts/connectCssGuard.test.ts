/**
 * Scenario: the connect page's stylesheet guard matched a declaration's property name with
 * `[a-z-]+`, so a custom property ending in a digit (`--line-0: #d1495b;`) was never read and a
 * hex palette overrode the app's token colours without a refusal.
 *
 * Expected behaviour: a colour literal in a digit-suffixed custom property is refused, a token
 * reference is accepted, and a pixel length with a var() fallback is refused.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initFixtureRepo, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-connect-css.mjs');
const roots: string[] = [];

function run(css: string, generated?: string): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'connect-css-'));
  roots.push(root);
  mkdirSync(join(root, 'web/connect'), { recursive: true });
  writeFileSync(join(root, 'web/connect/page.css'), css);
  if (generated !== undefined)
    writeFileSync(join(root, 'web/connect/tokens.generated.css'), generated);
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

it('refuses a colour literal in a custom property whose name ends in a digit', () => {
  const { status, output } = run(':root {\n  --line-0: #d1495b;\n}\n');

  expect(status).toBe(1);
  expect(output).toContain('web/connect/page.css:2 a colour literal');
});

it('accepts a digit-suffixed custom property that reads a token', () => {
  expect(
    run(
      ':root {\n  --line-0: var(--colour-chart-series);\n}\n',
      ':root {\n  --colour-chart-series: #336699;\n}\n'
    ).status
  ).toBe(0);
});

it('refuses a pixel length kept as a var() fallback', () => {
  const { status, output } = run('.a {\n  gap: var(--space-md, 16px);\n}\n');

  expect(status).toBe(1);
  expect(output).toContain('a pixel length in gap');
});

it('refuses a read of a phone type role', () => {
  const { status, output } = run('.a {\n  font-size: var(--type-screenTitle-size);\n}\n');

  expect(status).toBe(1);
  expect(output).toContain(
    'web/connect/page.css:2 reads the phone type role --type-screenTitle-size'
  );
});

it('refuses a var() whose custom property no stylesheet defines', () => {
  const { status, output } = run('.a {\n  color: var(--undefined);\n}\n');

  expect(status).toBe(1);
  expect(output).toContain('web/connect/page.css:2 reads --undefined, which nothing defines');
});

it('accepts a var() defined in the same stylesheet or in the generated file', () => {
  const { status } = run(
    ':root {\n  --local: var(--web-type-body-size);\n}\n.a {\n  width: var(--local);\n  font-size: var(--web-type-body-size);\n}\n',
    ':root {\n  --web-type-body-size: 14px;\n}\n'
  );

  expect(status).toBe(0);
});

it('refuses a read of a phone radius role', () => {
  const { status, output } = run(
    '.a {\n  border-radius: var(--radius-md);\n}\n',
    ':root {\n  --radius-md: 12px;\n}\n'
  );

  expect(status).toBe(1);
  expect(output).toContain('web/connect/page.css:2 reads the phone role --radius-md');
});

it('refuses a read of a phone size role', () => {
  const { status, output } = run(
    '.a {\n  width: var(--size-icon);\n}\n',
    ':root {\n  --size-icon: 24px;\n}\n'
  );

  expect(status).toBe(1);
  expect(output).toContain('web/connect/page.css:2 reads the phone role --size-icon');
});

it('accepts the web radius scale and the shared spacing grid', () => {
  const { status } = run(
    '.a {\n  border-radius: var(--web-radius-md);\n  gap: var(--space-sm);\n}\n',
    ':root {\n  --web-radius-md: 6px;\n  --space-sm: 8px;\n}\n'
  );

  expect(status).toBe(0);
});

it('refuses a pixel height on a .ui- selector', () => {
  const { status, output } = run('.ui-button {\n  min-height: 36px;\n}\n');

  expect(status).toBe(1);
  expect(output).toContain('web/connect/page.css:2 a pixel length in min-height');
});

it('refuses a pixel height in an attribute-qualified .ui- rule', () => {
  const { status } = run(".ui-button[data-size='md'] {\n  height: 36px;\n}\n");

  expect(status).toBe(1);
});

it('accepts a pixel height outside the .ui- kit and a token height inside it', () => {
  const { status } = run(
    '.chart {\n  height: 12px;\n}\n.ui-button {\n  min-height: var(--web-size-control);\n}\n',
    ':root {\n  --web-size-control: 30px;\n}\n'
  );

  expect(status).toBe(0);
});
