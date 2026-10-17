/**
 * Expected behaviour: the guard fails a component that themes its chrome by the
 * base map, and leaves the declaring file, the layer builders and tests alone.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-map-chrome-theme.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'map-chrome-theme-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const READERS = {
  'src/features/maps/components/mapStyles.ts':
    "export const isDarkStyle = (s: string) => s === 'dark';\n" +
    "export const bar = (s: string) => (isDarkStyle(s) ? 'light' : 'dark');\n",
  'src/features/maps/components/regional/regionalMapLayerSpecs.ts':
    'const isDark = isDarkStyle(mapStyle);\n',
};

it('fails a control themed by the base map', () => {
  const root = fixture({
    ...READERS,
    'src/features/trails/TrailButton.tsx':
      "import { isDarkStyle } from '@/features/maps';\n\nconst dark = isDarkStyle(style);\n",
  });
  const { status, output } = runGuard(root);
  expect(status).toBe(1);
  expect(output).toContain('src/features/trails/TrailButton.tsx:3');
});

it('passes the declaring file, the layer builders and tests', () => {
  const root = fixture({
    ...READERS,
    'src/__tests__/trail.test.ts': "expect(isDarkStyle('dark')).toBe(true);\n",
    'src/features/trails/TrailButton.tsx': 'const { isDark } = useTheme();\n',
  });
  expect(runGuard(root).status).toBe(0);
});
