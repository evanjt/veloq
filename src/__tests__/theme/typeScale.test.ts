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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { typography } from '@/theme/typography';

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
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  function lint(source: string): string {
    const root = mkdtempSync(join(tmpdir(), 'type-lint-'));
    roots.push(root);
    const file = join(process.cwd(), 'src', `typeLintFixture.${root.split('-').pop()}.ts`);
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
