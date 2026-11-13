/**
 * Expected behaviour: the guard fails a map layer builder that imports a colour
 * from the theme, since that colour is the same on every base, and passes one
 * that reads its colours from the palette it is handed.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-map-layer-colours.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'map-layer-colours-'));
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

const PALETTE_BUILDER =
  "import { colourIndexExpression, type MapPalette } from '@/theme';\n" +
  "export const trailLayers = (palette: MapPalette) => [{ paint: { 'line-color': palette.casing } }];\n";

it('fails a layer builder that imports colors from the theme', () => {
  const root = fixture({
    'src/features/maps/lib/trailLayers.ts':
      "import { colors, type MapPalette } from '@/theme';\n" +
      "export const trailLayers = () => [{ paint: { 'line-color': colors.textPrimary } }];\n",
  });
  const { status, output } = runGuard(root);
  expect(status).toBe(1);
  expect(output).toContain('src/features/maps/lib/trailLayers.ts:1 colors');
});

it('fails a builder that takes darkColors or a palette constant through a theme submodule', () => {
  const root = fixture({
    'src/features/routes/components/trailMapLayerSpecs.ts':
      "import type { MapPalette } from '@/theme';\n" +
      "import { darkColors } from '@/theme/colors';\n",
    'src/features/routes/lib/groupingLegend.ts':
      "import {\n  mapPalette,\n  sectionPalette,\n} from '../../../theme';\n",
  });
  const { status, output } = runGuard(root);
  expect(status).toBe(1);
  expect(output).toContain('src/features/routes/components/trailMapLayerSpecs.ts:2 darkColors');
  expect(output).toContain('src/features/routes/lib/groupingLegend.ts:1 sectionPalette');
  expect(output).not.toContain('groupingLegend.ts:1 mapPalette');
});

it('fails a namespace import of the theme, which reaches every colour', () => {
  const root = fixture({
    'src/features/recording/lib/trailPaint.ts': "import * as theme from '@/theme';\n",
  });
  const { status, output } = runGuard(root);
  expect(status).toBe(1);
  expect(output).toContain('src/features/recording/lib/trailPaint.ts:1 * as theme');
});

it('passes builders reading the palette, and leaves components and tests alone', () => {
  const root = fixture({
    'src/features/maps/lib/trailLayers.ts': PALETTE_BUILDER,
    'src/features/maps/components/TrailButton.tsx': "import { colors } from '@/theme';\n",
    'src/features/maps/lib/__tests__/trailLayers.test.ts': "import { colors } from '@/theme';\n",
    'src/features/maps/lib/trailMath.ts': "import { colors } from '@/theme';\n",
  });
  const { status, output } = runGuard(root);
  expect(output).toBe('Map layer colour guard: every layer builder reads its palette.\n');
  expect(status).toBe(0);
});
