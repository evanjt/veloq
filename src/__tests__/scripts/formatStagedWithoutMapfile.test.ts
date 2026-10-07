/**
 * Scenario: bash 3.2, the shell macOS ships, has no `mapfile`. The format step
 * of the pre-commit hook ran under it, reported "command not found" and carried
 * on, so a commit formatted nothing.
 *
 * Expected behaviour: with `mapfile` unavailable the staged TypeScript is still
 * formatted and restaged, and a file with unstaged edits is still left alone.
 */

import { execFileSync } from 'node:child_process';
import { runGit, gitFreeEnv } from '../__shared__/gitFixture';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/format-staged.sh');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** A repository whose prettier appends a marker line to each file it is given. */
function checkout(): string {
  const root = mkdtempSync(join(tmpdir(), 'format-staged-'));
  roots.push(root);
  runGit(['init', '-q'], root);
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'config'));
  mkdirSync(join(root, 'node_modules', '.bin'), { recursive: true });
  const prettier = join(root, 'node_modules', '.bin', 'prettier');
  writeFileSync(
    prettier,
    '#!/usr/bin/env bash\nfor a in "$@"; do [ -f "$a" ] && echo formatted >> "$a"; done\nexit 0\n'
  );
  chmodSync(prettier, 0o755);
  writeFileSync(join(root, 'config', '.prettierrc'), '{}\n');
  writeFileSync(join(root, 'config', '.prettierignore'), '');
  return root;
}

function withoutMapfile(root: string): string {
  const file = join(root, 'no-mapfile.sh');
  writeFileSync(file, 'enable -n mapfile\n');
  return file;
}

function run(root: string): void {
  execFileSync('bash', [SCRIPT], {
    cwd: root,
    encoding: 'utf8',
    env: { ...gitFreeEnv(), BASH_ENV: withoutMapfile(root) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('format-staged without mapfile', () => {
  it('formats and restages a staged file', () => {
    const root = checkout();
    writeFileSync(join(root, 'src', 'a.ts'), 'const a=1\n');
    runGit(['add', 'src/a.ts'], root);
    run(root);
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toContain('formatted');
    expect(runGit(['diff', '--cached', '--', 'src/a.ts'], root)).toContain('formatted');
  });

  it('leaves a file with unstaged edits alone', () => {
    const root = checkout();
    writeFileSync(join(root, 'src', 'b.ts'), 'const b=1\n');
    runGit(['add', 'src/b.ts'], root);
    writeFileSync(join(root, 'src', 'b.ts'), 'const b=2\n');
    run(root);
    expect(readFileSync(join(root, 'src', 'b.ts'), 'utf8')).not.toContain('formatted');
  });

  it('does nothing when no TypeScript is staged', () => {
    const root = checkout();
    expect(() => run(root)).not.toThrow();
  });
});
