/**
 * Scenario: the front end is moving to one screen read per screen, so the count
 * of files reaching the engine directly, and the count of stores, should only
 * fall. Nothing enforced that, so a feature fix could add a call site and pass
 * every gate.
 *
 * Expected behaviour: the guard counts both against ceilings the npm script
 * carries, refuses a rise and names the files, and refuses a ceiling left above
 * the tree so ground a sweep took is not given back.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const REPO = path.resolve(__dirname, '../../..');
const GUARD = path.join(REPO, 'scripts/lint-engine-surface.mjs');

interface Tree {
  [relativePath: string]: string;
}

function write(root: string, rel: string, body: string) {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function treeWith(files: Tree) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-engine-surface-'));
  for (const [rel, body] of Object.entries(files)) write(root, rel, body);
  return root;
}

function runGuard(root: string, engineCeiling: number, storeCeiling: number) {
  const args = [
    GUARD,
    '--root',
    root,
    '--engine-ceiling',
    String(engineCeiling),
    '--store-ceiling',
    String(storeCeiling),
  ];
  try {
    return { code: 0, out: execFileSync('node', args, { encoding: 'utf8', env: gitFreeEnv() }) };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const IMPORTS_ENGINE = "import { getEngine } from '@/shared/native/engine';\n";
const REQUIRES_ENGINE = "const { getEngine } = require('@/shared/native/engine');\n";

describe('the engine call site ceiling', () => {
  it('passes when the tree sits on the ceiling', () => {
    const root = treeWith({ 'src/features/a/useA.ts': IMPORTS_ENGINE });

    expect(runGuard(root, 1, 0).code).toBe(0);
  });

  it('refuses a call site over the ceiling and names the file', () => {
    const root = treeWith({
      'src/features/a/useA.ts': IMPORTS_ENGINE,
      'src/features/b/useB.ts': IMPORTS_ENGINE,
    });

    const { code, out } = runGuard(root, 1, 0);
    expect(code).toBe(1);
    expect(out).toContain('src/features/b/useB.ts');
  });

  it('counts a require as a call site, since it reaches the same module', () => {
    const root = treeWith({ 'src/features/a/RouteSettingsStore.ts': REQUIRES_ENGINE });

    expect(runGuard(root, 0, 1).code).toBe(1);
  });

  it('spares the shared engine layer, which is where the module belongs', () => {
    const root = treeWith({ 'src/shared/native/useEngineReady.ts': IMPORTS_ENGINE });

    expect(runGuard(root, 0, 0).code).toBe(0);
  });

  it('spares the tests, which mock the module rather than reaching it', () => {
    const root = treeWith({ 'src/__tests__/hooks/a.test.ts': IMPORTS_ENGINE });

    expect(runGuard(root, 0, 0).code).toBe(0);
  });

  it('refuses a ceiling the tree has already beaten, so the ground is kept', () => {
    const root = treeWith({ 'src/features/a/useA.ts': IMPORTS_ENGINE });

    const { code, out } = runGuard(root, 4, 0);
    expect(code).toBe(1);
    expect(out).toContain('4');
    expect(out).toContain('1');
  });
});

describe('the store ceiling', () => {
  it('counts every file whose name ends in Store.ts, wherever it sits', () => {
    const root = treeWith({
      'src/shared/app/AuthStore.ts': 'export const a = 1;\n',
      'src/features/insights/lib/fingerprintStore.ts': 'export const b = 2;\n',
    });

    expect(runGuard(root, 0, 2).code).toBe(0);
    const { code, out } = runGuard(root, 0, 1);
    expect(code).toBe(1);
    expect(out).toContain('fingerprintStore.ts');
  });

  it('does not count a store under the tests', () => {
    const root = treeWith({ 'src/__tests__/providers/FakeStore.ts': 'export const a = 1;\n' });

    expect(runGuard(root, 0, 0).code).toBe(0);
  });
});

describe('a checkout, where the index is the tree being committed', () => {
  function checkoutWith(files: Tree) {
    const root = treeWith(files);
    // `runGit`, never a bare `execFileSync`: git exports `GIT_DIR`,
    // `GIT_INDEX_FILE` and `GIT_WORK_TREE` to everything a hook runs and they
    // beat `cwd`, so the `git add -A` below wrote the repository's own index
    // when the suite ran from `pre-merge-commit` (B1068).
    const git = (...args: string[]) => runGit(args, root);
    git('init', '-q');
    git('config', 'user.email', 'guard@test');
    git('config', 'user.name', 'Guard');
    git('add', '-A');
    return { root, git };
  }

  it('counts the staged call site and not the one only on disk', () => {
    const { root } = checkoutWith({ 'src/features/a/useA.ts': IMPORTS_ENGINE });
    // Another session's unsaved file must not fail a merge that never touched
    // it, which is what a whole-tree total does.
    write(root, 'src/features/b/useB.ts', IMPORTS_ENGINE);

    expect(runGuard(root, 1, 0).code).toBe(0);
  });

  it('counts a store the index holds and not an untracked one beside it', () => {
    const { root } = checkoutWith({ 'src/shared/app/AuthStore.ts': 'export const a = 1;\n' });
    write(root, 'src/shared/app/DraftStore.ts', 'export const b = 2;\n');

    expect(runGuard(root, 0, 1).code).toBe(0);
  });

  it('still refuses a staged call site over the ceiling', () => {
    const { root, git } = checkoutWith({ 'src/features/a/useA.ts': IMPORTS_ENGINE });
    write(root, 'src/features/b/useB.ts', IMPORTS_ENGINE);
    git('add', '-A');

    const { code, out } = runGuard(root, 1, 0);
    expect(code).toBe(1);
    expect(out).toContain('src/features/b/useB.ts');
  });
});

describe('the real tree', () => {
  it('sits on the ceilings the audit script passes', () => {
    const lint = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const script = lint.scripts['lint:engine-surface'];

    expect(script).toContain('--engine-ceiling');
    expect(
      execFileSync('node', [GUARD, ...script.split(' ').slice(2)], {
        encoding: 'utf8',
        env: gitFreeEnv(),
      })
    ).toContain('Engine surface');
  });
});

/**
 * Scenario: git hands `GIT_DIR`, `GIT_INDEX_FILE` and `GIT_WORK_TREE` to
 * everything a hook runs and those beat `cwd`, and `npm run audit` runs this
 * guard from `pre-commit` and from `merge-gates.sh`.
 *
 * Expected behaviour: the guard answers about the root it was given. Reading
 * another tree's index, it counted nothing and then told the reader to lower
 * both ceilings to zero, which hands back every file a sweep had taken.
 */
