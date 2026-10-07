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
const IMPORTS_VELOQRS_ENGINE = "import { CallKind, engine } from 'veloqrs';\n";
const IMPORTS_VELOQRS_ENGINE_BLOCK =
  "import {\n  engine,\n  startFetchAndStore,\n} from 'veloqrs';\n";
const IMPORTS_VELOQRS_WITHOUT_ENGINE =
  "import { decodeCoords, type EngineEvent } from 'veloqrs';\n";
const REQUIRES_VELOQRS_ENGINE =
  "export function run() {\n  const { engine, decodeCoords } = require('veloqrs');\n  return engine.getStats();\n}\n";
const REQUIRES_VELOQRS_ENGINE_TYPED =
  "export function run() {\n  const { engine } = require('veloqrs') as typeof import('veloqrs');\n  return engine;\n}\n";
const TAKES_ENGINE_INSTANCE =
  "function getEngine() {\n  const mod = require('veloqrs');\n  return mod.EngineClient?.getInstance() ?? null;\n}\n";
const TAKES_ENGINE_INSTANCE_INLINE =
  "export const stats = () => require('veloqrs').EngineClient.getInstance().getStats();\n";
const READS_ENGINE_OFF_REQUIRE =
  "export const stats = () => require('veloqrs').engine.getStats();\n";
const READS_ENGINE_OFF_NAMESPACE =
  "import * as veloqrs from 'veloqrs';\n\nexport const stats = () => veloqrs.engine.getStats();\n";
const NAMESPACE_WITHOUT_ENGINE =
  "import * as veloqrs from 'veloqrs';\n\nexport const decode = veloqrs.decodeCoords;\n";
const REQUIRES_VELOQRS_WITHOUT_ENGINE =
  "export function tiles() {\n  const { basemapStore } = require('veloqrs');\n  return basemapStore;\n}\n";
