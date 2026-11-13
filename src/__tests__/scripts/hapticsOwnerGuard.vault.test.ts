import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-haptics-owner.mjs');

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'haptics-owner-'));
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

const helper = {
  'src/shared/ui/haptics.ts':
    "import * as ExpoHaptics from 'expo-haptics';\nexport const x = ExpoHaptics;\n",
};

it('passes a tree whose only import is the helper', () => {
  expect(
    check({ ...helper, 'src/Card.tsx': "import { haptics } from '@/shared/ui/haptics';\n" }).failed
  ).toBe(false);
});

it.each([
  "import * as Haptics from 'expo-haptics';",
  "import { impactAsync } from 'expo-haptics';",
  "const Haptics = require('expo-haptics');",
  "export { selectionAsync } from 'expo-haptics';",
  "const Haptics = await import('expo-haptics');",
])('refuses %s in a component and names the file and line', (line) => {
  const result = check({ ...helper, 'src/features/Card.tsx': `export {};\n${line}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/Card.tsx:2');
});

it('passes a test file and a string mention', () => {
  const result = check({
    ...helper,
    'src/__tests__/Card.test.tsx': "import * as Haptics from 'expo-haptics';\n",
    'src/app/licenses.tsx': "export const names = ['expo-haptics'];\n",
  });
  expect(result.failed).toBe(false);
});

it('fails when the helper itself is missing', () => {
  const result = check({ 'src/Card.tsx': 'export {};\n' });
  expect(result.failed).toBe(true);
});
