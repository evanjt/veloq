/**
 * Scenario: the shared index reader lists paths with `git ls-files -z`, which is
 * NUL-delimited and correct, and then asks for their bytes by writing `:<path>`
 * one per line into `git cat-file --batch`. A path holding a newline is two
 * requests, the reply stream stops matching the request list, and the walk that
 * reads the `<sha> <type> <size>` headers breaks part way.
 *
 * Expected behaviour: every tracked path comes back with its bytes, whatever the
 * name holds. Four guards judge only what this returns, so a short map is a
 * clean tree reported over files nobody read.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');
const HELPER = join(ROOT, 'scripts/lib/indexedSources.mjs');
const GUARD = join(ROOT, 'scripts/lint-em-dashes.mjs');

/** Built from its code point so this file is not the guard's own first offender. */
const EM_DASH = String.fromCharCode(0x2014);

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'odd-paths-'));
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

/** The same, with a commit, so it can stand as a submodule's source. */
function committed(files: Record<string, string>): string {
  const root = fixture(files);
  runGit(['commit', '-qm', 'base'], root);
  return root;
}

/**
 * The helper is an ES module that Jest does not transform, so it is read the
 * way the guards themselves reach it: through node.
 */
function read(root: string, pathspec: string[] = []): Record<string, string> {
  const probe = `
    import { indexedSources } from ${JSON.stringify(HELPER)};
    const sources = indexedSources(process.argv[1], JSON.parse(process.argv[2]));
    const out = {};
    for (const [path, bytes] of sources) out[path] = bytes.toString('utf8');
    process.stdout.write(JSON.stringify(out));
  `;
  const stdout = execFileSync(
    'node',
    ['--input-type=module', '-e', probe, root, JSON.stringify(pathspec)],
    { encoding: 'utf8', env: gitFreeEnv(), maxBuffer: 64 * 1024 * 1024 }
  );
  return JSON.parse(stdout) as Record<string, string>;
}

