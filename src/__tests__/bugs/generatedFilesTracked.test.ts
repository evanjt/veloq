/**
 * Scenario: about forty thousand lines of the tracked tree is machine output, and each
 * file was committed for its own reason with none of them written as a rule.
 * What the repository said was a block of commented-out paths in `.gitignore`
 * pointing at a build system plan that is not in the tree, so the next
 * generated file would be argued from scratch.
 *
 * Expected behaviour: the rule is a guard. A generated module is committed
 * when its generator needs a toolchain or a network that CI, or a fresh clone,
 * does not have, so `git clone && npm run android` works with no network
 * beyond npm. The guard fails when such a file is untracked or newly ignored,
 * and names it.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { initFixtureRepo, gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-generated-files.mjs');

function runGuard(root?: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', root ? [SCRIPT, '--root', root] : [SCRIPT], {
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'generated-files-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  initFixtureRepo(root);
  return root;
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails on a generated file the tree does not track, and names it', () => {
  const root = fixture({
    '.gitignore': 'node_modules/\nsrc/features/maps/assets/basemapSprite.generated.ts\n',
    'src/features/maps/assets/basemapSprite.generated.ts': 'export const sprite = 1;\n',
    'src/app.ts': 'export const a = 1;\n',
  });

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/features/maps/assets/basemapSprite.generated.ts');
});

it('fails on a generated file nobody added, since an untracked one is not committed either', () => {
  const root = fixture({
    '.gitignore': 'node_modules/\n',
    'src/app.ts': 'export const a = 1;\n',
  });
  writeFileSync(join(root, 'src/thing.generated.ts'), 'export const t = 1;\n');

  const { status, output } = runGuard(root);

  expect(status).toBe(1);
  expect(output).toContain('src/thing.generated.ts');
});

it('passes a tracked generated file', () => {
  const root = fixture({
    '.gitignore': 'node_modules/\n',
    'src/thing.generated.ts': 'export const t = 1;\n',
  });

  expect(runGuard(root).status).toBe(0);
});

it('leaves the platform output a build makes alone, which is not committed by the rule', () => {
  const root = fixture({
    '.gitignore': 'node_modules/\nmodules/veloqrs/ios/Generated/\n',
    'src/app.ts': 'export const a = 1;\n',
  });
  mkdirSync(join(root, 'modules/veloqrs/ios/Generated'), { recursive: true });
  writeFileSync(join(root, 'modules/veloqrs/ios/Generated/veloqrs.swift'), '// built\n');

  expect(runGuard(root).status).toBe(0);
});

it('never enumerates node_modules, which is what the listing died on', () => {
  // `ls-files --ignored` over the whole tree lists every installed package, and
  // the first run of this guard in the main checkout died on `spawnSync git
  // ENOBUFS` where a worktree with a symlinked node_modules had passed. A
  // generated file inside an installed package is not this repository's to
  // commit either.
  const root = fixture({
    '.gitignore': 'node_modules/\n',
    'src/app.ts': 'export const a = 1;\n',
  });
  mkdirSync(join(root, 'node_modules/some-package'), { recursive: true });
  writeFileSync(
    join(root, 'node_modules/some-package/thing.generated.ts'),
    'export const t = 1;\n'
  );

  const { status, output } = runGuard(root);

  expect(status).toBe(0);
  expect(output).not.toContain('node_modules');
});
