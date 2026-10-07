/**
 * Scenario: the private-data guard read only the staged paths and ran only in
 * `pre-commit`. A worktree runs no hooks until `npm run prepare`, the landing
 * merge runs with hooks off, and CI stages nothing, so a `routes.db` committed
 * there reached main and then the remote with nothing refusing it.
 *
 * Expected behaviour: one set of path rules judges the index, the whole tree,
 * a list on stdin and every commit of a range, and `pre-push` refuses a range
 * that adds personal data even when a later commit in it deletes the file.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');
const GUARD = join(ROOT, 'scripts/check-no-private-data.sh');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function write(root: string, path: string, contents = 'x\n') {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}

function repo(files: string[] = ['src/app.ts']): string {
  const root = mkdtempSync(join(tmpdir(), 'private-data-'));
  roots.push(root);
  runGit(['init', '-q', '-b', 'main'], root);
  for (const file of files) write(root, file);
  runGit(['add', '-A'], root);
  runGit(['commit', '-q', '--no-verify', '-m', 'base'], root);
  return root;
}

function commit(root: string, message: string) {
  runGit(['add', '-A'], root);
  runGit(['commit', '-q', '--no-verify', '-m', message], root);
}

function run(cmd: string, args: string[], root: string, input = ''): number {
  try {
    execFileSync(cmd, args, { cwd: root, env: gitFreeEnv(), input, stdio: 'pipe' });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

const guard = (root: string, args: string[] = [], input = '') =>
  run('bash', [GUARD, ...args], root, input);

// Git quotes a path holding a non-ASCII byte unless told not to, and the quote
// hid the extension and the directory from every rule. The real corpus names
// its files after the activity, `Savièse Hiking.gpx` among them.
const PRIVATE = [
  'modules/veloqrs/rust/veloqrs/tests/fixtures/private/notes.sql',
  'routes.db',
  'data/ride.gpx',
  'data/ride.fit.gz',
  'data/export.SQLITE3',
  'data/Course à pied.gpx',
  'private/Zürich.txt',
  'screenshots/after-login.png',
  'after-login.png',
  'after-login.PNG',
  'data/a"b.gpx',
  'data/a\\b.gpx',
  'data/a\tb.gpx',
  'private/a"b.txt',
  'screenshots/a"b.txt',
];

describe('the staged mode', () => {
  it('passes with nothing staged', () => {
    expect(guard(repo())).toBe(0);
  });

  it.each(PRIVATE)('refuses %s staged', (path) => {
    const root = repo();
    write(root, path);
    runGit(['add', '-f', path], root);
    expect(guard(root)).toBe(1);
  });

  it('passes a staged source file, the reviewable SQL fixture and the store screenshots', () => {
    const root = repo();
    write(root, 'src/other.ts');
    write(root, 'tests/fixtures/v12_demo.sql');
    write(root, 'docs/screenshots/01-feed.png');
    write(root, 'assets/icon.png');
    runGit(['add', '-A'], root);
    expect(guard(root)).toBe(0);
  });
});

describe('a path holding a newline', () => {
  it('is refused in the staged and whole-tree modes', () => {
    const root = repo(['src/app.ts']);
    write(root, 'data/a\nb.txt');
    runGit(['add', '-f', 'data/a\nb.txt'], root);
    expect(guard(root)).toBe(1);
    expect(guard(root, ['--all'])).toBe(1);
  });
});

describe('the whole-tree mode', () => {
  it('passes a clean tree', () => {
    expect(guard(repo(['src/app.ts', 'tests/fixtures/v12_demo.sql']), ['--all'])).toBe(0);
  });

  it.each(PRIVATE)('refuses %s already tracked, which staging never sees again', (path) => {
    const root = repo(['src/app.ts', path]);
    expect(guard(root)).toBe(0);
    expect(guard(root, ['--all'])).toBe(1);
  });
});

describe('the stdin mode', () => {
  it('judges the paths it is given and nothing else', () => {
    const root = repo();
    expect(guard(root, ['--stdin'], 'src/a.ts\nsrc/b.ts\n')).toBe(0);
    expect(guard(root, ['--stdin'], 'src/a.ts\ndata/ride.gpx\n')).toBe(1);
    expect(guard(root, ['--stdin'], '')).toBe(0);
  });
});

describe('the range mode', () => {
  it('passes a range of source commits', () => {
    const root = repo();
    const base = runGit(['rev-parse', 'HEAD'], root).trim();
    write(root, 'src/next.ts');
    commit(root, 'next');
    expect(guard(root, ['--range', `${base}..HEAD`])).toBe(0);
  });

  it.each(['data/ride.gpx', 'data/Course à pied.gpx'])(
    'refuses a range that adds %s and a later commit deletes it',
    (path) => {
      const root = repo();
      const base = runGit(['rev-parse', 'HEAD'], root).trim();
      write(root, path);
      runGit(['add', '-f', path], root);
      runGit(['commit', '-q', '--no-verify', '-m', 'add'], root);
      runGit(['rm', '-q', path], root);
      runGit(['commit', '-q', '--no-verify', '-m', 'remove'], root);
      expect(guard(root, ['--all'])).toBe(0);
      expect(guard(root, ['--range', `${base}..HEAD`])).toBe(1);
    }
  );

  it('refuses a file a merge commit adds itself, which a later commit deletes', () => {
    const root = repo();
    const base = runGit(['rev-parse', 'HEAD'], root).trim();
    runGit(['checkout', '-q', '-b', 'side'], root);
    write(root, 'src/side.ts');
    commit(root, 'side');
    runGit(['checkout', '-q', 'main'], root);
    runGit(['merge', '-q', '--no-ff', '--no-commit', 'side'], root);
    write(root, 'routes.db');
    runGit(['add', '-f', 'routes.db'], root);
    runGit(['commit', '-q', '--no-verify', '-m', 'merge'], root);
    runGit(['rm', '-q', 'routes.db'], root);
    runGit(['commit', '-q', '--no-verify', '-m', 'remove'], root);
    expect(guard(root, ['--range', `${base}..HEAD`])).toBe(1);
  });
});

describe('the merge mode', () => {
  function branchAddingAndDeleting(root: string, path: string) {
    runGit(['checkout', '-q', '-b', 'side'], root);
    write(root, path);
    runGit(['add', '-f', path], root);
    runGit(['commit', '-q', '--no-verify', '-m', 'add'], root);
    runGit(['rm', '-q', path], root);
    runGit(['commit', '-q', '--no-verify', '-m', 'remove'], root);
    runGit(['checkout', '-q', 'main'], root);
  }

  // The merge battery exports the landing's own base and runs this suite under
  // it, and `gitFreeEnv` drops it, so the fixture's base is the one it passes.
  const merge = (root: string, env: Record<string, string> = {}) => {
    try {
      execFileSync('bash', [GUARD, '--merge'], {
        cwd: root,
        env: { ...gitFreeEnv(), ...env },
      });
      return 0;
    } catch (error) {
      return (error as { status: number }).status;
    }
  };

  it('refuses a landed fast-forward whose commits added personal data', () => {
    const root = repo();
    const base = runGit(['rev-parse', 'HEAD'], root).trim();
    branchAddingAndDeleting(root, 'routes.db');
    runGit(['merge', '-q', '--ff-only', 'side'], root);
    expect(merge(root, { VELOQ_MERGE_BASE: base })).toBe(1);
  });

  it('passes a landed fast-forward of source commits', () => {
    const root = repo();
    const base = runGit(['rev-parse', 'HEAD'], root).trim();
    runGit(['checkout', '-q', '-b', 'side'], root);
    write(root, 'src/side.ts');
    commit(root, 'side');
    runGit(['checkout', '-q', 'main'], root);
    runGit(['merge', '-q', '--ff-only', 'side'], root);
    expect(merge(root, { VELOQ_MERGE_BASE: base })).toBe(0);
  });

  it('refuses a merge in progress whose branch added personal data', () => {
    const root = repo();
    write(root, 'src/main.ts');
    commit(root, 'main moves');
    branchAddingAndDeleting(root, 'data/ride.gpx');
    runGit(['merge', '-q', '--no-ff', '--no-commit', 'side'], root);
    expect(merge(root)).toBe(1);
  });

  it('passes with no merge to judge', () => {
    expect(merge(repo())).toBe(0);
  });
});

describe('pre-push', () => {
  const ZERO = '0000000000000000000000000000000000000000';

  function withHook(): string {
    const root = repo();
    mkdirSync(join(root, '.husky'), { recursive: true });
    mkdirSync(join(root, 'scripts'), { recursive: true });
    copyFileSync(join(ROOT, '.husky/pre-push'), join(root, '.husky/pre-push'));
    copyFileSync(GUARD, join(root, 'scripts/check-no-private-data.sh'));
    commit(root, 'hook');
    return root;
  }

  const push = (root: string, local: string, remote: string) =>
    run(
      'sh',
      ['.husky/pre-push', 'origin', 'url'],
      root,
      `refs/heads/main ${local} refs/heads/main ${remote}\n`
    );

  it('passes a push of source commits', () => {
    const root = withHook();
    const remote = runGit(['rev-parse', 'HEAD'], root).trim();
    write(root, 'src/next.ts');
    commit(root, 'next');
    expect(push(root, runGit(['rev-parse', 'HEAD'], root).trim(), remote)).toBe(0);
  });

  it('refuses a push whose commits add personal data, even deleted again', () => {
    const root = withHook();
    const remote = runGit(['rev-parse', 'HEAD'], root).trim();
    write(root, 'routes.db');
    runGit(['add', '-f', 'routes.db'], root);
    runGit(['commit', '-q', '--no-verify', '-m', 'add'], root);
    runGit(['rm', '-q', 'routes.db'], root);
    runGit(['commit', '-q', '--no-verify', '-m', 'remove'], root);
    expect(push(root, runGit(['rev-parse', 'HEAD'], root).trim(), remote)).toBe(1);
  });

  it('refuses a new branch carrying personal data the remote has never seen', () => {
    const root = withHook();
    write(root, 'data/ride.gpx');
    runGit(['add', '-f', 'data/ride.gpx'], root);
    runGit(['commit', '-q', '--no-verify', '-m', 'add'], root);
    expect(push(root, runGit(['rev-parse', 'HEAD'], root).trim(), ZERO)).toBe(1);
  });

  it('passes a branch deletion, which pushes no commits', () => {
    const root = withHook();
    expect(push(root, ZERO, runGit(['rev-parse', 'HEAD'], root).trim())).toBe(0);
  });
});

describe('the gates', () => {
  const listed = (set: string) =>
    execFileSync('node', [join(ROOT, 'scripts/run-guards.mjs'), '--set', set, '--json'], {
      cwd: ROOT,
      env: gitFreeEnv(),
      encoding: 'utf8',
    });

  it.each(['commit', 'land', 'all'])('run the whole-tree mode in the %s set', (set) => {
    const guards = JSON.parse(listed(set)) as { cmd: string[] }[];
    expect(guards.map((g) => g.cmd.join(' '))).toContain(
      'bash scripts/check-no-private-data.sh --all'
    );
  });
});
