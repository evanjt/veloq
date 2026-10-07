/**
 * Scenario: a history rewrite leaves the old line behind under a `pre-squash-*`
 * tag, and every branch cut before the rewrite still sits on that line.
 * Merging one brings the retired commits back beside their rewritten copies,
 * and nothing in the landing or the merge hook reads ancestry.
 *
 * Expected behaviour: `check-retired-history.sh` refuses an incoming branch
 * whose merge base with a retired tag is not in the target, naming the tag and
 * the commit count. `land-branch.sh` and `pre-merge-commit` both call it. A
 * branch cut from the rewritten target still lands, and with no such tag
 * nothing is refused.
 */

import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = resolve(__dirname, '../../..');
const CHECK = join(ROOT, 'scripts/check-retired-history.sh');
const LAND = join(ROOT, 'scripts/land-branch.sh');
const HOOK = join(ROOT, '.husky/pre-merge-commit');

const boxes: string[] = [];
afterAll(() => {
  for (const box of boxes) rmSync(box, { recursive: true, force: true });
});

function write(root: string, path: string, contents: string, executable = false): void {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
  if (executable) chmodSync(full, 0o755);
}

function commit(root: string, path: string, message: string): void {
  write(root, path, `${message}\n`);
  runGit(['add', path], root);
  runGit(['commit', '-qm', message], root);
}

interface Fixture {
  box: string;
  root: string;
}

/**
 * `main` was rewritten: its root commit is shared with the old line, but the
 * old line's two commits live on only under `pre-squash-fixture`, and `main`
 * carries one commit with the same tree. `old-work` is cut from the old line,
 * `new-work` from the rewritten `main`.
 */
function rewrittenRepository(tag = 'pre-squash-fixture'): Fixture {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'retired-')));
  boxes.push(box);
  const root = join(box, 'veloq');
  mkdirSync(root);
  write(root, 'scripts/merge-gates.sh', '#!/bin/sh\nexit 0\n', true);
  write(root, 'scripts/check-commit-index.sh', '#!/bin/sh\nexit 0\n', true);
  copyFileSync(CHECK, join(root, 'scripts/check-retired-history.sh'));
  chmodSync(join(root, 'scripts/check-retired-history.sh'), 0o755);
  write(root, '.hooks/pre-merge-commit', readFileSync(HOOK, 'utf8'), true);
  write(root, '.gitignore', '.hooks/\n');
  write(box, 'provision.sh', '#!/bin/sh\nexit 0\n', true);
  runGit(['init', '-q', '-b', 'main'], root);
  runGit(['config', 'core.hooksPath', '.hooks'], root);
  runGit(['add', '-A'], root);
  runGit(['commit', '-qm', 'root'], root);
  const rootSha = runGit(['rev-parse', 'HEAD'], root).trim();

  commit(root, 'one.txt', 'first old commit');
  commit(root, 'two.txt', 'second old commit');
  runGit(['tag', tag], root);
  runGit(['branch', 'old-work', tag], root);

  runGit(['reset', '-q', '--soft', rootSha], root);
  runGit(['commit', '-qm', 'rewritten'], root);
  runGit(['checkout', '-q', 'old-work'], root);
  commit(root, 'old.txt', 'work cut before the rewrite');
  runGit(['checkout', '-q', '-b', 'new-work', 'main'], root);
  commit(root, 'new.txt', 'work cut after the rewrite');
  runGit(['checkout', '-q', 'main'], root);
  return { box, root };
}

function run(cmd: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  const r = spawnSync(cmd, args, {
    cwd,
    env: { ...gitFreeEnv(), VELOQ_LAND_ATTEMPTS: '1', VELOQ_LAND_SLEEP: '0', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  });
  return { status: r.status ?? -1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

const check = (fx: Fixture, incoming: string) => run('sh', [CHECK, 'main', incoming], fx.root);
const land = (fx: Fixture, branch: string) =>
  run('bash', [LAND, branch], fx.root, { VELOQ_LAND_PROVISION: join(fx.box, 'provision.sh') });
const merge = (fx: Fixture, branch: string) =>
  run('git', ['merge', '--no-ff', '--no-edit', branch], fx.root);

describe('check-retired-history.sh', () => {
  it('refuses a branch cut from the retired line, naming the tag and the count', () => {
    const fx = rewrittenRepository();

    const { status, output } = check(fx, 'old-work');

    expect(status).not.toBe(0);
    expect(output).toContain('pre-squash-fixture');
    expect(output).toMatch(/\b2 commits\b/);
    expect(output).toContain('git rebase --onto');
  });

  it('passes a branch cut from the rewritten target', () => {
    const fx = rewrittenRepository();

    expect(check(fx, 'new-work').status).toBe(0);
  });

  it('passes everything when no retired tag exists', () => {
    const fx = rewrittenRepository();
    runGit(['tag', '-d', 'pre-squash-fixture'], fx.root);

    expect(check(fx, 'old-work').status).toBe(0);
  });

  it('also reads pre-consolidation tags', () => {
    const fx = rewrittenRepository('pre-consolidation-fixture');

    const { status, output } = check(fx, 'old-work');

    expect(status).not.toBe(0);
    expect(output).toContain('pre-consolidation-fixture');
  });

  it('passes a branch the target already contains', () => {
    const fx = rewrittenRepository();

    expect(check(fx, 'main').status).toBe(0);
  });
});

describe('landing a branch cut from retired history', () => {
  it('refuses it and leaves the target where it was', () => {
    const fx = rewrittenRepository();
    const before = runGit(['rev-parse', 'HEAD'], fx.root).trim();

    const { status, output } = land(fx, 'old-work');

    expect(status).not.toBe(0);
    expect(output).toContain('pre-squash-fixture');
    expect(runGit(['rev-parse', 'HEAD'], fx.root).trim()).toBe(before);
  });

  it('lands a branch cut from the rewritten target', () => {
    const fx = rewrittenRepository();

    const { status, output } = land(fx, 'new-work');

    expect({ status, output: status === 0 ? '' : output }).toEqual({ status: 0, output: '' });
    expect(readFileSync(join(fx.root, 'new.txt'), 'utf8')).toContain('after the rewrite');
  });

  it('lands the retired-line branch once the tag is gone', () => {
    const fx = rewrittenRepository();
    runGit(['tag', '-d', 'pre-squash-fixture'], fx.root);

    expect(land(fx, 'old-work').status).toBe(0);
  });
});

describe('a plain merge of a branch cut from retired history', () => {
  it('is refused by pre-merge-commit and makes no commit', () => {
    const fx = rewrittenRepository();
    const before = runGit(['rev-parse', 'HEAD'], fx.root).trim();

    const { status, output } = merge(fx, 'old-work');

    expect(status).not.toBe(0);
    expect(output).toContain('pre-squash-fixture');
    expect(runGit(['rev-parse', 'HEAD'], fx.root).trim()).toBe(before);
  });

  it('commits a branch cut from the rewritten target', () => {
    const fx = rewrittenRepository();
    commit(fx.root, 'main-moves.txt', 'main moves so the merge is not a fast-forward');

    const { status, output } = merge(fx, 'new-work');

    expect({ status, output: status === 0 ? '' : output }).toMatchObject({ status: 0 });
  });
});
