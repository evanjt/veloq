/**
 * Scenario: 493 paddings, margins and gaps were literals beside 1,758 token
 * references, and nothing stopped the next one.
 *
 * Expected behaviour: a raw spacing literal fails the lint, a token passes, a
 * zero passes because it is not a rung, and a negative literal fails too.
 */

import { lintSource } from '../__shared__/lintSource';

function lint(source: string, filename = 'src/spacingLintFixture.ts'): Promise<string> {
  return lintSource(source, filename);
}

describe('the spacing lint', () => {
  it('refuses a raw padding, margin and gap', async () => {
    expect(await lint('export const s = { card: { padding: 10 } };\n')).toContain('Raw spacing');
    expect(await lint('export const s = { card: { marginTop: 3 } };\n')).toContain('Raw spacing');
    expect(await lint('export const s = { row: { gap: 12 } };\n')).toContain('Raw spacing');
  });

  it('refuses a negative one', async () => {
    expect(await lint('export const s = { pull: { marginLeft: -2 } };\n')).toContain(
      'Raw negative spacing'
    );
  });

  it('lets a zero through, since it is not a rung', async () => {
    expect(await lint('export const s = { flush: { padding: 0, marginTop: 0 } };\n')).not.toContain(
      'Raw'
    );
  });

  it('accepts a token and its negative', async () => {
    const source =
      "import { spacing } from '@/theme';\nexport const s = { card: { padding: spacing.sm, marginLeft: -spacing.xxs } };\n";
    expect(await lint(source)).not.toContain('Raw');
  });

  it('says nothing about a property that merely starts with padding', async () => {
    expect(await lint('export const region = { paddingKm: 25 };\n')).not.toContain('Raw');
  });

  it('refuses arithmetic between a spacing token and a number or another token', async () => {
    const prefix = "import { spacing } from '@/theme';\n";
    expect(await lint(`${prefix}export const s = { padding: spacing.sm + 2 };\n`)).toContain(
      'Spacing arithmetic'
    );
    expect(await lint(`${prefix}export const s = { marginLeft: 18 + spacing.sm };\n`)).toContain(
      'Spacing arithmetic'
    );
    expect(await lint(`${prefix}export const s = { gap: spacing.sm + spacing.xs };\n`)).toContain(
      'Spacing arithmetic'
    );
    expect(await lint(`${prefix}export const s = { padding: spacing.xs / 2 };\n`)).toContain(
      'Spacing arithmetic'
    );
  });

  it('refuses conditional raw spacing in a component and a theme style module', async () => {
    const source = 'export const s = { padding: true ? 10 : 14 };\n';
    expect(await lint(source, 'src/features/spacingLintFixture.tsx')).toContain('Raw spacing');
    expect(await lint(source, 'src/theme/spacingLintFixture.ts')).toContain('Raw spacing');
  });

  it('refuses spacing arithmetic nested inside a larger expression or a conditional', async () => {
    const prefix = "import { spacing } from '@/theme';\nconst W = 20;\n";
    for (const value of [
      'W + spacing.sm * 2',
      'spacing.sm + 2 + 0',
      '0 + spacing.sm + 2',
      'true ? spacing.sm + 2 : 0',
    ]) {
      expect(await lint(`${prefix}export const s = { paddingLeft: ${value} };\n`)).toContain(
        'Spacing arithmetic'
      );
    }
  });

  it('lets a token plus a named constant through', async () => {
    const source =
      "import { spacing } from '@/theme';\nconst W = 20;\nexport const s = { paddingLeft: W + spacing.md };\n";
    expect(await lint(source)).not.toContain('Spacing arithmetic');
  });
});
