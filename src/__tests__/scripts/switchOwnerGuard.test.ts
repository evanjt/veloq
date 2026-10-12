import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-switch-owner.mjs');

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'switch-owner-'));
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
  'src/shared/ui/Switch.tsx':
    "import { Switch as PaperSwitch } from 'react-native-paper';\nexport const Switch = PaperSwitch;\n",
};

it('passes a tree whose only switch import is the shared one', () => {
  const result = check({
    ...owner,
    'src/features/garden/LampRow.tsx':
      "import { View } from 'react-native';\nimport { Text } from 'react-native-paper';\nimport { SwitchRow } from '@/shared/ui';\n",
  });
  expect(result.failed).toBe(false);
});

it.each([
  "import { View, Switch } from 'react-native';",
  "import { Switch } from 'react-native-paper';",
  "import { Text, Switch as Toggle } from 'react-native-paper';",
  "export { Switch } from 'react-native';",
])('refuses %s in a feature and names the file and line', (line) => {
  const result = check({ ...owner, 'src/features/garden/LampRow.tsx': `export {};\n${line}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/garden/LampRow.tsx:2');
});

it('refuses a second switch import inside the shared directory', () => {
  const result = check({
    ...owner,
    'src/shared/ui/LampToggle.tsx': "import { Switch } from 'react-native';\n",
  });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/shared/ui/LampToggle.tsx:1');
});

it('passes a test file and a component of its own named Switch', () => {
  const result = check({
    ...owner,
    'src/__tests__/LampRow.test.tsx': "import { Switch } from 'react-native';\n",
    'src/features/garden/Lamp.tsx': "import { Switch } from '@/shared/ui';\n",
  });
  expect(result.failed).toBe(false);
});

it('fails when the shared switch itself is missing', () => {
  const result = check({ 'src/features/garden/Lamp.tsx': 'export {};\n' });
  expect(result.failed).toBe(true);
});
