/**
 * Scenario: new code takes Paper's `Text`, so Android inherits the Material 3
 * type and colour. react-native's `Text` takes the platform default wherever a
 * style omits them, and a screen mixing the two reads as two typefaces.
 *
 * Expected behaviour: a file outside `src/shared/ui/` importing `Text` from
 * react-native that the baseline does not list fails and is named. Paper's
 * `Text` passes. A listed file that no longer imports it fails as stale, so
 * the list only shrinks.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-react-native-text.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-rn-text-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function runGuard(root: string, baseline: string[], extra: string[] = []) {
  const baselineFile = path.join(root, 'baseline.json');
  fs.writeFileSync(baselineFile, JSON.stringify(baseline));
  try {
    const stdout = execFileSync(
      'node',
      [GUARD, '--root', root, '--baseline', baselineFile, ...extra],
      { encoding: 'utf8' }
    );
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  }
}

const FILE = 'src/features/a/Badge.tsx';
const NATIVE = "import { View, Text } from 'react-native';\nexport const A = () => <Text />;\n";
const PAPER =
  "import { View } from 'react-native';\nimport { Text } from 'react-native-paper';\nexport const A = () => <Text />;\n";

describe('the react-native Text guard', () => {
  it('refuses a react-native Text import in a file outside the baseline, naming it', () => {
    const run = runGuard(treeWith({ [FILE]: NATIVE }), []);

    expect(run.status).toBe(1);
    expect(run.output).toContain(FILE);
    expect(run.output).toContain('react-native-paper');
  });

  it("passes Paper's Text", () => {
    expect(runGuard(treeWith({ [FILE]: PAPER }), []).status).toBe(0);
  });

  it('passes a file the baseline lists', () => {
    expect(runGuard(treeWith({ [FILE]: NATIVE }), [FILE]).status).toBe(0);
  });

  it('refuses a baseline entry whose file now takes Paper, naming it as stale', () => {
    const run = runGuard(treeWith({ [FILE]: PAPER }), [FILE]);

    expect(run.status).toBe(1);
    expect(run.output).toContain(FILE);
    expect(run.output).toContain('stale');
  });

  it('refuses a baseline entry whose file is gone', () => {
    const root = treeWith({ 'src/features/a/Other.tsx': 'export const B = 1;\n' });

    expect(runGuard(root, [FILE]).status).toBe(1);
  });

  it('reads an aliased import and one split across lines', () => {
    const aliased = treeWith({ [FILE]: "import { Text as RNText } from 'react-native';\n" });
    const split = treeWith({
      [FILE]: 'import {\n  View,\n  Text,\n  StyleSheet,\n} from "react-native";\n',
    });

    expect(runGuard(aliased, []).status).toBe(1);
    expect(runGuard(split, []).status).toBe(1);
  });

  it('does not read TextInput, a type-only Text, or another name ending in Text', () => {
    const root = treeWith({
      [FILE]:
        "import { TextInput, type Text, AnimatedText } from 'react-native';\nimport type { TextProps } from 'react-native';\n",
    });

    expect(runGuard(root, []).status).toBe(0);
  });

  it('counts nothing under src/shared/ui/ or the test tree', () => {
    const root = treeWith({
      'src/shared/ui/Label.tsx': NATIVE,
      'src/__tests__/a.test.tsx': NATIVE,
    });

    expect(runGuard(root, []).status).toBe(0);
  });

  it('writes the baseline the tree holds with --write, which then passes', () => {
    const root = treeWith({ [FILE]: NATIVE, 'src/features/a/Other.tsx': PAPER });

    expect(runGuard(root, [], ['--write']).status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'baseline.json'), 'utf8'))).toEqual([FILE]);
  });
});
