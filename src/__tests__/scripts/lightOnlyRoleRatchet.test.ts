/**
 * Scenario: `colors.primary` is the light theme's primary, and a style or a
 * prop that names it draws the light value on the dark grounds too, where the
 * light primary sits under the 3:1 a mark owes. A `brand.<step>` read is the
 * same hazard by a second route: a ramp step is one value in both themes.
 *
 * Expected behaviour: a ratchet. A read the baseline does not hold fails and
 * names its file, a read through the theme or a read paired with its dark value
 * passes, and a file the tree has already beaten fails until its count is
 * lowered, so a converted read cannot come back.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-light-only-roles.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-light-roles-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

type Baseline = { primary?: Record<string, number>; brand?: Record<string, number> };

function runGuard(root: string, baseline: Baseline) {
  const baselineFile = path.join(root, 'baseline.json');
  fs.writeFileSync(baselineFile, JSON.stringify({ primary: {}, brand: {}, ...baseline }));
  try {
    const stdout = execFileSync('node', [GUARD, '--root', root, '--baseline', baselineFile], {
      encoding: 'utf8',
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

const FILL_IN_A_SHEET = `
import { colors } from '@/theme';
const styles = StyleSheet.create({ fill: { backgroundColor: colors.primary } });
`;

describe('the light-only role ratchet', () => {
  it('refuses a fill drawn in the light primary with no dark pair, and names the file', () => {
    const root = treeWith({ 'src/features/a/Bar.tsx': FILL_IN_A_SHEET });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/a/Bar.tsx');
  });

  it('refuses an icon colour prop in the light primary, in a file that never reads isDark', () => {
    const root = treeWith({
      'src/features/a/Row.tsx': `
import { colors } from '@/theme';
export const Row = () => <Icon name="pin" color={colors.primary} />;
`,
    });

    expect(runGuard(root, {}).status).toBe(1);
  });

  it('refuses a raw brand step read outside the theme', () => {
    const root = treeWith({
      'src/features/a/Check.tsx': `
import { brand } from '@/theme';
export const Check = () => <Icon name="check" color={brand.blue550} />;
`,
    });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/a/Check.tsx');
  });

  it('passes a read through the palette and a read paired with its dark value', () => {
    const root = treeWith({
      'src/features/a/Themed.tsx': `
import { colors, darkColors, themePalette } from '@/theme';
export const A = ({ isDark }) => <Icon color={themePalette(isDark).primary} />;
export const B = ({ isDark }) => <Icon color={isDark ? darkColors.primary : colors.primary} />;
export const C = ({ isDark }) => <Icon color={!isDark ? colors.primary : darkColors.primary} />;
`,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('leaves the theme itself and the tests alone', () => {
    const root = treeWith({
      'src/theme/colors.ts': 'export const colors = { primary: brand.blue600 };\n',
      'src/__tests__/a.test.tsx': FILL_IN_A_SHEET,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('passes a file sitting exactly on its baseline', () => {
    const root = treeWith({ 'src/features/a/Bar.tsx': FILL_IN_A_SHEET });

    expect(runGuard(root, { primary: { 'src/features/a/Bar.tsx': 1 } }).status).toBe(0);
  });

  it('refuses a baseline left above the tree, so a converted read cannot come back', () => {
    const root = treeWith({ 'src/features/a/Bar.tsx': FILL_IN_A_SHEET });
    const run = runGuard(root, {
      primary: { 'src/features/a/Bar.tsx': 2 },
      brand: { 'src/features/a/Gone.tsx': 1 },
    });

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/a/Bar.tsx  1, baseline 2');
    expect(run.output).toContain('src/features/a/Gone.tsx  0, baseline 1');
  });
});
