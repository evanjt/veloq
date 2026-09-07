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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { layout, spacing } from '@/theme/spacing';

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
    const steps = [spacing.xxs, spacing.xs, spacing.xsPlus, spacing.sm, spacing.md, spacing.lg];
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
  });
});

describe('the radius lint', () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function lint(source: string): string {
    const root = mkdtempSync(join(tmpdir(), 'radius-lint-'));
    roots.push(root);
    const file = join(process.cwd(), 'src', `radiusLintFixture.${root.split('-').pop()}.ts`);
    writeFileSync(file, source);
    try {
      execFileSync('npx', ['eslint', '--no-warn-ignored', '--format', 'json', file], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: process.cwd(),
      });
      return '';
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      return `${e.stdout ?? ''}${e.stderr ?? ''}`;
    } finally {
      rmSync(file, { force: true });
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
