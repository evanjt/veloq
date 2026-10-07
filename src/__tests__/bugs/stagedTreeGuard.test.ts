/**
 * Scenario: a gate running under the pre-commit hook writes the repository's
 * own index, which `check-commit-index.sh` runs too early to see.
 *
 * Expected behaviour: the hook records the staged tree before the gates and
 * refuses the commit if anything moved it, naming both trees.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const SCRIPT = resolve('scripts/check-staged-tree.sh');
const roots: string[] = [];

function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'staged-tree-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, contents);
  }
  runGit(['init', '-q'], root);
  runGit(['add', '-A'], root);
  return root;
}

function run(root: string, args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync('sh', [SCRIPT, ...args], {
      cwd: root,
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? -1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe('the staged-tree guard', () => {
  it('records a tree and accepts it back unchanged', () => {
    const root = repoWith({ 'a.ts': 'export const a = 1;\n' });
    const recorded = run(root, ['record']);

    expect(recorded.status).toBe(0);
    expect(recorded.output.trim()).toMatch(/^[0-9a-f]{40} none$/);
    expect(run(root, ['verify', ...recorded.output.trim().split(' ')]).status).toBe(0);
  });

  it('refuses a commit whose index moved while the gates ran', () => {
    const root = repoWith({ 'a.ts': 'export const a = 1;\n' });
    const [before, head] = run(root, ['record']).output.trim().split(' ');

    writeFileSync(join(root, 'b.ts'), 'export const b = 2;\n');
    runGit(['add', '-A'], root);

    const { status, output } = run(root, ['verify', before, head]);

    expect(status).toBe(1);
    expect(output).toContain('the staged tree changed while the gates ran');
    expect(output).toContain(before);
  });

  it('names a moved HEAD as a landing and leaves the staged work intact', () => {
    const root = repoWith({ 'a.ts': 'export const a = 1;\n', 'README.md': 'one\n' });
    runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'base'], root);
    const base = runGit(['rev-parse', 'HEAD'], root).trim();
    runGit(['checkout', '-q', '-b', 'side'], root);
    writeFileSync(join(root, 'CHANGELOG.md'), 'entry\n');
    runGit(['add', 'CHANGELOG.md'], root);
    runGit(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'side'], root);
    const landed = runGit(['rev-parse', 'HEAD'], root).trim();
    runGit(['checkout', '-q', '-'], root);

    writeFileSync(join(root, 'README.md'), 'two\n');
    runGit(['add', 'README.md'], root);
    const [tree, head] = run(root, ['record']).output.trim().split(' ');
    expect(head).toBe(base);

    runGit(['merge', '--ff-only', '-q', 'side'], root);
    const { status, output } = run(root, ['verify', tree, head]);

    expect(status).toBe(1);
    expect(output).toContain(`HEAD moved from ${base} to ${landed}`);
    expect(output).toContain('nothing was committed');
    expect(output).toContain('run the commit again');
    expect(output).not.toContain('A gate wrote');
  });

  it('catches the shape that caused it: every entry replaced by a fixture', () => {
    const root = repoWith({
      'src/kept.ts': 'export const kept = 1;\n',
      'src/also.ts': 'export const also = 2;\n',
    });
    const [before, head] = run(root, ['record']).output.trim().split(' ');

    // What `git add -A` in a fixture does to this index when GIT_DIR points here.
    runGit(['rm', '-r', '--cached', '-q', '.'], root);
    writeFileSync(join(root, 'f.ts'), 'export const f = 1;\n');
    runGit(['add', 'f.ts'], root);

    expect(run(root, ['verify', before, head]).status).toBe(1);
  });

  it('says nothing and passes when it is given no tree to compare', () => {
    const root = repoWith({ 'a.ts': 'export const a = 1;\n' });

    expect(run(root, ['verify']).status).toBe(0);
  });

  it('rejects an unknown mode rather than passing silently', () => {
    const root = repoWith({ 'a.ts': 'export const a = 1;\n' });

    expect(run(root, ['nonsense']).status).toBe(2);
  });
});
