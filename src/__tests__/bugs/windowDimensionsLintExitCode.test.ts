/**
 * Scenario: eleven files read `Dimensions.get('window')` once at module scope
 * and laid out pages, maps and swipe thresholds from a value that never
 * changed after launch, so a rotation or an unfold left them sized for the
 * old window.
 *
 * Expected behaviour: the guard fails a module-scope read anywhere under
 * `src/`, leaves a read inside a function body alone, ignores tests, and
 * passes on this repository.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-window-dimensions.mjs');

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'window-dimensions-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('exits 0 on this repo, so the audit gate stays usable', () => {
  expect(runGuard().status).toBe(0);
});

it('fails a destructured read at module scope', () => {
  const root = fixture({
    'src/shared/ui/Tabs.tsx': [
      "import { Dimensions } from 'react-native';",
      "const { width: SCREEN_WIDTH } = Dimensions.get('window');",
      'export const THRESHOLD = SCREEN_WIDTH * 0.2;',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/shared/ui/Tabs.tsx:2');
});

it('fails a read buried in a module-scope expression, such as a stylesheet', () => {
  const root = fixture({
    'src/features/x/Sheet.tsx': [
      "import { Dimensions, StyleSheet } from 'react-native';",
      'const styles = StyleSheet.create({',
      "  sheet: { height: Dimensions.get('window').height * 0.85 },",
      '});',
    ].join('\n'),
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/x/Sheet.tsx:3');
});

it('leaves a read inside a function body alone', () => {
  const root = fixture({
    'src/features/x/Card.tsx': [
      "import { Dimensions } from 'react-native';",
      'export function Card() {',
      "  const width = Dimensions.get('window').width;",
      '  return width;',
      '}',
      "export const measure = () => Dimensions.get('screen');",
    ].join('\n'),
  });

  expect(runGuard(root).status).toBe(0);
});

it('names every file, not only the first', () => {
  const root = fixture({
    'src/a.ts': "import { Dimensions } from 'react-native';\nconst h = Dimensions.get('window');\n",
    'src/b.tsx':
      "import { Dimensions } from 'react-native';\nconst w = Dimensions.get('window');\n",
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/a.ts:2');
  expect(output).toContain('src/b.tsx:2');
});

it('ignores tests, which fix a window on purpose', () => {
  const root = fixture({
    'src/__tests__/layout.test.tsx': "const w = Dimensions.get('window');\n",
    'src/features/x/thing.test.ts': "const w = Dimensions.get('window');\n",
  });

  expect(runGuard(root).status).toBe(0);
});

it('does not mistake another object called get for the read', () => {
  const root = fixture({
    'src/features/x/store.ts': "const settings = new Map();\nconst v = settings.get('window');\n",
  });

  expect(runGuard(root).status).toBe(0);
});
