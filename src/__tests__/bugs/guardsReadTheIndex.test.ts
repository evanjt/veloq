/**
 * Scenario: every worktree merges through one checkout, and the whole-tree
 * guards run there on every commit and every merge. A guard that lists the
 * index but reads the bytes off the disk therefore judges whichever session
 * happens to have a file open. On 2026-09-15 two em dashes inside another
 * session's in-flight binding regeneration failed `npm run audit` for the whole
 * fleet, on a file nobody was merging.
 *
 * Expected behaviour: the content a guard judges comes out of the index, so a
 * violation only on disk passes and the same violation staged fails.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, initFixtureRepo, runGit } from '../__shared__/gitFixture';

const SCRIPTS = join(__dirname, '../../../scripts');

const roots: string[] = [];

function write(root: string, path: string, contents: string) {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'index-guard-'));
  roots.push(root);
  for (const [path, contents] of Object.entries(files)) write(root, path, contents);
  initFixtureRepo(root);
  return root;
}

function runGuard(script: string, root: string): number {
  try {
    execFileSync('node', [join(SCRIPTS, script), '--root', root], {
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

/** Each guard, with a file it judges: the clean text and the violating one. */
const GUARDS = [
  {
    script: 'lint-em-dashes.mjs',
    file: 'config/fastlane/metadata/android/de-DE/full_description.txt',
    clean: 'Alles bleibt auf dem Gerat, keine Analyse.\n',
    violation: 'Alles bleibt auf dem Gerät — keine Analyse.\n',
  },
  {
    script: 'lint-au-spelling.mjs',
    file: 'modules/veloqrs/rust/veloqrs/src/probe.rs',
    clean: 'fn optimise_route() {}\n',
    violation: 'fn optimize_route() {}\n',
  },
  {
    script: 'lint-audit-ids.mjs',
    file: 'src/features/probe/useCadence.ts',
    clean: '// The constraint, stated rather than referenced.\nexport const a = 1;\n',
    violation: '// Kept for the reason in `B123`.\nexport const a = 1;\n',
  },
  {
    script: 'lint-comment-line-refs.mjs',
    file: 'src/features/probe/useProbe.ts',
    clean: '// The reader, named rather than numbered.\nexport const a = 1;\n',
    violation: '// See lines 12-18 of the reader.\nexport const a = 1;\n',
  },
];

describe.each(GUARDS)('$script', ({ script, file, clean, violation }) => {
  it('passes a violation another session has only on disk', () => {
    const root = fixture({ [file]: clean });
    write(root, file, violation);

    expect(runGuard(script, root)).toBe(0);
  });

  it('still fails the same violation once it is staged', () => {
    const root = fixture({ [file]: clean });
    write(root, file, violation);
    runGit(['add', '-A'], root);

    expect(runGuard(script, root)).toBe(1);
  });
});

/**
 * The generated-file guard reads no file content, only which paths git knows
 * about, so there is no index-against-disk split in it to fix. What it shares
 * with the three above is the environment: run from a hook without dropping
 * `GIT_DIR`, it answers about the repository the hook is committing rather than
 * about the root it was pointed at, and the answer looks like a verdict.
 */
describe('lint-generated-files.mjs', () => {
  function runWithGitDir(root: string, gitDir: string): number {
    try {
      // inherits-git-env: deliberate. The `GIT_DIR` is this case's subject: it
      // asks what the guard reports when one points somewhere else.
      execFileSync('node', [join(SCRIPTS, 'lint-generated-files.mjs'), '--root', root], {
        env: { ...gitFreeEnv(), GIT_DIR: gitDir },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return 0;
    } catch (error) {
      return (error as { status: number }).status;
    }
  }

  it('reads the index of the root it was given, not the one in its environment', () => {
    // One tree on disk, two indexes: its own, which tracks the generated file,
    // and a foreign one that does not. A guard that keeps `GIT_DIR` reads the
    // foreign index against this disk and calls a committed file uncommitted.
    const root = fixture({
      'src/app.ts': 'export const a = 1;\n',
      'src/theme/palette.generated.ts': 'export const b = 2;\n',
    });
    const foreign = fixture({ 'src/app.ts': 'export const a = 1;\n' });

    expect(runWithGitDir(root, join(foreign, '.git'))).toBe(0);
  });
});
