/**
 * Scenario: the two floor styles, `pillLabel` at 9px and `micro` at 10px, are
 * for one or two words, and a sentence set at either is the line a reader
 * cannot read at the largest text size.
 *
 * Expected behaviour: a ratchet holds each file to the floor-style reads it
 * still has. A file above its baseline fails and names itself, a file the
 * baseline never listed fails, a file that has beaten its baseline fails with
 * the flag to write it back, and the theme and the tests are never counted.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-floor-type-styles.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-floor-'));
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

const FLOOR = `
const styles = StyleSheet.create({
  tick: { ...typography.micro, color: colors.textSecondary },
  badge: { fontSize: typography.pillLabel.fontSize - 1 },
});
`;

const CAPTION = `
const styles = StyleSheet.create({
  note: { ...typography.caption, color: colors.textSecondary },
  microscope: { ...typography.microscopeTitle },
});
`;

describe('the floor type style ratchet', () => {
  it('passes a file sitting exactly on its baseline', () => {
    const root = treeWith({ 'src/features/a/A.tsx': FLOOR });

    expect(runGuard(root, { 'src/features/a/A.tsx': 2 }).status).toBe(0);
  });

  it('refuses a file over its baseline, and names it', () => {
    const root = treeWith({ 'src/features/a/A.tsx': FLOOR });
    const run = runGuard(root, { 'src/features/a/A.tsx': 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/a/A.tsx');
  });

  it('refuses a file the baseline never listed', () => {
    const root = treeWith({ 'src/app/b.tsx': FLOOR });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/app/b.tsx');
  });

  it('refuses a baseline left above the tree, so a sweep cannot be undone', () => {
    const root = treeWith({ 'src/features/a/A.tsx': CAPTION });
    const run = runGuard(root, { 'src/features/a/A.tsx': 2 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });

  it('accepts a larger role, and a role whose name only starts with a floor name', () => {
    const root = treeWith({ 'src/features/a/A.tsx': CAPTION });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('counts neither the theme nor the tests', () => {
    const root = treeWith({
      'src/theme/typography.ts': FLOOR,
      'src/__tests__/a.test.tsx': FLOOR,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });
});