const SETS_ENGINE_STATICS =
  "const { EngineClient } = require('veloqrs');\nEngineClient.setDebugEnabled(true);\n";

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

  it('counts the engine binding imported from veloqrs, which reaches the same engine', () => {
    const root = treeWith({ 'src/features/a/tilePass.ts': IMPORTS_VELOQRS_ENGINE });

    const { code, out } = runGuard(root, 0, 0);
    expect(code).toBe(1);
    expect(out).toContain('src/features/a/tilePass.ts');
  });

  it('counts the engine binding inside a multi-line veloqrs import block', () => {
    const root = treeWith({ 'src/features/a/useFetcher.ts': IMPORTS_VELOQRS_ENGINE_BLOCK });

    const { code, out } = runGuard(root, 0, 0);
    expect(code).toBe(1);
    expect(out).toContain('src/features/a/useFetcher.ts');
  });

  it('does not count a veloqrs import that takes no engine binding', () => {
    const root = treeWith({ 'src/features/a/decode.ts': IMPORTS_VELOQRS_WITHOUT_ENGINE });

    expect(runGuard(root, 0, 0).code).toBe(0);
  });

  it.each([
    ['a require destructure that takes the engine', REQUIRES_VELOQRS_ENGINE],
    ['a typed require destructure that takes the engine', REQUIRES_VELOQRS_ENGINE_TYPED],
    ['an EngineClient instance taken through a module binding', TAKES_ENGINE_INSTANCE],
    ['an EngineClient instance taken inline from the require', TAKES_ENGINE_INSTANCE_INLINE],
    ['the engine read off the require', READS_ENGINE_OFF_REQUIRE],
    ['the engine read off a namespace import', READS_ENGINE_OFF_NAMESPACE],
  ])('counts %s, which reaches the same engine', (_form, body) => {
    const root = treeWith({ 'src/features/a/task.ts': body });

    const { code, out } = runGuard(root, 0, 0);
    expect(code).toBe(1);
    expect(out).toContain('src/features/a/task.ts');
  });

  it.each([
    [
      'the module held in a variable',
      "const v = require('veloqrs');\nexport const stats = () => v.engine.getStats();\n",
    ],
    [
      'the shared engine module by a relative path',
      "import { getEngine } from '../../shared/native/engine';\nexport const n = () => getEngine();\n",
    ],
    [
      'the shared engine module by a dynamic import',
      "export const load = async () => (await import('@/shared/native/engine')).getEngine();\n",
    ],
    [
      'the engine read off a dynamic import of veloqrs',
      "export const load = async () => (await import('veloqrs')).engine;\n",
    ],
    [
      'a handle that only useEngineReady returns',
      "import { useEngineReady } from '@/shared/native/useEngineReady';\nexport function useThing() {\n  const engine = useEngineReady();\n  return engine;\n}\n",
    ],
  ])('counts %s', (_form, body) => {
    const root = treeWith({ 'src/features/a/task.ts': body });

    const { code, out } = runGuard(root, 0, 0);
    expect(code).toBe(1);
    expect(out).toContain('src/features/a/task.ts');
  });

  it('does not count a relative import of a module that only shares the name', () => {
    const root = treeWith({
      'src/features/a/task.ts': "import { run } from './engine';\nexport const x = run;\n",
    });

    expect(runGuard(root, 0, 0).code).toBe(0);
  });

  it.each([
    ['a require that takes no engine binding', REQUIRES_VELOQRS_WITHOUT_ENGINE],
    ['the EngineClient statics, which hold no instance', SETS_ENGINE_STATICS],
    ['a namespace import that reads no engine', NAMESPACE_WITHOUT_ENGINE],
  ])('does not count %s', (_form, body) => {
    const root = treeWith({ 'src/features/a/task.ts': body });

    expect(runGuard(root, 0, 0).code).toBe(0);
  });

  it('counts a file once when it reaches the engine both ways', () => {
    const root = treeWith({
      'src/features/a/useBoth.ts': IMPORTS_ENGINE + IMPORTS_VELOQRS_ENGINE_BLOCK,
    });

    expect(runGuard(root, 1, 0).code).toBe(0);
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
    // when the suite ran from `pre-merge-commit`.
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

  it('counts a staged multi-line veloqrs engine import', () => {
    const { root } = checkoutWith({
      'src/features/a/useA.ts': IMPORTS_ENGINE,
      'src/features/b/useFetcher.ts': IMPORTS_VELOQRS_ENGINE_BLOCK,
    });

    const { code, out } = runGuard(root, 1, 0);
    expect(code).toBe(1);
    expect(out).toContain('src/features/b/useFetcher.ts');
  });

  it.each([
    ['require destructure', REQUIRES_VELOQRS_ENGINE],
    ['EngineClient instance', TAKES_ENGINE_INSTANCE],
  ])('counts a staged %s', (_form, body) => {
    const { root } = checkoutWith({
      'src/features/a/useA.ts': IMPORTS_ENGINE,
      'src/features/b/task.ts': body,
    });

    const { code, out } = runGuard(root, 1, 0);
    expect(code).toBe(1);
    expect(out).toContain('src/features/b/task.ts');
  });

  it('reads the staged veloqrs import, not the edit on disk that dropped the engine', () => {
    const { root } = checkoutWith({ 'src/features/b/tilePass.ts': IMPORTS_VELOQRS_ENGINE });
    write(root, 'src/features/b/tilePass.ts', IMPORTS_VELOQRS_WITHOUT_ENGINE);

    expect(runGuard(root, 1, 0).code).toBe(0);
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

/**
 * Scenario: a worktree's index named a blob its object store no longer held.
 * `git grep --cached` printed "unable to read" for the file and exited 1, the
 * same code as "nothing matched", and the guard took it as no match. It printed
 * one call site fewer and asked for the ceiling to fall, which was followed, and
 * main went red on the next full read.
 *
 * Expected behaviour: a blob the guard cannot read fails it and names the path,
 * whether `git grep` or `git show` is the one that could not read it, and it
 * never advises a lower ceiling on a count it did not finish.
 */
describe('an index entry whose blob cannot be read', () => {
  function checkoutWith(files: Tree) {
    const root = treeWith(files);
    runGit(['init', '-q'], root);
    runGit(['add', '-A'], root);
    return root;
  }

  /** Delete the object the index names for `rel`, as a pruned mirror did. */
  function dropBlob(root: string, rel: string) {
    const sha = runGit(['rev-parse', `:${rel}`], root).trim();
    fs.rmSync(path.join(root, '.git', 'objects', sha.slice(0, 2), sha.slice(2)));
  }

  /** A `git` first on the PATH that fails every `show`, the second read. */
  function gitFailingShow(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-git-shim-'));
    const real = execFileSync('sh', ['-c', 'command -v git'], {
      encoding: 'utf8',
      env: gitFreeEnv(),
    }).trim();
    const shim = path.join(dir, 'git');
    fs.writeFileSync(
      shim,
      `#!/bin/sh\nif [ "$1" = show ]; then echo "fatal: bad object $2" >&2; exit 128; fi\nexec ${JSON.stringify(real)} "$@"\n`
    );
    fs.chmodSync(shim, 0o755);
    return dir;
  }

  function runGuardOnPath(root: string, pathPrefix: string) {
    const args = [GUARD, '--root', root, '--engine-ceiling', '1', '--store-ceiling', '0'];
    try {
      const out = execFileSync('node', args, {
        encoding: 'utf8',
        env: { ...gitFreeEnv(), PATH: `${pathPrefix}${path.delimiter}${process.env.PATH}` },
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  }

  it('fails on an unreadable call site rather than asking for the ceiling to fall', () => {
    const root = checkoutWith({
      'src/features/a/useA.ts': IMPORTS_ENGINE,
      'src/features/b/plain.ts': 'export const b = 1;\n',
    });
    dropBlob(root, 'src/features/a/useA.ts');

    const { code, out } = runGuard(root, 1, 0);

    expect(code).not.toBe(0);
    expect(out).toContain('src/features/a/useA.ts');
    expect(out).not.toContain('Lower the ceiling');
  });

  it('fails on an unreadable file even when the count it did finish sits on the ceiling', () => {
    const root = checkoutWith({
      'src/features/a/useA.ts': IMPORTS_ENGINE,
      'src/features/b/task.ts': REQUIRES_VELOQRS_ENGINE,
    });
    dropBlob(root, 'src/features/b/task.ts');

    const { code, out } = runGuard(root, 1, 0);

    expect(code).not.toBe(0);
    expect(out).toContain('src/features/b/task.ts');
  });

  it('still reads a tree where nothing matches one of the patterns as no match', () => {
    const root = checkoutWith({ 'src/features/a/plain.ts': 'export const a = 1;\n' });

    const { code, out } = runGuard(root, 0, 0);

    expect(out).not.toContain('could not read');
    expect(code).toBe(0);
  });

  it('fails when git show cannot read a candidate, rather than counting it out', () => {
    const root = checkoutWith({ 'src/features/b/decode.ts': IMPORTS_VELOQRS_WITHOUT_ENGINE });

    const { code, out } = runGuardOnPath(root, gitFailingShow());

    expect(code).not.toBe(0);
    expect(out).toContain('src/features/b/decode.ts');
  });

  it('fails when git show cannot read the only call site, and asks for no lower ceiling', () => {
    const root = checkoutWith({ 'src/features/b/tilePass.ts': IMPORTS_VELOQRS_ENGINE });

    const { code, out } = runGuardOnPath(root, gitFailingShow());

    expect(code).not.toBe(0);
    expect(out).toContain('src/features/b/tilePass.ts');
    expect(out).not.toContain('Lower the ceiling');
  });
});
