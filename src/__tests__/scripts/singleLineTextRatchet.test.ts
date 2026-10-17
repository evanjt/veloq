/**
 * Scenario: a Text held to one line ends a number or a name in an ellipsis at
 * a narrow width or a large text size, so a time reads as a different time and
 * two names that differ only at the end read as one.
 *
 * Expected behaviour: a ratchet in the shape of the row chevron guard. A
 * `numberOfLines={1}` anywhere under `src` above a file's baseline fails and
 * names the file, a file the baseline never listed fails, a baseline the tree
 * has beaten fails with the command that lowers it, and the two owners that set
 * the limit for their callers are not counted.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-single-line-text.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-single-line-'));
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

const ONE_LINE = 'export const A = () => <Text numberOfLines={1}>{kennel.name}</Text>;\n';

describe('the single-line text ratchet', () => {
  it('passes a file sitting exactly on its baseline', () => {
    const root = treeWith({ 'src/features/kennel/A.tsx': ONE_LINE });

    expect(runGuard(root, { 'src/features/kennel/A.tsx': 1 }).status).toBe(0);
  });

  it('refuses a new single-line Text, and names its file', () => {
    const root = treeWith({ 'src/app/kennel.tsx': ONE_LINE });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/app/kennel.tsx');
  });

  it('counts the shared ui too, and a limit written with spaces', () => {
    const root = treeWith({
      'src/shared/ui/Kennel.tsx': 'export const K = <Text numberOfLines={ 1 }>x</Text>;\n',
    });

    expect(runGuard(root, {}).status).toBe(1);
  });

  it('does not count a two-line limit', () => {
    const root = treeWith({
      'src/features/kennel/B.tsx': 'export const B = <Text numberOfLines={2}>x</Text>;\n',
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('refuses a baseline left above the tree, so a sweep cannot be undone', () => {
    const root = treeWith({ 'src/features/kennel/A.tsx': ONE_LINE });
    const run = runGuard(root, { 'src/features/kennel/A.tsx': 3 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });

  it('counts neither the two owners nor the tests', () => {
    const root = treeWith({
      'src/shared/ui/FitText.tsx': ONE_LINE,
      'src/shared/ui/NameText.tsx': ONE_LINE,
      'src/__tests__/a.test.tsx': ONE_LINE,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });
});
