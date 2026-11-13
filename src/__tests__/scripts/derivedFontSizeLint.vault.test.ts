/**
 * Scenario: a text style takes a role's size and adds or subtracts a point, or
 * holds a size in a constant, which passes a rule that refuses only a numeric
 * literal and draws a size the type scale does not have.
 *
 * Expected behaviour: the project's ESLint config fails a font size computed
 * from a role or read from a constant, and accepts a spread role.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const ESLINT = join(ROOT, 'node_modules/.bin/eslint');

function lint(style: string): string[] {
  const source = [
    "import { StyleSheet } from 'react-native';",
    "import { typography } from '@/theme';",
    'const CHIP_SIZE = 10;',
    `export const styles = StyleSheet.create({ text: ${style} });`,
    'void CHIP_SIZE;',
    '',
  ].join('\n');
  let output: string;
  try {
    output = execFileSync(
      ESLINT,
      ['--stdin', '--stdin-filename', 'src/features/fixture/Chip.tsx', '-f', 'json'],
      { cwd: ROOT, input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (error) {
    output = (error as { stdout: string }).stdout;
  }
  const [result] = JSON.parse(output) as { messages: { ruleId: string | null }[] }[];
  return result.messages.map((message) => message.ruleId ?? 'fatal');
}

it('fails a size one point under a role', () => {
  expect(lint('{ fontSize: typography.caption.fontSize - 1 }')).toContain('no-restricted-syntax');
});

it('fails a size one point over a role', () => {
  expect(lint('{ fontSize: typography.bodySmall.fontSize + 1 }')).toContain('no-restricted-syntax');
});

it('fails a size held in a constant', () => {
  expect(lint('{ fontSize: CHIP_SIZE }')).toContain('no-restricted-syntax');
});

it('accepts a spread role', () => {
  expect(lint('{ ...typography.captionBold }')).toEqual([]);
});
