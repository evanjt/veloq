/**
 * Scenario: a press that only navigates fires no haptic, and the navigation helpers are where a
 * haptic would come back for every such press at once.
 *
 * Expected behaviour: the guard refuses a haptic import or call in the navigation module, names
 * the file and line, and passes the module when it navigates only.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-navigation-haptics.mjs');
const MODULE = 'src/shared/app/navigation.ts';

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'navigation-haptics-'));
  for (const [rel, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), source);
  }
  try {
    execFileSync('node', [script, '--root', root], { stdio: ['ignore', 'pipe', 'pipe'] });
    return { failed: false, output: '' };
  } catch (error) {
    const failure = error as { stderr?: Buffer };
    return { failed: true, output: failure.stderr?.toString() ?? '' };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const silent = [
  "import { router, type Href } from 'expo-router';",
  'export function navigateTo(path: string): void {',
  '  router.push(path as Href);',
  '}',
  '',
].join('\n');

it('passes a navigation module that only navigates', () => {
  expect(check({ [MODULE]: silent }).failed).toBe(false);
});

it('passes a module whose comment names a haptic', () => {
  const source = `// A press that navigates fires no haptic, so nothing here calls haptics.light().\n${silent}`;
  expect(check({ [MODULE]: source }).failed).toBe(false);
});

it('refuses a light impact fired before the push and names the line', () => {
  const source = [
    "import { router, type Href } from 'expo-router';",
    "import * as haptics from '@/shared/ui/haptics';",
    'export function tapTo(path: string): void {',
    '  haptics.light();',
    '  router.push(path as Href);',
    '}',
    '',
  ].join('\n');
  const result = check({ [MODULE]: source });
  expect(result.failed).toBe(true);
  expect(result.output).toContain(`${MODULE}:2`);
  expect(result.output).toContain(`${MODULE}:4`);
});

it.each([
  "import { light } from '../ui/haptics';",
  "import * as Haptics from 'expo-haptics';",
  "const haptics = require('@/shared/ui/haptics');",
  "export { light } from '@/shared/ui/haptics';",
])('refuses %s', (line) => {
  const result = check({ [MODULE]: `${silent}${line}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain(`${MODULE}:5`);
});

it('refuses a call through a renamed haptics namespace on a second call too', () => {
  const source = [
    "import * as feel from '@/shared/ui/haptics';",
    'export function goBack(): void {',
    '  feel.selection();',
    '  feel.medium();',
    '}',
    '',
  ].join('\n');
  const result = check({ [MODULE]: source });
  expect(result.failed).toBe(true);
  expect(result.output).toContain(`${MODULE}:3`);
  expect(result.output).toContain(`${MODULE}:4`);
});

it('fails when the navigation module is missing', () => {
  expect(check({ 'src/Other.ts': 'export {};\n' }).failed).toBe(true);
});
