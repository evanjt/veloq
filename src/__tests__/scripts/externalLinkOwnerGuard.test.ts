import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-external-link-owner.mjs');

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'external-link-owner-'));
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
  'src/shared/app/openExternal.ts':
    'export async function openExternal(url: string) {\n' +
    '  await WebBrowser.openBrowserAsync(url);\n' +
    '  await Linking.openURL(url);\n' +
    '}\n',
};

it('passes a tree that opens pages only through the helper', () => {
  const result = check({
    ...helper,
    'src/Card.tsx':
      "import { openExternal } from '@/shared/app/openExternal';\nopenExternal('x');\n",
  });
  expect(result.failed).toBe(false);
});

it.each([
  "Linking.openURL('https://example.org');",
  "ExpoLinking.openURL('https://example.org');",
  "WebBrowser.openBrowserAsync('https://example.org');",
  "openBrowserAsync('https://example.org');",
  "Linking['openURL']('https://example.org');",
])('refuses %s in a component and names the file and line', (line) => {
  const result = check({ ...helper, 'src/features/Card.tsx': `export {};\n${line}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/Card.tsx:2');
});

it('passes the settings and sign-in sessions, a test file and a string mention', () => {
  const result = check({
    ...helper,
    'src/features/Settings.tsx': 'Linking.openSettings();\nLinking.sendIntent("x");\n',
    'src/features/auth/oauth.ts': 'WebBrowser.openAuthSessionAsync(a, b);\n',
    'src/__tests__/Card.test.tsx': "Linking.openURL('https://example.org');\n",
    'src/app/notes.ts': "export const note = 'call Linking.openURL';\n",
  });
  expect(result.failed).toBe(false);
});

it('fails when the helper itself is missing', () => {
  expect(check({ 'src/Card.tsx': 'export {};\n' }).failed).toBe(true);
});
