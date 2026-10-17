/**
 * Scenario: a text style takes one role's size and sets a weight of its own,
 * so it drops the role's line height, tracking and figures, and two texts
 * meant to match draw at two line heights.
 *
 * Expected behaviour: a ratchet holds each file to the plucked sizes it still
 * has. A file above its baseline fails and names itself, a file the baseline
 * never listed fails, a file that has beaten its baseline fails with the flag
 * to write it back, and a spread role is never counted.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-font-size-pluck.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-pluck-'));
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

const PLUCKED = `
const styles = StyleSheet.create({
  label: { fontSize: typography.caption.fontSize, fontWeight: '600' },
  value: { fontSize: typography.statsValue.fontSize },
});
`;

const SPREAD = `
const styles = StyleSheet.create({
  label: { ...typography.captionBold, color: colors.textSecondary },
  value: { ...typography.statsValue },
});
`;

describe('the plucked font size ratchet', () => {
  it('passes a file sitting exactly on its baseline', () => {
    const root = treeWith({ 'src/features/a/A.tsx': PLUCKED });

    expect(runGuard(root, { 'src/features/a/A.tsx': 2 }).status).toBe(0);
  });

  it('refuses a file over its baseline, and names it', () => {
    const root = treeWith({ 'src/features/a/A.tsx': PLUCKED });
    const run = runGuard(root, { 'src/features/a/A.tsx': 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/a/A.tsx');
  });

  it('refuses a file the baseline never listed', () => {
    const root = treeWith({ 'src/app/b.tsx': PLUCKED });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/app/b.tsx');
  });

  it('refuses a baseline left above the tree, so a sweep cannot be undone', () => {
    const root = treeWith({ 'src/features/a/A.tsx': SPREAD });
    const run = runGuard(root, { 'src/features/a/A.tsx': 2 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });

  it('accepts a spread role in a file the baseline never listed', () => {
    const root = treeWith({ 'src/features/a/A.tsx': SPREAD });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('counts neither the theme nor the tests', () => {
    const root = treeWith({
      'src/theme/index.ts': PLUCKED,
      'src/__tests__/a.test.tsx': PLUCKED,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });
});
