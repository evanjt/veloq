/**
 * Scenario: a sheet that returns a choice is a formSheet route under
 * `src/app/sheets/`, and a hand-built react-native `Modal` is how a new one
 * slips in beside it during a conversion sweep.
 *
 * Expected behaviour: a file rendering `<Modal` that the baseline does not list
 * fails and is named, with a pointer at the sheets directory. A baseline entry
 * whose file no longer renders one fails as stale, so each conversion deletes
 * its own line and the list only shrinks.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-modal-sheets.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-modals-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return root;
}

function runGuard(root: string, baseline: Record<string, string>) {
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

const SHEET = `
import { Modal } from 'react-native';
export const A = () => (
  <Modal transparent animationType="slide">
    <View />
  </Modal>
);
`;

const FILE = 'src/features/a/A.tsx';

describe('the Modal sheet guard', () => {
  it('refuses a Modal sheet in a file outside the baseline, naming it and the sheets directory', () => {
    const root = treeWith({ [FILE]: SHEET });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain(FILE);
    expect(run.output).toContain('src/app/sheets/');
  });

  it('passes the same file once the baseline lists it with a reason', () => {
    const root = treeWith({ [FILE]: SHEET });

    expect(runGuard(root, { [FILE]: 'converting' }).status).toBe(0);
  });

  it('refuses a baseline entry whose file no longer renders a Modal, and names it', () => {
    const root = treeWith({ [FILE]: 'export const A = () => null;\n' });
    const run = runGuard(root, { [FILE]: 'converting' });

    expect(run.status).toBe(1);
    expect(run.output).toContain(FILE);
    expect(run.output).toContain('stale');
  });

  it('refuses a baseline entry whose file is gone', () => {
    const root = treeWith({ 'src/features/a/B.tsx': 'export const B = 1;\n' });

    expect(runGuard(root, { [FILE]: 'converting' }).status).toBe(1);
  });

  it('refuses a baseline entry with no reason', () => {
    const root = treeWith({ [FILE]: SHEET });
    const run = runGuard(root, { [FILE]: '  ' });

    expect(run.status).toBe(1);
    expect(run.output).toContain(FILE);
  });

  it('passes a tree with no Modal and an empty baseline', () => {
    const root = treeWith({ [FILE]: 'export const A = () => null;\n' });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('matches a Modal opening tag split across lines and a self-closing one', () => {
    const multiline = treeWith({ [FILE]: 'export const A = <Modal\n  visible\n/>;\n' });
    const selfClosing = treeWith({ [FILE]: 'export const A = <Modal />;\n' });

    expect(runGuard(multiline, {}).status).toBe(1);
    expect(runGuard(selfClosing, {}).status).toBe(1);
  });

  it('does not read a component whose name merely starts with Modal', () => {
    const root = treeWith({ [FILE]: 'export const A = () => <ModalHeader />;\n' });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('counts a file under the test tree for nothing', () => {
    const root = treeWith({ 'src/__tests__/a.test.tsx': SHEET });

    expect(runGuard(root, {}).status).toBe(0);
  });
});
