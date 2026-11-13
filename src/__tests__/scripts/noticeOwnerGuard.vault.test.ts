import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-notice-owner.mjs');

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'notice-owner-'));
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

const owner = {
  'src/shared/ui/Notice.tsx':
    "import { Snackbar } from 'react-native-paper';\nexport { Snackbar };\n",
};

it('passes a tree whose only Snackbar is the owner', () => {
  const result = check({
    ...owner,
    'src/features/Garden.tsx': [
      "import { Text } from 'react-native-paper';",
      "import { showNotice } from '@/shared/ui/Notice';",
      "showNotice({ message: 'Seeds sown' });",
      '',
    ].join('\n'),
  });
  expect(result).toEqual({ failed: false, output: '' });
});

it.each([
  "import { Text, Snackbar } from 'react-native-paper';",
  "import { Snackbar as Toast } from 'react-native-paper';",
  "import * as Paper from 'react-native-paper';\nconst Toast = Paper.Snackbar;",
])('refuses a Snackbar outside the owner and names the file and line: %s', (source) => {
  const result = check({ ...owner, 'src/features/Garden.tsx': `export {};\n${source}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/Garden.tsx:2');
});

it('passes a test file that renders a Snackbar', () => {
  const result = check({
    ...owner,
    'src/__tests__/Garden.test.tsx': "import { Snackbar } from 'react-native-paper';\n",
  });
  expect(result.failed).toBe(false);
});

it('fails when the owner itself is missing', () => {
  expect(check({ 'src/Garden.tsx': 'export {};\n' }).failed).toBe(true);
});
