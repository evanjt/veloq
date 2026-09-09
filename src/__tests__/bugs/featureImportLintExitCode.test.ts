/**
 * Scenario: the cross-feature import ratchet runs in `npm run audit`.
 *
 * Expected behaviour: `src/features/CLAUDE.md` says a cross-feature import goes
 * through the barrel, `@/features/maps`, never a deep path. Most of the tree
 * still breaks that, so the lint holds a per-edge baseline instead of demanding
 * zero. A deep import above its edge's baseline fails, one on an edge the
 * baseline never listed fails, and an edge the tree has already beaten fails
 * with the number to paste back, or the ratchet stalls at its seed. A barrel
 * import, a feature reaching into itself and a test file are not counted.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-feature-imports.mjs');

function runLint(root?: string, ...flags: string[]): { status: number; output: string } {
  const args = root ? [SCRIPT, '--root', root, ...flags] : [SCRIPT, ...flags];
  try {
    const output = execFileSync('node', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('cross-feature import ratchet', () => {
  const roots: string[] = [];

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  // A fixture tree. Paths are repository relative, so a baseline written here
  // is read the same way the real one is.
  const withTree = (files: Record<string, string>): string => {
    const root = mkdtempSync(join(tmpdir(), 'feature-imports-'));
    roots.push(root);
    for (const [path, body] of Object.entries(files)) {
      const full = join(root, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, body);
    }
    return root;
  };

  const baselineIn = (root: string, edges: Record<string, number>): string => {
    const path = join(root, 'baseline.json');
    writeFileSync(path, `${JSON.stringify(edges, null, 2)}\n`);
    return path;
  };

  it('exits 0 on this repo, so the audit gate stays usable', () => {
    expect(runLint().status).toBe(0);
  });

  it('fails a deep import on an edge the baseline does not list', () => {
    const root = withTree({
      'src/features/a/x.ts': "import { y } from '@/features/b/lib/y';\nexport const x = y;\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('a -> b  1, baseline 0');
    expect(output).toContain('src/features/a/x.ts:1  a -> b  @/features/b/lib/y');
  });

  it('names a target feature that has no barrel to import instead', () => {
    // activity, maps and settings were deleted as dead barrels while every
    // importer was already deep. Telling someone to use a barrel that is not
    // there is the rule naming a path that does not exist.
    const root = withTree({
      'src/features/a/x.ts': "import { y } from '@/features/b/lib/y';\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
      'src/features/c/index.ts': 'export const z = 1;\n',
    });
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('No barrel exists yet for: b');
    expect(output).not.toContain('for: c');
  });

  it('fails one deep import more than the edge is allowed', () => {
    const root = withTree({
      'src/features/a/x.ts': "import { y } from '@/features/b/lib/y';\n",
      'src/features/a/z.ts': "import { w } from '@/features/b/lib/w';\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    const { status, output } = runLint(root, '--baseline', baselineIn(root, { 'a -> b': 1 }));
    expect(status).toBe(1);
    expect(output).toContain('a -> b  2, baseline 1');
  });

  it('passes an edge sitting exactly on its baseline', () => {
    const root = withTree({
      'src/features/a/x.ts': "import { y } from '@/features/b/lib/y';\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    const { status, output } = runLint(root, '--baseline', baselineIn(root, { 'a -> b': 1 }));
    expect(status).toBe(0);
    expect(output).toContain('lint-feature-imports: OK');
  });

  it('fails an edge the tree has already beaten, and prints the number to paste', () => {
    const root = withTree({
      'src/features/a/x.ts': "import { y } from '@/features/b/lib/y';\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    const { status, output } = runLint(root, '--baseline', baselineIn(root, { 'a -> b': 3 }));
    expect(status).toBe(1);
    expect(output).toContain('a -> b  1, baseline 3');
  });

  it('fails a baseline edge the tree no longer has at all', () => {
    const root = withTree({
      'src/features/a/x.ts': 'export const x = 1;\n',
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    const { status, output } = runLint(root, '--baseline', baselineIn(root, { 'a -> b': 2 }));
    expect(status).toBe(1);
    expect(output).toContain('a -> b  0, baseline 2');
  });

  it('ignores a baseline edge whose features are not in the tree at all', () => {
    const root = withTree({ 'src/features/a/x.ts': 'export const x = 1;\n' });
    expect(runLint(root, '--baseline', baselineIn(root, { 'routes -> maps': 22 })).status).toBe(0);
  });

  it('passes a barrel import, spelled bare or through index', () => {
    const root = withTree({
      'src/features/a/x.ts':
        "import { y } from '@/features/b';\nimport { z } from '@/features/c/index';\n",
      'src/features/b/index.ts': 'export const y = 1;\n',
      'src/features/c/index.ts': 'export const z = 1;\n',
    });
    const { status, output } = runLint(root);
    expect(status).toBe(0);
    expect(output).toContain('2 barrel');
  });

  it('passes a feature reaching into itself by its own alias path', () => {
    const root = withTree({
      'src/features/a/x.ts': "import { y } from '@/features/a/lib/y';\n",
      'src/features/a/lib/y.ts': 'export const y = 1;\n',
    });
    expect(runLint(root).status).toBe(0);
  });

  it('counts a relative cross-feature import as deep', () => {
    const root = withTree({
      'src/features/a/components/x.ts': "import { y } from '../../b/lib/y';\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('a -> b  1, baseline 0');
  });

  it('counts a deep import from src/app under the ~app owner', () => {
    const root = withTree({
      'src/app/(tabs)/index.tsx': "import { y } from '@/features/b/lib/y';\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('~app -> b  1, baseline 0');
  });

  it('counts a re-export and a dynamic import, which reach as far as an import', () => {
    const root = withTree({
      'src/features/a/x.ts': "export { y } from '@/features/b/lib/y';\n",
      'src/features/a/z.ts': "export const z = () => import('@/features/b/lib/w');\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    const { status, output } = runLint(root);
    expect(status).toBe(1);
    expect(output).toContain('a -> b  2, baseline 0');
  });

  it('does not count a specifier that only appears in a comment or a string', () => {
    const root = withTree({
      'src/features/a/x.ts':
        "// Was: import { y } from '@/features/b/lib/y';\nexport const doc = \"from '@/features/b/lib/y'\";\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    expect(runLint(root).status).toBe(0);
  });

  it('does not scan tests, which are allowed to reach anywhere', () => {
    const root = withTree({
      'src/features/a/x.test.ts': "import { y } from '@/features/b/lib/y';\n",
      'src/features/a/__tests__/deep.ts': "import { y } from '@/features/b/lib/y';\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    expect(runLint(root).status).toBe(0);
  });

  it('prints the current counts as the baseline file wants them', () => {
    const root = withTree({
      'src/features/a/x.ts': "import { y } from '@/features/b/lib/y';\n",
      'src/features/b/lib/y.ts': 'export const y = 1;\n',
    });
    const { status, output } = runLint(root, '--json');
    expect(status).toBe(0);
    expect(JSON.parse(output)).toEqual({ 'a -> b': 1 });
  });
});
