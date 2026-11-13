/**
 * Scenario: equal buttons share a row through a `flex: 1` style, which divides the width without
 * asking whether each share holds its label's longest word.
 *
 * Expected behaviour: a new `Button` taking a `flex: 1` style key outside `src/shared/ui` fails and
 * names the file and ButtonRow. A file below its baseline fails too, so the count only falls.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-button-row-siblings.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-button-row-'));
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
const button = (style: string) =>
  `<Button\n  label="Go"\n  onPress={() => go()}\n  style={styles.${style}}\n/>\n`;
const sheet = (key: string, body: string) =>
  `const styles = StyleSheet.create({\n  ${key}: {\n    ${body}\n  },\n});\n`;

describe('the button row sibling guard', () => {
  it('refuses a Button taking a flex: 1 style, naming the file and ButtonRow', () => {
    const run = runGuard(treeWith({ [FILE]: button('cell') + sheet('cell', 'flex: 1,') }), {});

    expect(run.status).toBe(1);
    expect(run.output).toContain(FILE);
    expect(run.output).toContain('ButtonRow');
  });

  it('counts each Button and holds a file at its baseline', () => {
    const body = button('cell') + button('cell') + sheet('cell', 'flex: 1,');
    const root = treeWith({ [FILE]: body });

    expect(runGuard(root, { [FILE]: 1 }).status).toBe(1);
    expect(runGuard(root, { [FILE]: 2 }).status).toBe(0);
  });

  it('leaves a Button whose style does not set flex: 1', () => {
    const run = runGuard(treeWith({ [FILE]: button('pad') + sheet('pad', 'padding: 4,') }), {});

    expect(run.status).toBe(0);
  });

  it('leaves src/shared/ui, where ButtonRow is built', () => {
    const run = runGuard(
      treeWith({ 'src/shared/ui/X.tsx': button('cell') + sheet('cell', 'flex: 1,') }),
      {}
    );

    expect(run.status).toBe(0);
  });

  it('refuses a file that has beaten its baseline, so the ceiling falls', () => {
    const run = runGuard(treeWith({ [FILE]: 'export const a = 1;\n' }), { [FILE]: 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('beaten');
  });
});
