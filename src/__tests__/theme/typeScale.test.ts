/**
 * Scenario: 438 font sizes were written as numbers while a token already
 * declared almost every one of them, so the scale the app drew and the scale
 * it named were kept in step by hand.
 *
 * Expected behaviour: every size the app draws has a role in the scale, an
 * edit to the scale is a deliberate diff, and the lint that keeps a new
 * literal off it actually fires.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { typography } from '@/theme/typography';

const ROOT = join(__dirname, '../../..');

/** Every size the scale declares, from the smallest role to the largest. */
const SIZES = [9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28, 32, 36, 44, 48];

describe('the type scale', () => {
  it('declares exactly these sizes, and nothing else', () => {
    const sizes = [...new Set(Object.values(typography).map((role) => role.fontSize))].sort(
      (a, b) => a - b
    );
    expect(sizes).toEqual(SIZES);
  });

  it('gives every role a line height at least its own size', () => {
    for (const [name, role] of Object.entries(typography)) {
      expect([name, role.lineHeight >= role.fontSize]).toEqual([name, true]);
    }
  });

  it('keeps the three roles added for the sweep', () => {
    expect(typography.bodyMedium.fontSize).toBe(15);
    expect(typography.statsValueLarge.fontSize).toBe(24);
    expect(typography.headlineNumber.fontSize).toBe(32);
  });
});

describe('the font size lint', () => {
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
          'src/typeLintFixture.ts',
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

  it('refuses a raw size in a plain stylesheet module', () => {
    expect(lint('export const s = { label: { fontSize: 12 } };\n')).toContain('Raw font size');
  });

  it('refuses one that is already on the scale, so the rule is the shape and not the value', () => {
    expect(lint('export const s = { title: { fontSize: 28 } };\n')).toContain('Raw font size');
  });

  it('accepts a token', () => {
    const source =
      "import { typography } from '@/theme';\nexport const s = { label: { fontSize: typography.caption.fontSize } };\n";
    expect(lint(source)).not.toContain('Raw font size');
  });
});
