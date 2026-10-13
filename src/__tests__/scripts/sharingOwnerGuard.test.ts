import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-sharing-owner.mjs');

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'sharing-owner-'));
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
  'src/features/settings/lib/shareFile.ts':
    "function getSharing() { return require('expo-sharing'); }\nexport const x = getSharing;\n",
};

it('passes a tree whose only importer is the helper', () => {
  expect(
    check({
      ...helper,
      'src/features/kayak/shareLog.ts':
        "import { shareExistingFile } from '@/features/settings/lib/shareFile';\n",
    }).failed
  ).toBe(false);
});

it.each([
  "import * as Sharing from 'expo-sharing';",
  "import { shareAsync } from 'expo-sharing';",
  "const Sharing = require('expo-sharing');",
  "export { shareAsync } from 'expo-sharing';",
  "const Sharing = await import('expo-sharing');",
])('refuses %s outside the helper and names the file and line', (line) => {
  const result = check({ ...helper, 'src/features/kayak/shareLog.ts': `export {};\n${line}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/kayak/shareLog.ts:2');
});

it.each([
  "import { Share } from 'react-native';\nvoid Share.share({ message: 'x' });",
  "import { Share as Sheet } from 'react-native';\nvoid Sheet.share({ message: 'x' });",
  "import * as RN from 'react-native';\nvoid RN.Share.share({ message: 'x' });",
])('refuses a text share outside the helper: %s', (source) => {
  const result = check({ ...helper, 'src/features/kayak/Card.tsx': `${source}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/kayak/Card.tsx:2');
});

it('passes a share method on something that is not the sheet', () => {
  const result = check({
    ...helper,
    'src/features/kayak/Card.tsx':
      "import { Share } from 'react-native';\nexport const x = Share;\nconst api = { share: () => 1 };\napi.share();\n",
  });
  expect(result.failed).toBe(false);
});

it('passes a test file and a string mention', () => {
  const result = check({
    ...helper,
    'src/__tests__/shareLog.test.ts': "import * as Sharing from 'expo-sharing';\n",
    'src/app/licenses.tsx': "export const names = ['expo-sharing'];\n",
  });
  expect(result.failed).toBe(false);
});

it('fails when the helper itself is missing', () => {
  const result = check({ 'src/Card.tsx': 'export {};\n' });
  expect(result.failed).toBe(true);
});
