/**
 * Scenario: a raw radius or hex literal in a stylesheet module bypasses the tokens.
 *
 * Expected behaviour: the lint that keeps a new literal off the scale actually fires.
 */

import { lintSource } from '../__shared__/lintSource';

describe('the radius lint', () => {
  // In process, under a name the rule's `src/**` glob matches, so no file is
  // written into `src/` for a whole-tree gate in another worker to catch half-there.
  function lint(source: string, filename = 'src/radiusLintFixture.ts'): Promise<string> {
    return lintSource(source, filename);
  }

  it('refuses a raw radius in a plain stylesheet module', async () => {
    expect(await lint('export const s = { card: { borderRadius: 10 } };\n')).toContain(
      'Raw border radius'
    );
  });

  it('refuses a fractional one, which is how a circle was written', async () => {
    expect(await lint('export const s = { dot: { borderRadius: 2.5 } };\n')).toContain(
      'Raw border radius'
    );
  });

  it('accepts a token', async () => {
    const source =
      "import { layout } from '@/theme';\nexport const s = { card: { borderRadius: layout.borderRadiusMd } };\n";
    expect(await lint(source)).not.toContain('Raw border radius');
  });

  it('refuses a radius set from a spacing token, and accepts a radius token', async () => {
    const spacingSource =
      "import { spacing } from '@/theme';\nexport const s = { chip: { borderRadius: spacing.xsPlus } };\n";
    expect(await lint(spacingSource)).toContain('Raw border radius');
    const cornerSource =
      "import { spacing } from '@/theme';\nexport const s = { sheet: { borderTopLeftRadius: spacing.md } };\n";
    expect(await lint(cornerSource)).toContain('Raw border radius');
    const conditionalSource =
      "import { spacing } from '@/theme';\nexport const s = { chip: { borderRadius: true ? spacing.xs : 0 } };\n";
    expect(await lint(conditionalSource)).toContain('Raw border radius');
    const tokenSource =
      "import { layout } from '@/theme';\nexport const s = { chip: { borderRadius: layout.borderRadiusSm } };\n";
    expect(await lint(tokenSource)).not.toContain('Raw border radius');
  });

  it('refuses a radius read from a layout member that is not a radius token', async () => {
    const paddingSource =
      "import { layout } from '@/theme';\nexport const s = { card: { borderRadius: layout.cardPadding } };\n";
    expect(await lint(paddingSource)).toContain('Raw border radius');
    const tapTargetSource =
      "import { layout } from '@/theme';\nexport const s = { fab: { borderRadius: layout.minTapTarget / 2 } };\n";
    expect(await lint(tapTargetSource)).toContain('Raw border radius');
    const cornerSource =
      "import { layout } from '@/theme';\nexport const s = { sheet: { borderTopLeftRadius: layout.screenPadding } };\n";
    expect(await lint(cornerSource)).toContain('Raw border radius');
    const tokenSource =
      "import { layout } from '@/theme';\nexport const s = { fab: { borderRadius: layout.borderRadiusFull } };\n";
    expect(await lint(tokenSource)).not.toContain('Raw border radius');
  });

  it('refuses a radius computed as half a size, which is a pill', async () => {
    const halfSource =
      'const TRACK = 6;\nexport const s = { track: { height: TRACK, borderRadius: TRACK / 2 } };\n';
    expect(await lint(halfSource)).toContain('Raw border radius');
    const ringSource =
      'const size = 20;\nexport const s = { ring: { borderRadius: size / 2 + 2 } };\n';
    expect(await lint(ringSource)).toContain('Raw border radius');
    const tokenSource =
      "import { layout } from '@/theme';\nexport const s = { track: { borderRadius: layout.borderRadiusFull } };\n";
    expect(await lint(tokenSource)).not.toContain('Raw border radius');
  });

  it('requires the map text shadow token outside the theme', async () => {
    expect(await lint('export const s = { textShadowRadius: 2 };\n')).toContain(
      'Raw text shadow radius'
    );
    expect(
      await lint('export const s = { textShadowOffset: { width: 0, height: 1 } };\n')
    ).toContain('Raw text shadow offset');
    const source =
      "import { mapTextShadow } from '@/theme';\nexport const s = { ...mapTextShadow };\n";
    expect(await lint(source)).not.toContain('Raw text shadow');
  });

  it('refuses a per-corner radius and a conditional radius', async () => {
    expect(await lint('export const s = { borderTopLeftRadius: 10 };\n')).toContain(
      'Raw border radius'
    );
    expect(await lint('export const s = { borderBottomRightRadius: true ? 3 : 0 };\n')).toContain(
      'Raw border radius'
    );
  });

  it('refuses hex in TypeScript and TSX while preserving the type scale rule', async () => {
    const source = "export const s = { color: '#ff0000' };\n";
    expect(await lint(source, 'src/features/hexLintFixture.ts')).toContain('Raw hex colour');
    expect(await lint(source, 'src/features/hexLintFixture.tsx')).toContain('Raw hex colour');
    expect(
      await lint('export const s = { fontSize: 13 };\n', 'src/features/hexLintFixture.tsx')
    ).toContain('Raw font size');
    expect(
      await lint(
        'export const s = { fontSize: true ? 13 : 15 };\n',
        'src/features/hexLintFixture.tsx'
      )
    ).toContain('Raw font size');
  });

  it('refuses hex written inside a template literal, and accepts one with none', async () => {
    const file = 'src/features/hexLintFixture.ts';
    expect(await lint('export const s = { color: `#ff0000` };\n', file)).toContain(
      'Raw hex colour'
    );
    expect(await lint("export const s = `{ 'line-color': '#FFF' }`;\n", file)).toContain(
      'Raw hex colour'
    );
    expect(await lint('export const s = `line-color: ${color}`;\n', file)).not.toContain(
      'Raw hex colour'
    );
    expect(await lint('export const s = `#${id}`;\n', file)).not.toContain('Raw hex colour');
  });
});
