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

function run(css: string, generated?: string, script?: string): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'connect-css-'));
  roots.push(root);
  mkdirSync(join(root, 'web/connect'), { recursive: true });
  writeFileSync(join(root, 'web/connect/page.css'), css);
  if (script !== undefined) writeFileSync(join(root, 'web/connect/layer.ts'), script);
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

describe('colours written in TypeScript', () => {
  it.each([
    ["const a = '#ff7a00';", 'a colour literal'],
    ["const a = 'rgb(1, 2, 3)';", 'a colour literal'],
    ["const a = 'oklch(0.7 0.1 50)';", 'a colour literal'],
    ["const a = 'lab(50 20 30)';", 'a colour literal'],
    ["const a = 'color(display-p3 1 0 0)';", 'a colour literal'],
    ["const paint = { 'line-color': 'orange' };", 'a named colour'],
  ])('refuses %s', (script, message) => {
    const { status, output } = run('.a {\n  display: block;\n}\n', undefined, `${script}\n`);

    expect(status).toBe(1);
    expect(output).toContain(`web/connect/layer.ts:1 ${message}`);
  });

  it('refuses a token name the generated file does not define', () => {
    const { status, output } = run(
      '.a {\n  gap: var(--space-sm);\n}\n',
      ':root {\n  --colour-known: #336699;\n  --space-sm: 8px;\n}\n',
      "const a = 'var(--colour-known)';\nconst b = 'var(--colour-missing)';\n"
        .replace('var(--colour-known)', '--colour-known')
        .replace('var(--colour-missing)', '--colour-missing')
    );

    expect(status).toBe(1);
    expect(output).toContain('web/connect/layer.ts:2 reads --colour-missing');
    expect(output).not.toContain('web/connect/layer.ts:1');
  });

  it('accepts a comment that names a colour and a token read', () => {
    const { status } = run(
      '.a {\n  gap: var(--space-sm);\n}\n',
      ':root {\n  --colour-known: #336699;\n  --space-sm: 8px;\n}\n',
      "// the brush is #ff7a00 on the phone\nconst a = 'var(--colour-known)';\n"
    );

    expect(status).toBe(0);
  });
});

describe('every declaration on a stylesheet line', () => {
  it('refuses a colour literal after the first declaration', () => {
    const { status, output } = run(
      '.a { gap: var(--space-sm); color: #fff; }\n',
      ':root {\n  --space-sm: 8px;\n}\n'
    );

    expect(status).toBe(1);
    expect(output).toContain('web/connect/page.css:1 a colour literal');
  });

  it.each(['oklch(0.7 0.1 50)', 'lab(50 20 30)', 'lch(50 20 30)', 'color(srgb 1 0 0)', 'tomato'])(
    'refuses %s',
    (value) => {
      const { status } = run(`.a {\n  color: ${value};\n}\n`);

      expect(status).toBe(1);
    }
  );

  it('accepts a mix of tokens', () => {
    const { status } = run(
      '.a {\n  color: color-mix(in srgb, var(--c) 60%, transparent);\n}\n',
      ':root {\n  --c: #336699;\n}\n'
    );

    expect(status).toBe(0);
  });
});

it('refuses a z-index literal, which a stacking rung would replace', () => {
  const { status, output } = run('.ui-table th {\n  z-index: 1;\n}\n');

  expect(status).toBe(1);
  expect(output).toContain('web/connect/page.css:2 a z-index literal');
});

it('refuses a z-index whose var() fallback is a literal', () => {
  const { status, output } = run(
    '.a {\n  z-index: var(--layer-sticky, 10);\n}\n',
    ':root {\n  --layer-sticky: 10;\n}\n'
  );

  expect(status).toBe(1);
  expect(output).toContain('web/connect/page.css:2 a z-index literal');
});

it('accepts a z-index that reads a layer token', () => {
  const { status } = run(
    '.a {\n  z-index: var(--layer-sticky);\n}\n',
    ':root {\n  --layer-sticky: 10;\n}\n'
  );

  expect(status).toBe(0);
});
