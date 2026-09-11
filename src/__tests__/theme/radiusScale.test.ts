/**
 * Scenario: the app declared a radius scale of 4, 8, 16 and 24 and drew 10, 12,
 * 14 and 20 more often than any of them, so the plurality of what shipped had
 * no token at all and every one of those sites was a literal.
 *
 * Expected behaviour: the scale is exactly the ladder that was chosen, so an
 * edit to it is a deliberate diff and not a drift, and the lint that keeps a
 * new literal off it actually fires.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { layout, spacing } from '@/theme/spacing';

const ROOT = join(__dirname, '../../..');

/** The rungs the scale was settled on, taken from what the app already drew. */
const RADII = [4, 8, 12, 16, 20, 24, 9999];

describe('the radius scale', () => {
  it('is the ladder that was settled on, and nothing else', () => {
    const radii = Object.entries(layout)
      .filter(([key]) => key.startsWith('borderRadius'))
      .map(([, value]) => value)
      .sort((a, b) => a - b);
    expect(radii).toEqual(RADII);
  });

  it('names each rung once, so two tokens cannot drift onto one value', () => {
    const radii = Object.entries(layout).filter(([key]) => key.startsWith('borderRadius'));
    expect(new Set(radii.map(([, v]) => v)).size).toBe(radii.length);
  });

  it('carries the two micro steps as spacing, not as radius', () => {
    expect(spacing.xxs).toBe(2);
    expect(spacing.xsPlus).toBe(6);
  });

  it('keeps the spacing ladder ascending', () => {
    const steps = [
      spacing.xxs,
      spacing.xs,
      spacing.xsPlus,
      spacing.sm,
      spacing.smPlus,
      spacing.md,
      spacing.lg,
    ];
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });

  /**
   * 8 to 16 was a doubling with nothing in it, and the app drew a 10 at 30
   * sites and a 12 at 29, so a third of the off-ladder paddings had no rung to
   * fold to. The radius scale has carried a 12 since it was settled.
   */
  it('carries the half-step between 8 and 16 the app actually draws', () => {
    expect(spacing.smPlus).toBe(12);
    expect(spacing.smPlus).toBe(layout.borderRadiusMd);
  });

  it('names each spacing rung once, so two tokens cannot drift onto one value', () => {
    const rungs = [
      spacing.xxs,
      spacing.xs,
      spacing.xsPlus,
      spacing.sm,
      spacing.smPlus,
      spacing.md,
      spacing.lg,
      spacing.xl,
      spacing.xxl,
    ];
    expect(new Set(rungs).size).toBe(rungs.length);
  });
});

describe('the radius lint', () => {
  // Through stdin, under a name the rule's `src/**` glob matches. A real file
  // written into `src/` is what a whole-tree gate in another worker then
  // catches half-there, and it fails on the ENOENT rather than on what it
  // measures.
  function lint(source: string): string {
    try {
      execFileSync(
        'npx',
        [
          'eslint',
          '--stdin',
          '--stdin-filename',
          'src/radiusLintFixture.ts',
          '--no-warn-ignored',
          '--format',
          'json',
        ],
        {
          input: source,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: ROOT,
        }
      );
      return '';
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      return `${e.stdout ?? ''}${e.stderr ?? ''}`;
    }
  }

  it('refuses a raw radius in a plain stylesheet module', () => {
    expect(lint('export const s = { card: { borderRadius: 10 } };\n')).toContain(
      'Raw border radius'
    );
  });

  it('refuses a fractional one, which is how a circle was written', () => {
    expect(lint('export const s = { dot: { borderRadius: 2.5 } };\n')).toContain(
      'Raw border radius'
    );
  });

  it('accepts a token', () => {
    const source =
      "import { layout } from '@/theme';\nexport const s = { card: { borderRadius: layout.borderRadiusMd } };\n";
    expect(lint(source)).not.toContain('Raw border radius');
  });
});
