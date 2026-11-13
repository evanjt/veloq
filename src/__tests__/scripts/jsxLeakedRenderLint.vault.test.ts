/**
 * Scenario: `{count && <Row />}` with `count === 0` renders a bare `0` outside
 * a `<Text>`, which throws under Fabric.
 *
 * Expected behaviour: the project's ESLint config fails a JSX `&&` whose left
 * side is not a boolean, and accepts the ternary and the coerced forms.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const ROOT = join(__dirname, '../../..');
const ESLINT = join(ROOT, 'node_modules/.bin/eslint');

function lint(source: string): string[] {
  let output: string;
  try {
    output = execFileSync(
      ESLINT,
      ['--stdin', '--stdin-filename', 'src/features/fixture/Rows.tsx', '-f', 'json'],
      { cwd: ROOT, input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
  } catch (error) {
    output = (error as { stdout: string }).stdout;
  }
  const [result] = JSON.parse(output) as { messages: { ruleId: string | null }[] }[];
  return result.messages.map((message) => message.ruleId ?? 'fatal');
}

function component(child: string): string {
  return [
    "import { View } from 'react-native';",
    'export function Rows({ count }: { count: number }) {',
    `  return <View>${child}</View>;`,
    '}',
    '',
  ].join('\n');
}

it('fails a number on the left of a JSX &&', () => {
  expect(lint(component('{count && <View />}'))).toContain('react/jsx-no-leaked-render');
});

it('accepts a ternary', () => {
  expect(lint(component('{count ? <View /> : null}'))).toEqual([]);
});

it('accepts a coerced or compared left side', () => {
  expect(lint(component('{!!count && <View />}'))).toEqual([]);
  expect(lint(component('{count > 0 && <View />}'))).toEqual([]);
});
