/**
 * Scenario: a title is styled with the section or card title type role by
 * hand, so it looks like a heading and a screen reader cannot navigate to it.
 *
 * Expected behaviour: the two title roles are read in `src/shared/ui`, where
 * the title components carry the header role. Elsewhere a ratchet holds each
 * file to the reads it still has, some of which are figures rather than titles:
 * a file above its baseline fails and names itself, a file the baseline never
 * listed fails, and a file that has beaten its baseline fails with the flag to
 * write it back.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-heading-tokens.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-headings-'));
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

const TWO_TITLES = `
const styles = StyleSheet.create({
  title: { ...typography.sectionTitle },
  heading: { fontSize: typography.cardTitle.fontSize },
});
`;

describe('the heading token ratchet', () => {
  it('passes a file sitting exactly on its baseline', () => {
    const root = treeWith({ 'src/features/a/A.tsx': TWO_TITLES });

    expect(runGuard(root, { 'src/features/a/A.tsx': 2 }).status).toBe(0);
  });

  it('refuses a file that gained a hand-styled title, and names it', () => {
    const root = treeWith({ 'src/features/a/A.tsx': TWO_TITLES });
    const run = runGuard(root, { 'src/features/a/A.tsx': 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/a/A.tsx');
    expect(run.output).toContain('SectionTitle');
  });

  it('refuses a file the baseline never listed', () => {
    const root = treeWith({ 'src/app/b.tsx': TWO_TITLES });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/app/b.tsx');
  });

  it('refuses a baseline left above the tree, so a sweep cannot be undone', () => {
    const root = treeWith({ 'src/features/a/A.tsx': TWO_TITLES });
    const run = runGuard(root, { 'src/features/a/A.tsx': 5 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });

  it('counts neither the shared ui nor the tests', () => {
    const root = treeWith({
      'src/shared/ui/SectionTitle.tsx': TWO_TITLES,
      'src/__tests__/a.test.tsx': TWO_TITLES,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('leaves the other type roles alone', () => {
    const root = treeWith({
      'src/features/a/A.tsx': 'const s = { ...typography.screenTitle, ...typography.body };\n',
    });

    expect(runGuard(root, {}).status).toBe(0);
  });
});
