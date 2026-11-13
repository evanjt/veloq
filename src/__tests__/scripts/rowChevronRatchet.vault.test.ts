/**
 * Scenario: rows built beside the shared Row drew their own chevron at three
 * sizes or typed a '›' after the label, and an action row wore the chevron
 * that promises another screen.
 *
 * Expected behaviour: a ratchet in the shape of the hand-rolled button guard.
 * A chevron or '›' under `src/app` or `src/features` above a file's baseline
 * fails and names the file, a file the baseline never listed fails, a baseline
 * the tree has beaten fails with the command that lowers it, and the shared
 * Row itself is not counted.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-row-chevrons.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-chevrons-'));
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

const OWN_CHEVRON = `
export const A = () => <Icon name="chevron-right" size={24} />;
`;
const TYPED_ARROW = "export const B = () => <Text>{t('kennels')} ›</Text>;\n";

describe('the row chevron ratchet', () => {
  it('passes a file sitting exactly on its baseline', () => {
    const root = treeWith({ 'src/features/kennel/A.tsx': OWN_CHEVRON });

    expect(runGuard(root, { 'src/features/kennel/A.tsx': 1 }).status).toBe(0);
  });

  it('refuses a new chevron outside the shared Row, and names its file', () => {
    const root = treeWith({ 'src/app/kennel.tsx': OWN_CHEVRON });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/app/kennel.tsx');
  });

  it('refuses a label followed by a typed arrow', () => {
    const root = treeWith({ 'src/features/kennel/B.tsx': TYPED_ARROW });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/kennel/B.tsx');
  });

  it('counts a chevron named in single quotes too', () => {
    const root = treeWith({
      'src/features/kennel/C.tsx': "const glyph = open ? 'chevron-down' : 'chevron-right';\n",
    });

    expect(runGuard(root, {}).status).toBe(1);
  });

  it('refuses a baseline left above the tree, so a sweep cannot be undone', () => {
    const root = treeWith({ 'src/features/kennel/A.tsx': OWN_CHEVRON });
    const run = runGuard(root, { 'src/features/kennel/A.tsx': 3 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });

  it('counts neither the shared Row nor anything outside the app and features', () => {
    const root = treeWith({
      'src/shared/ui/Row.tsx': OWN_CHEVRON,
      'src/shared/app/Banner.tsx': OWN_CHEVRON,
      'src/__tests__/a.test.tsx': OWN_CHEVRON,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });
});
