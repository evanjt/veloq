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
 *
 * A `require()` inside a function is a deliberate deferral, so it may stay on its
 * deep path when a permitted-list entry names its file and specifier and gives
 * the reason. An unlisted one counts like an import, and so does a module-scope
 * `require()`.
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

  describe('light entry', () => {
    it('passes an import of another feature light entry with no baseline', () => {
      const root = withTree({
        'src/features/a/x.ts': "import { y } from '@/features/b/light';\nexport const x = y;\n",
        'src/features/b/light.ts': "export { y } from './lib/y';\n",
        'src/features/b/lib/y.ts': 'export const y = 1;\n',
      });
      const { status, output } = runLint(root);
      expect(status).toBe(0);
      expect(output).toContain('1 barrel');
    });

    it('passes a relative import of a light entry', () => {
      const root = withTree({
        'src/features/a/components/x.ts': "import { y } from '../../b/light';\n",
        'src/features/b/light.ts': "export { y } from './lib/y';\n",
        'src/features/b/lib/y.ts': 'export const y = 1;\n',
      });
      const { status, output } = runLint(root);
      expect(status).toBe(0);
      expect(output).toContain('1 barrel');
    });

    it('still counts a light.ts below the feature root as deep', () => {
      const root = withTree({
        'src/features/a/x.ts': "import { y } from '@/features/b/lib/light';\n",
        'src/features/b/lib/light.ts': 'export const y = 1;\n',
      });
      const { status, output } = runLint(root);
      expect(status).toBe(1);
      expect(output).toContain('a -> b  1, baseline 0');
    });

    it.each([
      ['export *', "export * from './lib/y';\n", 'export *'],
      [
        'a component import',
        "import { Thing } from './components/Thing';\nexport { Thing };\n",
        'components',
      ],
      ['a component re-export', "export { Thing } from './components/Thing';\n", 'components'],
      [
        'a component alias import',
        "export { Thing } from '@/features/b/components/Thing';\n",
        'components',
      ],
      ['its own index', "export { y } from './index';\n", 'index'],
      ['its own bare barrel', "export { y } from '@/features/b';\n", 'index'],
    ])('fails a light entry with %s, naming the file', (_label, body, reason) => {
      const root = withTree({
        'src/features/b/light.ts': body,
        'src/features/b/lib/y.ts': 'export const y = 1;\n',
        'src/features/b/components/Thing.tsx': 'export const Thing = 1;\n',
      });
      const { status, output } = runLint(root);
      expect(status).toBe(1);
      expect(output).toContain('src/features/b/light.ts');
      expect(output).toContain(reason);
    });

    it('allows a light entry to reach another feature through its barrel', () => {
      const root = withTree({
        'src/features/b/light.ts': "export { z } from '@/features/c';\n",
        'src/features/c/index.ts': 'export const z = 1;\n',
      });
      expect(runLint(root).status).toBe(0);
    });
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
  describe('permitted lazy requires', () => {
    const lazyIn = (root: string, entries: unknown): string => {
      const path = join(root, 'lazy.json');
      writeFileSync(path, `${JSON.stringify(entries, null, 2)}\n`);
      return path;
    };

    const lazyTree = (extra: Record<string, string> = {}): string =>
      withTree({
        'src/features/a/x.ts': "export const load = () => require('@/features/b/lib/y').y;\n",
        'src/features/b/lib/y.ts': 'export const y = 1;\n',
        ...extra,
      });

    const entry = (over: Record<string, unknown> = {}) => ({
      file: 'src/features/a/x.ts',
      spec: '@/features/b/lib/y',
      reason: 'b loads a native module a headless task must not start',
      ...over,
    });

    it('counts an unlisted function-scope require as a deep import', () => {
      const { status, output } = runLint(lazyTree());
      expect(status).toBe(1);
      expect(output).toContain('a -> b  1, baseline 0');
    });

    it('does not count a function-scope require the list permits', () => {
      const root = lazyTree();
      const { status, output } = runLint(root, '--lazy', lazyIn(root, [entry()]));
      expect(status).toBe(0);
      expect(output).toContain('1 lazy require(s) permitted');
      expect(output).toContain('0 deep');
    });

    it('permits a require inside a method and a nested arrow function', () => {
      const root = withTree({
        'src/features/a/x.ts':
          "export class K { m() { return () => require('@/features/b/lib/y'); } }\n",
        'src/features/b/lib/y.ts': 'export const y = 1;\n',
      });
      expect(runLint(root, '--lazy', lazyIn(root, [entry()])).status).toBe(0);
    });

    it('lets a listed require cover only its own specifier', () => {
      const root = lazyTree({
        'src/features/a/z.ts': "export const f = () => require('@/features/b/lib/w');\n",
      });
      const { status, output } = runLint(root, '--lazy', lazyIn(root, [entry()]));
      expect(status).toBe(1);
      expect(output).toContain('a -> b  1, baseline 0');
      expect(output).toContain('src/features/a/z.ts:1');
    });

    it('lets a listed require cover only its own file', () => {
      const root = lazyTree({
        'src/features/a/z.ts': "export const f = () => require('@/features/b/lib/y');\n",
      });
      const { status, output } = runLint(root, '--lazy', lazyIn(root, [entry()]));
      expect(status).toBe(1);
      expect(output).toContain('src/features/a/z.ts:1');
      expect(output).not.toContain('src/features/a/x.ts:1');
    });

    it('does not let an entry cover a module-scope require', () => {
      const root = withTree({
        'src/features/a/x.ts': "export const y = require('@/features/b/lib/y').y;\n",
        'src/features/b/lib/y.ts': 'export const y = 1;\n',
      });
      const lazy = lazyIn(root, [entry()]);
      expect(JSON.parse(runLint(root, '--lazy', lazy, '--json').output)).toEqual({ 'a -> b': 1 });
      const { status, output } = runLint(root, '--lazy', lazy);
      expect(status).toBe(1);
      expect(output).toContain('matches no function-scope require');
    });

    it('does not let an entry cover a static or dynamic import', () => {
      const root = withTree({
        'src/features/a/x.ts':
          "import { y } from '@/features/b/lib/y';\nexport const load = () => import('@/features/b/lib/y');\n",
        'src/features/b/lib/y.ts': 'export const y = 1;\n',
      });
      const lazy = lazyIn(root, [entry()]);
      expect(JSON.parse(runLint(root, '--lazy', lazy, '--json').output)).toEqual({ 'a -> b': 2 });
      const { status, output } = runLint(root, '--lazy', lazy);
      expect(status).toBe(1);
      expect(output).toContain('matches no function-scope require');
    });

    it('fails an entry that gives no reason', () => {
      const root = lazyTree();
      for (const reason of [undefined, '', '   ']) {
        const { status, output } = runLint(root, '--lazy', lazyIn(root, [entry({ reason })]));
        expect(status).toBe(1);
        expect(output).toContain('no reason');
        expect(output).toContain('src/features/a/x.ts  @/features/b/lib/y');
      }
    });

    it('fails an entry that no longer matches a function-scope require', () => {
      const root = withTree({
        'src/features/a/x.ts': 'export const x = 1;\n',
        'src/features/b/lib/y.ts': 'export const y = 1;\n',
      });
      const { status, output } = runLint(root, '--lazy', lazyIn(root, [entry()]));
      expect(status).toBe(1);
      expect(output).toContain('matches no function-scope require');
    });

    it('ignores an entry whose file is not in the tree at all', () => {
      const root = withTree({ 'src/features/a/x.ts': 'export const x = 1;\n' });
      expect(
        runLint(root, '--lazy', lazyIn(root, [entry({ file: 'src/features/q/gone.ts' })])).status
      ).toBe(0);
    });

    it('fails an entry whose file also imports the same feature at module scope', () => {
      const root = lazyTree({
        'src/features/a/x.ts':
          "import { w } from '@/features/b/lib/w';\nexport const load = () => require('@/features/b/lib/y').y + w;\n",
        'src/features/b/lib/w.ts': 'export const w = 1;\n',
      });
      const { status, output } = runLint(root, '--lazy', lazyIn(root, [entry()]));
      expect(status).toBe(1);
      expect(output).toContain('also imports b at module scope');
    });

    it('still permits an entry when the module-scope import is of another feature', () => {
      const root = withTree({
        'src/features/a/x.ts':
          "import { w } from '@/features/c';\nexport const load = () => require('@/features/b/lib/y').y + w;\n",
        'src/features/b/lib/y.ts': 'export const y = 1;\n',
        'src/features/c/index.ts': 'export const w = 1;\n',
      });
      expect(runLint(root, '--lazy', lazyIn(root, [entry()])).status).toBe(0);
    });

    it('permits a lazy require alongside a baseline edge without lending it ground', () => {
      const root = lazyTree({
        'src/features/a/z.ts': "import { w } from '@/features/b/lib/w';\n",
        'src/features/b/lib/w.ts': 'export const w = 1;\n',
      });
      const baseline = baselineIn(root, { 'a -> b': 1 });
      const lazy = lazyIn(root, [entry()]);
      expect(runLint(root, '--baseline', baseline, '--lazy', lazy).status).toBe(0);
      // Listing the require must not leave the edge looking beaten at 2.
      const loose = baselineIn(root, { 'a -> b': 2 });
      const { status, output } = runLint(root, '--baseline', loose, '--lazy', lazy);
      expect(status).toBe(1);
      expect(output).toContain('a -> b  1, baseline 2');
    });

    it('reports a malformed list instead of passing', () => {
      const root = lazyTree();
      const { status, output } = runLint(root, '--lazy', lazyIn(root, { not: 'a list' }));
      expect(status).toBe(1);
      expect(output).toContain('must be a JSON array');
    });
  });
});
