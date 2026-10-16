/**
 * Scenario: icons were drawn at seventeen sizes, as literals and as file-local
 * constants, so one screen's glyph read larger than its neighbour's.
 *
 * Expected behaviour: a ratchet in the shape of the hand-rolled button guard.
 * An icon whose size is a number, a constant or a type role's font size counts
 * against its file's baseline, a size read from `iconSize` or passed through
 * from a prop does not, and a baseline the tree has beaten fails with the
 * command that lowers it.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-icon-sizes.mjs');

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-icon-sizes-'));
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

const icon = (size: string) =>
  `export const A = () => <MaterialCommunityIcons name="kennel" ${size} color={c} />;\n`;

describe('the icon size ratchet', () => {
  it.each([
    ['a literal', 'size={14}'],
    ['a literal already on the ladder', 'size={16}'],
    ['a file-local constant', 'size={GLYPH_SIZE}'],
    ['a type role read', 'size={typography.caption.fontSize}'],
    ['an expression over literals', 'size={small ? 14 : 16}'],
    ['a token read nudged by a number', 'size={iconSize.md + 2}'],
    ['no size at all', ''],
  ])('refuses %s, and names its file', (_, size) => {
    const run = runGuard(treeWith({ 'src/features/kennel/A.tsx': icon(size) }), {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/kennel/A.tsx');
  });

  it.each([
    ['a token read', 'size={iconSize.sm}'],
    ['a choice between token reads', 'size={active ? iconSize.lg : iconSize.md}'],
    ['a prop passed through', 'size={size}'],
  ])('passes %s', (_, size) => {
    expect(runGuard(treeWith({ 'src/features/kennel/A.tsx': icon(size) }), {}).status).toBe(0);
  });

  it('counts a size given to a shared wrapper that draws an icon', () => {
    const root = treeWith({
      'src/features/kennel/B.tsx':
        'export const B = () => <DisclosureChevron expanded size={18} />;\n',
    });

    expect(runGuard(root, {}).status).toBe(1);
  });

  it('passes a wrapper left at its own default size', () => {
    const root = treeWith({
      'src/features/kennel/B.tsx': 'export const B = () => <DirectionArrow direction={d} />;\n',
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('passes a file sitting exactly on its baseline', () => {
    const root = treeWith({ 'src/features/kennel/A.tsx': icon('size={14}') });

    expect(runGuard(root, { 'src/features/kennel/A.tsx': 1 }).status).toBe(0);
  });

  it('refuses a baseline left above the tree, so a sweep cannot be undone', () => {
    const root = treeWith({ 'src/features/kennel/A.tsx': icon('size={iconSize.sm}') });
    const run = runGuard(root, { 'src/features/kennel/A.tsx': 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });

  it('does not count tests', () => {
    const root = treeWith({ 'src/__tests__/a.test.tsx': icon('size={14}') });

    expect(runGuard(root, {}).status).toBe(0);
  });
});
