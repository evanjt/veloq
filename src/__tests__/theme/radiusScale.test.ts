/**
 * Scenario: a raw radius or hex literal in a stylesheet module bypasses the tokens.
 *
 * Expected behaviour: the lint that keeps a new literal off the scale actually fires.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');

describe('the radius lint', () => {
  // Through stdin, under a name the rule's `src/**` glob matches. A real file
  // written into `src/` is what a whole-tree gate in another worker then
  // catches half-there, and it fails on the ENOENT rather than on what it
  // measures.
  function lint(source: string, filename = 'src/radiusLintFixture.ts'): string {
    try {
      execFileSync(
        'npx',
        [
          'eslint',
          '--stdin',
          '--stdin-filename',
          filename,
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

  it('refuses a radius set from a spacing token, and accepts a radius token', () => {
    const spacingSource =
      "import { spacing } from '@/theme';\nexport const s = { chip: { borderRadius: spacing.xsPlus } };\n";
    expect(lint(spacingSource)).toContain('Raw border radius');
    const cornerSource =
      "import { spacing } from '@/theme';\nexport const s = { sheet: { borderTopLeftRadius: spacing.md } };\n";
    expect(lint(cornerSource)).toContain('Raw border radius');
    const conditionalSource =
      "import { spacing } from '@/theme';\nexport const s = { chip: { borderRadius: true ? spacing.xs : 0 } };\n";
    expect(lint(conditionalSource)).toContain('Raw border radius');
    const tokenSource =
      "import { layout } from '@/theme';\nexport const s = { chip: { borderRadius: layout.borderRadiusSm } };\n";
    expect(lint(tokenSource)).not.toContain('Raw border radius');
  });

  it('requires the map text shadow token outside the theme', () => {
    expect(lint('export const s = { textShadowRadius: 2 };\n')).toContain('Raw text shadow radius');
    expect(lint('export const s = { textShadowOffset: { width: 0, height: 1 } };\n')).toContain(
      'Raw text shadow offset'
    );
    const source =
      "import { mapTextShadow } from '@/theme';\nexport const s = { ...mapTextShadow };\n";
    expect(lint(source)).not.toContain('Raw text shadow');
  });

  it('refuses a per-corner radius and a conditional radius', () => {
    expect(lint('export const s = { borderTopLeftRadius: 10 };\n')).toContain('Raw border radius');
    expect(lint('export const s = { borderBottomRightRadius: true ? 3 : 0 };\n')).toContain(
      'Raw border radius'
    );
  });

  it('refuses hex in TypeScript and TSX while preserving the type scale rule', () => {
    const source = "export const s = { color: '#ff0000' };\n";
    expect(lint(source, 'src/features/hexLintFixture.ts')).toContain('Raw hex colour');
    expect(lint(source, 'src/features/hexLintFixture.tsx')).toContain('Raw hex colour');
    expect(
      lint('export const s = { fontSize: 13 };\n', 'src/features/hexLintFixture.tsx')
    ).toContain('Raw font size');
    expect(
      lint('export const s = { fontSize: true ? 13 : 15 };\n', 'src/features/hexLintFixture.tsx')
    ).toContain('Raw font size');
  });

  it('refuses hex written inside a template literal, and accepts one with none', () => {
    const file = 'src/features/hexLintFixture.ts';
    expect(lint('export const s = { color: `#ff0000` };\n', file)).toContain('Raw hex colour');
    expect(lint("export const s = `{ 'line-color': '#FFF' }`;\n", file)).toContain(
      'Raw hex colour'
    );
    expect(lint('export const s = `line-color: ${color}`;\n', file)).not.toContain(
      'Raw hex colour'
    );
    expect(lint('export const s = `#${id}`;\n', file)).not.toContain('Raw hex colour');
  });
});
