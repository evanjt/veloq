/**
 * Scenario: the rail wordmark reads a fill token that is too dim as text on the dark
 * grounds, and the guard's fixed text roles never named it.
 *
 * Expected behaviour: a `#rail .brand` rule that reads a colour under 4.5:1 on a
 * ground fails the guard, and one that reads a link-grade colour passes.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-connect-contrast.mjs');

const TOKENS = `:root {
  --colour-surface-page: #F7F8FA;
  --colour-surface: #FFFFFF;
  --colour-surface-raised: #FFFFFF;
  --colour-surface-input: #EFF1F4;
  --colour-text-primary: #111111;
  --colour-text-secondary: #333333;
  --colour-text-tertiary: #444444;
  --colour-success-text: #115511;
  --colour-warning-text: #664400;
  --colour-error-text: #991111;
  --colour-action-link: #2F6699;
  --colour-fill-blue: #2F6699;
}
:root[data-theme="dark"] {
  --colour-surface-page: #0F1217;
  --colour-surface: #171B22;
  --colour-surface-raised: #1E232B;
  --colour-surface-input: #1E232B;
  --colour-text-primary: #F0F0F0;
  --colour-text-secondary: #D0D0D0;
  --colour-text-tertiary: #C0C0C0;
  --colour-success-text: #99DD99;
  --colour-warning-text: #EECC88;
  --colour-error-text: #FF9999;
  --colour-action-link: #7DB3E3;
}
`;

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runWithBrandColour(token: string): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'connect-contrast-'));
  roots.push(root);
  mkdirSync(join(root, 'web/connect/shell'), { recursive: true });
  writeFileSync(join(root, 'web/connect/tokens.generated.css'), TOKENS);
  writeFileSync(
    join(root, 'web/connect/shell/shell.css'),
    `#rail .brand {\n  color: var(${token});\n}\n`
  );
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', '-A'], { cwd: root });
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

it('fails a rail wordmark colour that is under the bar on the dark grounds', () => {
  const { status, output } = runWithBrandColour('--colour-fill-blue');
  expect(status).toBe(1);
  expect(output).toContain('dark: --colour-fill-blue');
});

it('passes a rail wordmark that reads the link colour', () => {
  expect(runWithBrandColour('--colour-action-link').status).toBe(0);
});
