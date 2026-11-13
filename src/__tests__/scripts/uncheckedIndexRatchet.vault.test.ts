/**
 * Scenario: `noUncheckedIndexedAccess` is right that `array[i]` can be
 * `undefined`, but turning it on raises hundreds of errors at once, most of them
 * an index the compiler cannot see is in range.
 *
 * Expected behaviour: a ratchet per directory. A directory above its baseline
 * fails and names itself, a directory the baseline never listed fails, and a
 * directory the tree has already beaten fails with the command to write it
 * back. Tests and generated files are not counted, and a compiler run that
 * produced no per-file errors cannot pass as a clean tree.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-unchecked-index.mjs');

const TSCONFIG = JSON.stringify({
  compilerOptions: { strict: true, noEmit: true, target: 'ES2022', types: [] },
  include: ['src/**/*.ts'],
});

const ONE_UNCHECKED = `
export const firstLength = (xs: string[]): number => xs[0].length;
`;

const CHECKED = `
export const firstLength = (xs: string[]): number => xs[0]?.length ?? 0;
`;

function treeWith(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-unchecked-'));
  for (const [rel, body] of Object.entries({ 'tsconfig.json': TSCONFIG, ...files })) {
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

describe('the unchecked index ratchet', () => {
  it('passes a directory sitting exactly on its baseline', () => {
    const root = treeWith({ 'src/features/a/a.ts': ONE_UNCHECKED });

    expect(runGuard(root, { 'src/features/a': 1 }).status).toBe(0);
  });

  it('refuses a directory that gained an unchecked index access, and names it', () => {
    const root = treeWith({
      'src/features/a/a.ts': ONE_UNCHECKED,
      'src/features/a/b.ts': ONE_UNCHECKED,
    });
    const run = runGuard(root, { 'src/features/a': 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/a  2, baseline 1');
  });

  it('refuses a directory the baseline never listed', () => {
    const root = treeWith({ 'src/features/b/a.ts': ONE_UNCHECKED });
    const run = runGuard(root, {});

    expect(run.status).toBe(1);
    expect(run.output).toContain('src/features/b  1, baseline 0');
  });

  it('refuses a baseline left above the tree, so a fix cannot be undone', () => {
    const root = treeWith({ 'src/features/a/a.ts': CHECKED });
    const run = runGuard(root, { 'src/features/a': 1 });

    expect(run.status).toBe(1);
    expect(run.output).toContain('--write');
  });

  it('counts neither tests nor generated files', () => {
    const root = treeWith({
      'src/__tests__/a.test.ts': ONE_UNCHECKED,
      'src/features/a/a.test.ts': ONE_UNCHECKED,
      'src/features/a/__mocks__/a.ts': ONE_UNCHECKED,
      'src/generated/bindings.ts': ONE_UNCHECKED,
      'src/features/a/table.generated.ts': ONE_UNCHECKED,
    });

    expect(runGuard(root, {}).status).toBe(0);
  });

  it('does not count an error the compiler reports without the flag', () => {
    const root = treeWith({
      'src/features/a/a.ts': ONE_UNCHECKED,
      'src/features/a/wrong.ts': 'export const n: number = "text";\n',
    });

    expect(runGuard(root, { 'src/features/a': 1 }).status).toBe(0);
  });

  it('writes the baseline the tree carries', () => {
    const root = treeWith({
      'src/features/a/a.ts': ONE_UNCHECKED,
      'src/features/a/__tests__/a.test.ts': ONE_UNCHECKED,
    });
    const baselineFile = path.join(root, 'baseline.json');
    execFileSync('node', [GUARD, '--root', root, '--baseline', baselineFile, '--write']);

    expect(JSON.parse(fs.readFileSync(baselineFile, 'utf8'))).toEqual({ 'src/features/a': 1 });
    expect(runGuard(root, { 'src/features/a': 1 }).status).toBe(0);
  });

  it('fails when the compiler reports an error that names no file', () => {
    const root = treeWith({ 'src/features/a/a.ts': CHECKED });
    fs.writeFileSync(
      path.join(root, 'tsconfig.json'),
      '{ "compilerOptions": { "target": "ES1" } }'
    );
    const run = runGuard(root, {});

    expect(run.status).toBe(2);
    expect(run.output).toContain('error TS');
  });
});
