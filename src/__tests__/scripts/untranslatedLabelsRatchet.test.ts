/**
 * Scenario: an English sentence or accessibility label is written into JSX instead of drawn
 * through `t()`, so it reads in English under every app language.
 *
 * Expected behaviour: a per-file ceiling counts JSX text with a letter in it and plain-string
 * `accessibilityLabel` and `accessibilityHint` values. A translated value, a symbol-only text,
 * a test file and the error boundary are not counted.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-untranslated-labels.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-labels-'));
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

const FILE = 'src/features/a/A.tsx';

describe('the untranslated label ratchet', () => {
  it('refuses a literal accessibility label in a file the baseline never listed', () => {
    const root = treeWith({
      [FILE]: `export const A = () => <Pressable accessibilityLabel="Open settings" />;`,
    });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain(FILE);
  });

  it('refuses a braced string label and a JSX sentence', () => {
    const root = treeWith({
      [FILE]: `export const A = () => (<View><Pressable accessibilityHint={'Reload'} /><Text>Fitness</Text></View>);`,
    });

    expect(runGuard(root, { [FILE]: 1 }).status).toBe(1);
    expect(runGuard(root, { [FILE]: 2 }).status).toBe(0);
  });

  it('passes translated labels, interpolated text and symbol-only text', () => {
    const root = treeWith({
      [FILE]: `export const A = () => (<View><Pressable accessibilityLabel={t('common.openSettings')} accessibilityHint={\`\${t('a')}: \${b}\`} /><Text>{n} · {t('x')}</Text></View>);`,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('leaves the error boundary and tests alone', () => {
    const root = treeWith({
      'src/features/a/GlobalErrorBoundary.tsx': `export const A = () => <Text>Reload</Text>;`,
      'src/features/a/__tests__/A.tsx': `export const A = () => <Text>Reload</Text>;`,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('asks for the baseline to come down when the tree beats it', () => {
    const root = treeWith({ [FILE]: `export const A = () => <View />;` });
    const run = runGuard(root, { [FILE]: 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });
});
