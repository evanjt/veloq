/**
 * Scenario: 493 paddings, margins and gaps were literals beside 1,758 token
 * references, and nothing stopped the next one.
 *
 * Expected behaviour: a raw spacing literal fails the lint, a token passes, a
 * zero passes because it is not a rung, and a negative literal fails too.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');

function lint(source: string): string {
  try {
    execFileSync(
      'npx',
      [
        'eslint',
        '--stdin',
        '--stdin-filename',
        'src/spacingLintFixture.ts',
        '--no-warn-ignored',
        '--format',
        'json',
      ],
      { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], cwd: ROOT }
    );
    return '';
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`;
  }
}

describe('the spacing lint', () => {
  it('refuses a raw padding, margin and gap', () => {
    expect(lint('export const s = { card: { padding: 10 } };\n')).toContain('Raw spacing');
    expect(lint('export const s = { card: { marginTop: 3 } };\n')).toContain('Raw spacing');
    expect(lint('export const s = { row: { gap: 12 } };\n')).toContain('Raw spacing');
  });

  it('refuses a negative one', () => {
    expect(lint('export const s = { pull: { marginLeft: -2 } };\n')).toContain(
      'Raw negative spacing'
    );
  });

  it('lets a zero through, since it is not a rung', () => {
    expect(lint('export const s = { flush: { padding: 0, marginTop: 0 } };\n')).not.toContain(
      'Raw'
    );
  });

  it('accepts a token and its negative', () => {
    const source =
      "import { spacing } from '@/theme';\nexport const s = { card: { padding: spacing.sm, marginLeft: -spacing.xxs } };\n";
    expect(lint(source)).not.toContain('Raw');
  });

  it('says nothing about a property that merely starts with padding', () => {
    expect(lint('export const region = { paddingKm: 25 };\n')).not.toContain('Raw');
  });
});
