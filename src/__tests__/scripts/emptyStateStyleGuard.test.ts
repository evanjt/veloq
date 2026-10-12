/**
 * Scenario: a card or a chart draws its own empty line under a local style key
 * beside the shared EmptyState, which is how two dozen of them came to read at
 * different sizes.
 *
 * Expected behaviour: a new `emptyText`, `emptyHint`, `emptyContainer`,
 * `emptyTitle` or `emptySubtitle` key outside `src/shared/ui` fails and is
 * named. A file below its baseline fails too, so the count only falls.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-empty-state-styles.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-empty-styles-'));
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

const styles = (...keys: string[]) =>
  `const styles = StyleSheet.create({\n${keys.map((k) => `  ${k}: {\n    flex: 1,\n  },\n`).join('')}});\n`;

const FILE = 'src/features/a/A.tsx';

describe('the empty state style guard', () => {
  it.each(['emptyText', 'emptyHint', 'emptyContainer', 'emptyTitle', 'emptySubtitle'])(
    'refuses a new %s key, naming the file and the shared component',
    (key) => {
      const run = runGuard(treeWith({ [FILE]: styles(key) }), {});

      expect(run.status).toBe(1);
      expect(run.output).toContain(FILE);
      expect(run.output).toContain('EmptyState');
    }
  );

  it('counts a suffixed key such as a dark twin', () => {
    const root = treeWith({ [FILE]: styles('emptyText', 'emptyTextDark') });

    expect(runGuard(root, { [FILE]: 1 }).status).toBe(1);
    expect(runGuard(root, { [FILE]: 2 }).status).toBe(0);
  });

  it('refuses a file that has beaten its baseline, so the ceiling falls', () => {
    const run = runGuard(treeWith({ [FILE]: styles('emptyText') }), { [FILE]: 2 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('beaten');
  });

  it('refuses a baseline entry whose file carries none', () => {
    const root = treeWith({ [FILE]: 'export const A = () => null;\n' });

    expect(runGuard(root, { [FILE]: 1 }).status).toBe(1);
  });

  it('passes a key that merely starts with empty', () => {
    const root = treeWith({ [FILE]: styles('emptyList', 'emptyState') });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('counts nothing under src/shared/ui or the tests', () => {
    const root = treeWith({
      'src/shared/ui/EmptyState.tsx': styles('emptyText'),
      'src/__tests__/a.test.tsx': styles('emptyText'),
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('passes a style used in place, not opened as a key', () => {
    const root = treeWith({ [FILE]: 'export const A = <Text style={styles.emptyText} />;\n' });

    expect(runGuard(root, {}).status).toBe(0);
  });
});