describe('a run under the environment a hook inherits', () => {
  /** A checkout whose index this guard has nothing to do with. */
  function foreignCheckout(): string {
    const root = treeWith({ 'README.md': 'x\n' });
    runGit(['init', '-q'], root);
    runGit(['add', '-A'], root);
    return root;
  }

  function runGuardWithEnv(root: string, env: NodeJS.ProcessEnv) {
    const args = [GUARD, '--root', root, '--engine-ceiling', '1', '--store-ceiling', '0'];
    try {
      // inherits-git-env: deliberate. `env` is a parameter here because one case
      // asks what the guard reports under a `GIT_DIR` pointing elsewhere.
      return { code: 0, out: execFileSync('node', args, { encoding: 'utf8', env }) };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  it('counts the root it was given, not the tree its environment names', () => {
    const root = treeWith({ 'src/features/a/useA.ts': IMPORTS_ENGINE });
    runGit(['init', '-q'], root);
    runGit(['add', '-A'], root);
    const foreign = foreignCheckout();

    const { code, out } = runGuardWithEnv(root, {
      ...process.env,
      GIT_DIR: path.join(foreign, '.git'),
      GIT_WORK_TREE: foreign,
    });

    expect(out).not.toContain('Lower the ceiling to 0');
    expect(code).toBe(0);
  });

  it('refuses a tree it read nothing from, rather than counting it as zero', () => {
    const root = treeWith({ 'README.md': 'x\n' });
    runGit(['init', '-q'], root);
    runGit(['add', '-A'], root);

    const { code, out } = runGuard(root, 0, 0);

    expect(code).toBe(1);
    expect(out).toContain('read nothing');
    expect(out).not.toContain('Lower the ceiling');
  });
});
