import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const script = join(__dirname, '../../../scripts/lint-modal-owner.mjs');

function check(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'modal-owner-'));
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
  'src/shared/ui/FullWindowModal.tsx':
    "import { Modal } from 'react-native';\nexport const FullWindowModal = Modal;\n",
};

it('passes a tree that opens its modals through the owner', () => {
  const result = check({
    ...owner,
    'src/features/Gallery.tsx': [
      "import { View, type ModalProps } from 'react-native';",
      "import { FullWindowModal } from '@/shared/ui/FullWindowModal';",
      '',
    ].join('\n'),
    'src/__tests__/Gallery.test.tsx': "import { Modal } from 'react-native';\n",
  });
  expect(result).toEqual({ failed: false, output: '' });
});

it.each([
  "import { View, Modal } from 'react-native';",
  "import { Modal as Sheet } from 'react-native';",
  "import {\n  View,\n  Modal,\n} from 'react-native';",
])('refuses %s outside the owner and names the file and line', (line) => {
  const result = check({ ...owner, 'src/features/Gallery.tsx': `export {};\n${line}\n` });
  expect(result.failed).toBe(true);
  expect(result.output).toContain('src/features/Gallery.tsx:2');
  expect(result.output).toContain('FullWindowModal');
});

it('refuses a tree with no owner', () => {
  const result = check({ 'src/features/Gallery.tsx': 'export {};\n' });
  expect(result.failed).toBe(true);
});
