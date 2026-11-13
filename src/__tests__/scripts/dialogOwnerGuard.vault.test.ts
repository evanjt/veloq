import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-dialog-owner.mjs');

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'dialog-owner-'));
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
  'src/shared/ui/dialog.ts':
    "import { Alert } from 'react-native';\nexport const inform = () => Alert.alert('x');\n",
};

it('passes a tree that raises dialogs through the helpers with named titles', () => {
  const result = check({
    ...helper,
    'src/features/Backup.tsx': [
      "import { inform } from '@/shared/ui/dialog';",
      "inform({ title: t('backup.notRestoredTitle'), message: t('common.error') });",
      '',
    ].join('\n'),
  });
  expect(result).toEqual({ failed: false, output: '' });
});

it.each(["Alert.alert('Delete?', 'Gone for good');", "Alert.prompt('Name', 'Type one');"])(
  'refuses %s outside the helper and names the file and line',
  (line) => {
    const result = check({ ...helper, 'src/features/Card.tsx': `export {};\n${line}\n` });
    expect(result.failed).toBe(true);
    expect(result.output).toContain('src/features/Card.tsx:2');
  }
);

it.each([
  "inform({ title: t('common.error'), message: 'Disk full' });",
  "inform({ title: i18n.t('alerts.error'), message: 'Disk full' });",
  "confirmAction({ title: t('common.error'), confirmLabel: 'Retry', cancelLabel: 'Cancel', onConfirm });",
])('refuses a bare error title: %s', (line) => {
  const result = check({ ...helper, 'src/features/Card.tsx': `export {};\n${line}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/Card.tsx:2');
  expect(result.output).toContain('bare error');
});

it.each([
  "confirmAction({ title: 'Delete?', confirmLabel: t('common.confirm'), cancelLabel: 'Cancel', onConfirm });",
  "confirmAction({ title: 'Delete?', confirmLabel: i18n.t('common.confirm'), cancelLabel: 'Cancel', onConfirm });",
])('refuses a confirm button labelled with the generic word: %s', (line) => {
  const result = check({ ...helper, 'src/features/Card.tsx': `export {};\n${line}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/Card.tsx:2');
  expect(result.output).toContain('name the action');
});

it('passes a confirm button that names its action', () => {
  const result = check({
    ...helper,
    'src/features/Card.tsx': [
      'export {};',
      "confirmAction({ title: t('garden.prune'), confirmLabel: t('garden.prune'), cancelLabel: t('common.cancel'), onConfirm });",
      '',
    ].join('\n'),
  });
  expect(result).toEqual({ failed: false, output: '' });
});

it('passes a test file that spies on Alert', () => {
  const result = check({
    ...helper,
    'src/__tests__/Card.test.tsx': "jest.spyOn(Alert, 'alert');\nAlert.alert('x');\n",
  });
  expect(result.failed).toBe(false);
});

it('fails when the helper itself is missing', () => {
  expect(check({ 'src/Card.tsx': 'export {};\n' }).failed).toBe(true);
});