function runGuard(root: string): { code: number; out: string } {
  try {
    const out = execFileSync('node', [GUARD, '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('the shared index reader', () => {
  it('returns the bytes of a path whose name holds a newline', () => {
    const odd = 'odd\nname.txt';
    const sources = read(fixture({ 'normal.txt': 'clean\n', [odd]: 'tricky\n' }));

    expect(Object.keys(sources).sort()).toEqual([odd, 'normal.txt'].sort());
    expect(sources[odd]).toBe('tricky\n');
  });

  it('keeps reading the files after the odd one, which is what broke', () => {
    const sources = read(
      fixture({ 'a.txt': 'first\n', 'b\nb.txt': 'middle\n', 'c.txt': 'last\n', 'd.txt': 'after\n' })
    );

    expect(Object.keys(sources)).toHaveLength(4);
    expect(sources['d.txt']).toBe('after\n');
  });

  it('reads a path holding a quote and a backslash too', () => {
    const odd = 'quote"and\\slash.txt';
    const sources = read(fixture({ [odd]: 'awkward\n', 'z.txt': 'after\n' }));

    expect(sources[odd]).toBe('awkward\n');
    expect(sources['z.txt']).toBe('after\n');
  });

  it('still answers an ordinary tree, and narrows to a pathspec', () => {
    const root = fixture({ 'src/a.ts': 'a\n', 'docs/b.md': 'b\n' });

    expect(Object.keys(read(root)).sort()).toEqual(['docs/b.md', 'src/a.ts']);
    expect(Object.keys(read(root, ['src']))).toEqual(['src/a.ts']);
  });
});

/**
 * The submodule is what actually broke it. `git cat-file --batch` answers a
 * gitlink with `<sha> submodule`, a header carrying no size, which the walk read
 * as a blob's. It stopped at `modules/veloqrs/rust/tracematch`, file 730 of
 * 3,022, and every path sorting after it went unread.
 */
describe('a tree holding a submodule', () => {
  it('reads the files that sort after it', () => {
    const outer = fixture({ 'a.txt': 'first\n', 'z.txt': 'last\n' });
    const inner = committed({ 'in.txt': 'inner\n' });
    runGit(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'm'], outer);

    const sources = read(outer);

    expect(sources['z.txt']).toBe('last\n');
    expect(sources['a.txt']).toBe('first\n');
    // The gitlink itself has no bytes to read, so it is not a row.
    expect(Object.keys(sources)).not.toContain('m');
  });
});

/** The harm, through a guard that judges only what the reader hands it. */
describe('a guard reading through it', () => {
  it('still finds a violation in a file listed after an oddly named one', () => {
    const root = fixture({
      'a.txt': 'clean\n',
      'b\nb.txt': 'also clean\n',
      'config/notes.txt': `a violation ${EM_DASH} right here\n`,
    });

    const { code, out } = runGuard(root);

    expect(code).toBe(1);
    expect(out).toContain('config/notes.txt');
  });

  it('still finds one in a file listed after a submodule', () => {
    const inner = committed({ 'in.txt': 'inner\n' });
    const root = fixture({
      'a.txt': 'clean\n',
      'zz/notes.txt': `a violation ${EM_DASH} right here\n`,
    });
    runGit(['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', inner, 'm'], root);

    const { code, out } = runGuard(root);

    expect(code).toBe(1);
    expect(out).toContain('zz/notes.txt');
  });
});

/**
 * Scenario: an index names a blob its object store no longer holds, which a
 * pruned mirror left behind in a worktree on 2026-09-30. `git cat-file --batch`
 * answers that request with `:<path> missing` and exits 0, and the walk stepped
 * over it the way it steps over a gitlink, so every guard reading through it
 * judged the tree without the file and reported it clean.
 *
 * Expected behaviour: a path the listing named and git could not read fails the
 * read and is named, and so does a path left unmerged, which has no blob at
 * stage 0 to read. A guard over it exits non-zero rather than clean.
 */
describe('an index entry whose blob cannot be read', () => {
  function dropBlob(root: string, rel: string) {
    const sha = runGit(['rev-parse', `:${rel}`], root).trim();
    rmSync(join(root, '.git', 'objects', sha.slice(0, 2), sha.slice(2)));
  }

  function readError(root: string): string {
    try {
      read(root);
    } catch (error) {
      const e = error as { stderr?: string };
      return e.stderr ?? String(error);
    }
    throw new Error('the reader answered over a blob it could not read');
  }

  it('fails the read and names the path', () => {
    const root = fixture({ 'a.txt': 'first\n', 'b.txt': 'gone\n', 'c.txt': 'last\n' });
    dropBlob(root, 'b.txt');

    expect(readError(root)).toContain('b.txt');
  });

  it('fails a guard reading through it rather than reporting the tree clean', () => {
    const root = fixture({ 'a.txt': 'clean\n', 'notes.txt': `a violation ${EM_DASH} here\n` });
    dropBlob(root, 'notes.txt');

    const { code, out } = runGuard(root);

    expect(code).not.toBe(0);
    expect(out).toContain('notes.txt');
  });

  it('fails on a path left unmerged, which has no staged blob to read', () => {
    const root = fixture({ 'f.txt': 'base\n' });
    runGit(['commit', '-qm', 'base'], root);
    runGit(['checkout', '-qb', 'other'], root);
    writeFileSync(join(root, 'f.txt'), 'theirs\n');
    runGit(['commit', '-qam', 'theirs'], root);
    runGit(['checkout', '-q', '-'], root);
    writeFileSync(join(root, 'f.txt'), 'ours\n');
    runGit(['commit', '-qam', 'ours'], root);
    try {
      runGit(['merge', '-q', 'other'], root);
    } catch {
      // The conflict is the point: the index now holds f.txt at stages 1 to 3.
    }

    expect(readError(root)).toContain('f.txt');
  });
});
