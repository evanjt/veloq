/**
 * Scenario: an English sentence, unit or accessibility label is written into JSX instead of drawn
 * through `t()`, so it reads in English under every app language.
 *
 * Expected behaviour: the guard refuses JSX text with a letter in it, a string or template
 * literal rendered as a JSX child, and a plain-string `accessibilityLabel` or
 * `accessibilityHint`, naming the file and line. A translated value, symbol-only text, a listed
 * proper name, a test file, the error boundary and the listed debug screens pass. A debug screen
 * the list names and the tree lacks fails, so the exemption cannot outlive the screen.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-untranslated-labels.mjs');

const DEBUG_SCREENS = [
  'src/app/debug.tsx',
  'src/features/insights/components/InsightDebugPanel.tsx',
  'src/features/routes/components/DebugInfoPanel.tsx',
  'src/features/routes/components/SyncDebugSection.tsx',
];

function treeWith(files: Record<string, string>, { debugScreens = DEBUG_SCREENS } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-labels-'));
  const debug = Object.fromEntries(
    debugScreens.map((rel) => [rel, `export const D = () => <Text>Raw engine counters</Text>;`])
  );
  for (const [rel, body] of Object.entries({ ...debug, ...files })) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function runGuard(root: string) {
  try {
    const stdout = execFileSync('node', [GUARD, '--root', root], { encoding: 'utf8' });
    return { status: 0, output: stdout };
  } catch (error) {
    const e = error as { status: number; stdout: string; stderr: string };
    return { status: e.status, output: `${e.stdout}${e.stderr}` };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const FILE = 'src/features/a/A.tsx';

describe('the untranslated label guard', () => {
  it('refuses a literal accessibility label, naming the file and line', () => {
    const run = runGuard(
      treeWith({
        [FILE]: `export const A = () => <Pressable accessibilityLabel="Open settings" />;`,
      })
    );

    expect(run.status).toBe(1);
    expect(run.output).toContain(`${FILE}:1`);
  });

  it('refuses a braced string label and a JSX sentence', () => {
    const run = runGuard(
      treeWith({
        [FILE]: `export const A = () => (<View><Pressable accessibilityHint={'Reload'} /><Text>Fitness</Text></View>);`,
      })
    );

    expect(run.status).toBe(1);
    expect(run.output).toContain('"Reload"');
    expect(run.output).toContain('"Fitness"');
  });

  it('refuses a plain-string label, title or placeholder a component renders', () => {
    const run = runGuard(
      treeWith({
        [FILE]: `export const A = () => (<View><KilnGauge label="Firing curve" /><Sheet title="Glaze log" /><Field placeholder={'Clay body'} /></View>);`,
      })
    );

    expect(run.status).toBe(1);
    expect(run.output).toContain('"Firing curve"');
    expect(run.output).toContain('"Glaze log"');
    expect(run.output).toContain('"Clay body"');
  });

  it('passes a file format named as a label', () => {
    const run = runGuard(treeWith({ [FILE]: `export const A = () => <Chip label="GPX" />;` }));

    expect(run.status).toBe(0);
  });

  it('refuses a unit written after a value', () => {
    const run = runGuard(treeWith({ [FILE]: `export const A = () => <Text>{watts}W</Text>;` }));

    expect(run.status).toBe(1);
    expect(run.output).toContain('"W"');
  });

  it('refuses words in a template or a conditional branch rendered as a child', () => {
    const run = runGuard(
      treeWith({
        [FILE]: `export const A = () => (<Text>{days ? \`\${days} days: \` : ''}{load > 0 && \` · \${load} TSS\`}</Text>);`,
      })
    );

    expect(run.status).toBe(1);
    expect(run.output).toContain('" days: "');
    expect(run.output).toContain('" TSS"');
  });

  it('passes translated labels, interpolated text, symbols and listed names', () => {
    const run = runGuard(
      treeWith({
        [FILE]: `export const A = () => (<View><Pressable accessibilityLabel={t('common.openSettings')} accessibilityHint={\`\${t('a')}: \${b}\`} /><Text>{n} · {t('x')}</Text><Text>intervals.icu:</Text><Text>{\`Z\${zone}\`}</Text></View>);`,
      })
    );

    expect(run.status).toBe(0);
  });

  it('leaves the error boundary, tests and the listed debug screens alone', () => {
    const run = runGuard(
      treeWith({
        'src/features/a/GlobalErrorBoundary.tsx': `export const A = () => <Text>Reload</Text>;`,
        'src/features/a/__tests__/A.tsx': `export const A = () => <Text>Reload</Text>;`,
      })
    );

    expect(run.status).toBe(0);
  });

  it('refuses a debug-named screen the list does not name', () => {
    const run = runGuard(
      treeWith({
        'src/features/a/KilnDebugPanel.tsx': `export const A = () => <Text>Firing log</Text>;`,
      })
    );

    expect(run.status).toBe(1);
    expect(run.output).toContain('KilnDebugPanel.tsx');
  });

  it('refuses a listed debug screen the tree no longer has', () => {
    const run = runGuard(treeWith({}, { debugScreens: DEBUG_SCREENS.slice(1) }));

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/app/debug.tsx');
  });
});
