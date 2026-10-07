/**
 * Scenario: a raw font size in a stylesheet module bypasses the type scale.
 *
 * Expected behaviour: the lint that keeps a new literal off the scale actually fires.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');

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
