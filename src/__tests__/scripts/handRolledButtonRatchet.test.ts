/**
 * Scenario: the app has one Button in `src/shared/ui`, and the sweep of the
 * call sites onto it was never done. The shared `Button` is imported in two
 * files while `TouchableOpacity` is rendered 265 times across 101 files, so the
 * same tap has a different shape on every screen.
 *
 * Expected behaviour: a ratchet the way the rgba and feature-import guards work.
 * A file above its baseline fails and names itself, a file the baseline never
 * listed fails, and a file the tree has already beaten fails with the number to
 * paste back, so ground a sweep takes cannot be given away again.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-hand-rolled-buttons.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-buttons-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function runGuard(root: string, baseline: Record<string, number>) {
  const baselineFile = path.join(root, 'baseline.json');
  fs.writeFileSync(baselineFile, JSON.stringify(baseline));
  try {
    const stdout = execFileSync('node', [GUARD, '--root', root, '--baseline', baselineFile], {
      encoding: 'utf8',
    });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

const TWO_BUTTONS = `
import { TouchableOpacity } from 'react-native';
export const A = () => <TouchableOpacity /><TouchableOpacity />;
`;

describe('the hand-rolled button ratchet', () => {
  it('passes a file sitting exactly on its baseline', () => {
    const root = treeWith({ 'src/features/a/A.tsx': TWO_BUTTONS });

    expect(runGuard(root, { 'src/features/a/A.tsx': 2 }).status).toBe(0);
  });

  it('refuses a file that gained one, and names it', () => {
    const root = treeWith({ 'src/features/a/A.tsx': TWO_BUTTONS });
    const run = runGuard(root, { 'src/features/a/A.tsx': 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/a/A.tsx');
  });

  it('refuses a file the baseline never listed', () => {
    const root = treeWith({ 'src/features/a/A.tsx': TWO_BUTTONS });

    expect(runGuard(root, {}).status).toBe(1);
  });

  it('refuses a baseline left above the tree, so a sweep cannot be undone', () => {
    const root = treeWith({ 'src/features/a/A.tsx': TWO_BUTTONS });
    const run = runGuard(root, { 'src/features/a/A.tsx': 5 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });

  it('counts neither the shared ui itself nor the tests', () => {
    const root = treeWith({
      'src/shared/ui/Button.tsx': TWO_BUTTONS,
      'src/__tests__/a.test.tsx': TWO_BUTTONS,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });
  describe('Paper buttons', () => {
    const paperImport = (names: string) =>
      `import { ${names} } from 'react-native-paper';\nexport const A = () => null;\n`;

    it.each([
      ['Button', 'Text, Button'],
      ['SegmentedButtons', 'SegmentedButtons'],
      ['an aliased Button', 'Button as PaperButton'],
    ])('refuses %s imported from react-native-paper, even in the shared ui', (_label, names) => {
      for (const file of ['src/features/a/A.tsx', 'src/shared/ui/A.tsx']) {
        const root = treeWith({ [file]: paperImport(names) });
        const run = runGuard(root, {});

        expect(run.status).toBe(1);
        expect(run.output).toContain(file);
      }
    });

    it('refuses a multi-line import', () => {
      const root = treeWith({
        'src/features/a/A.tsx': "import {\n  Text,\n  Button,\n} from 'react-native-paper';\n",
      });

      expect(runGuard(root, {}).status).toBe(1);
    });

    it('allows the other Paper components, including IconButton', () => {
      const root = treeWith({
        'src/features/a/A.tsx': paperImport('Text, IconButton, Switch, TextInput'),
      });

      expect(runGuard(root, {}).status).toBe(0);
    });
  });
});
