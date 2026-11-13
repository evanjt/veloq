/**
 * Scenario: charts drawn inside a sheet or a column worked their width out from
 * the window, so on a tablet, where a form sheet is far narrower than the
 * window, the right-hand bar and its label were cut off. The window-dimensions
 * guard only refused a module-scope read, so a read inside the component
 * passed.
 *
 * Expected behaviour: the guard fails a chart, sheet content or slide under a
 * feature's components that reads the window's width, in any of the shapes
 * that read it, and leaves a height, other files and the allowed pager alone.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-chart-window-width.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'chart-window-width-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

function runGuard(root: string): { status: number | null; output: string } {
  const run = spawnSync('node', [SCRIPT, '--root', root], {
    cwd: root,
    env: gitFreeEnv(),
    encoding: 'utf8',
  });
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const component = (name: string, ...body: string[]) =>
  [
    "import { useWindowDimensions } from 'react-native';",
    `export function ${name}() {`,
    ...body.map((line) => `  ${line}`),
    '}',
  ].join('\n');

it('fails a chart that destructures the window width', () => {
  const root = fixture({
    'src/features/kites/components/LiftChart.tsx': component(
      'LiftChart',
      'const { width: windowWidth } = useWindowDimensions();',
      'return windowWidth - 32;'
    ),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/kites/components/LiftChart.tsx:3');
});

it('fails sheet content and a slide, and a width read through the returned object', () => {
  const root = fixture({
    'src/features/kites/components/sheet/SpoolContent.tsx': component(
      'SpoolContent',
      'const window = useWindowDimensions();',
      'return window.width / 2;'
    ),
    'src/features/kites/components/tour/LineSlide.tsx': component(
      'LineSlide',
      'return useWindowDimensions().width;'
    ),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/kites/components/sheet/SpoolContent.tsx:3');
  expect(output).toContain('src/features/kites/components/tour/LineSlide.tsx:3');
});

it('leaves a window height alone', () => {
  const root = fixture({
    'src/features/kites/components/LiftChart.tsx': component(
      'LiftChart',
      'const { height } = useWindowDimensions();',
      'return height - 100;'
    ),
  });

  expect(runGuard(root).status).toBe(0);
});

it('leaves a chart measured from its box alone', () => {
  const root = fixture({
    'src/features/kites/components/LiftChart.tsx': [
      "import { useMeasuredWidth } from '@/shared/charts';",
      'export function LiftChart() {',
      '  const { width, onLayout } = useMeasuredWidth();',
      '  return { width, onLayout };',
      '}',
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(0);
});

it('reads only charts, contents and slides under a feature component directory', () => {
  const read = 'const { width } = useWindowDimensions();';
  const root = fixture({
    'src/features/kites/screens/LiftChart.tsx': component('LiftChart', read, 'return width;'),
    'src/features/kites/components/SpoolCard.tsx': component('SpoolCard', read, 'return width;'),
    'src/shared/ui/LiftChart.tsx': component('LiftChart', read, 'return width;'),
    'src/features/kites/components/__tests__/LiftChart.tsx': component(
      'LiftChart',
      read,
      'return width;'
    ),
  });

  expect(runGuard(root).status).toBe(0);
});

it('allows the tour pager page, which steps by the window', () => {
  const root = fixture({
    'src/features/settings/components/whatsNew/WhatsNewSlide.tsx': component(
      'WhatsNewSlide',
      'const { width } = useWindowDimensions();',
      'return width;'
    ),
  });

  expect(runGuard(root).status).toBe(0);
});
