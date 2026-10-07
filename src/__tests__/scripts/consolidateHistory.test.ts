/**
 * Scenario: a history since a base tag is consolidated onto a branch of at
 * most a fixed number of commits, and rebuilt again as merges land. A slicing
 * done once by hand went stale within two days and could not be topped up.
 *
 * Expected behaviour: the branch holds no more than the cap, its tree is the
 * tip's, no commit is dated before its parent, no commit pins a submodule
 * pointer a fresh clone cannot fetch, and the commit map places every source
 * commit. A second build after more merges keeps every earlier commit, and a
 * build that fails a check leaves the branch where it was.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/consolidate-history.mjs');
const SUBMODULE = 'vendor/press';
const AREAS = ['orchard/rows', 'cellar/casks', 'shed/tools'];

function git(cwd: string, args: string[], date?: string): string {
  const dates = date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {};
  return execFileSync('git', args, {
    cwd,
    env: { ...gitFreeEnv(), ...dates },
    encoding: 'utf8',
  }).trim();
}

function write(root: string, path: string, contents: string) {
  const full = join(root, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents);
}

/** A time on the given day of March, in a fixed zone. */
function at(day: number, hour: number, minute = 0): string {
  const dd = String(day).padStart(2, '0');
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return `2026-03-${dd}T${hh}:${mm}:00+0100`;
}

interface Fixture {
  root: string;
  app: string;
  pointers: { published: string[]; unpublished: string };
  merges: number;
  harvestMerge: string;
  harvestCommits: string[];
}

/**
 * The submodule's upstream holds three published commits on main and one on a
 * branch the clone never fetched, so no remote ref there reaches it.
 */
function submoduleUpstream(root: string) {
  const upstream = join(root, 'press');
  mkdirSync(upstream);
  git(upstream, ['init', '-q', '-b', 'main']);
  git(upstream, ['config', 'commit.gpgsign', 'false']);
  const published: string[] = [];
  for (const n of [1, 2, 3]) {
    write(upstream, 'press.txt', `press ${n}\n`);
    git(upstream, ['add', '-A']);
    git(upstream, ['commit', '-q', '-m', `Press ${n}`], at(1, n));
    published.push(git(upstream, ['rev-parse', 'HEAD']));
  }
  git(upstream, ['checkout', '-q', '-b', 'draft']);
  write(upstream, 'press.txt', 'press draft\n');
  git(upstream, ['add', '-A']);
  git(upstream, ['commit', '-q', '-m', 'Press draft'], at(1, 5));
  const unpublished = git(upstream, ['rev-parse', 'HEAD']);
  return { upstream, published, unpublished };
}

function pin(app: string, sha: string) {
  git(app, ['update-index', '--add', '--cacheinfo', `160000,${sha},${SUBMODULE}`]);
}

function mergeTopic(app: string, name: string, day: number, hour: number, edit: () => void) {
  git(app, ['checkout', '-q', '-b', name, 'main']);
  edit();
  git(app, ['add', '-A']);
  git(app, ['commit', '-q', '-m', `Tend ${name}`], at(day, hour));
  git(app, ['checkout', '-q', 'main']);
  git(app, ['merge', '-q', '--no-ff', '-m', `Merge ${name}`, name], at(day, hour));
}

function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'consolidate-history-'));
  const { upstream, published, unpublished } = submoduleUpstream(root);

  const app = join(root, 'app');
  mkdirSync(app);
  git(app, ['init', '-q', '-b', 'main']);
  git(app, ['config', 'commit.gpgsign', 'false']);
  // The clone git keeps for a checkout's submodule, holding only what the
  // upstream's main published.
  const clone = join(app, '.git', 'modules', SUBMODULE);
  mkdirSync(clone, { recursive: true });
  git(clone, ['init', '-q', '--bare']);
  git(clone, ['fetch', '-q', upstream, '+refs/heads/main:refs/remotes/origin/main']);

  for (const area of AREAS) write(app, `${area}/ledger.txt`, 'start\n');
  // An unpopulated submodule is an empty directory, which `git add -A` leaves
  // alone; a missing one it would stage as deleted.
  mkdirSync(join(app, SUBMODULE), { recursive: true });
  git(app, ['add', '-A']);
  pin(app, published[0]);
  git(app, ['commit', '-q', '-m', 'Plant orchard'], at(1, 8));
  git(app, ['tag', '0.1.0']);

  let merges = 0;
  let harvestMerge = '';
  let harvestCommits: string[] = [];
  for (let k = 0; k < 30; k++) {
    const day = 2 + Math.floor(k / 4);
    const hour = 9 + (k % 4) * 2;
    const area = AREAS[k % AREAS.length];
    if (k === 15) {
      // A long branch merged in one commit, in an area of its own.
      git(app, ['checkout', '-q', '-b', 'harvest', 'main']);
      harvestCommits = [];
      for (const [n, when] of [at(day, 13, 20), at(day, 13, 40), at(day, 14)].entries()) {
        // The last commit changes another area, so the one before ends a run.
        write(app, `${n === 2 ? 'cellar/casks' : 'barn/bins'}/crate-${n}.txt`, `crate ${n}\n`);
        git(app, ['add', '-A']);
        git(app, ['commit', '-q', '-m', `Fill crate ${n}`], when);
        harvestCommits.push(git(app, ['rev-parse', 'HEAD']));
      }
      git(app, ['checkout', '-q', 'main']);
      git(app, ['merge', '-q', '--no-ff', '-m', 'Merge harvest', 'harvest'], at(day, hour));
      harvestMerge = git(app, ['rev-parse', 'HEAD']);
      merges++;
      continue;
    }
    mergeTopic(app, `topic-${k}`, day, hour, () => {
      write(app, `${area}/entry-${k}.txt`, `entry ${k}\n`.repeat(k + 1));
      if (k === 10) pin(app, published[1]);
      // The last merge of a day pins a pointer nobody published, and the first
      // of the next day moves it on, so the natural end of that day cannot be
      // a run's end.
      if (k === 23) pin(app, unpublished);
      if (k === 24) pin(app, published[2]);
    });
    merges++;
    if (k === 12) {
      // A commit straight onto main carrying an older date, as a cherry-pick does.
      write(app, 'shed/tools/late.txt', 'late\n');
      git(app, ['add', '-A']);
      git(app, ['commit', '-q', '-m', 'Oil hinges'], at(day - 2, 7));
    }
  }
  return {
    root,
    app,
    pointers: { published, unpublished },
    merges,
    harvestMerge,
    harvestCommits,
  };
}

function addMerges(fixture: Fixture, count: number, firstDay: number) {
  for (let n = 0; n < count; n++) {
    mergeTopic(fixture.app, `later-${n}`, firstDay + n, 10, () => {
      write(fixture.app, `${AREAS[n % AREAS.length]}/later-${n}.txt`, `later ${n}\n`);
    });
  }
}

interface Run {
  status: number;
  stdout: string;
  stderr: string;
}

function consolidate(
  fixture: Fixture,
  extra: string[] = [],
  unwrap: string | null = fixture.harvestMerge
): Run {
  const args = [
    SCRIPT,
    '--base',
    '0.1.0',
    '--tip',
    'main',
    '--run-map',
    join(fixture.root, 'runs.tsv'),
    '--commit-map',
    join(fixture.root, 'commit-map.txt'),
    ...(unwrap ? ['--unwrap', unwrap] : []),
    ...extra,
  ];
  try {
    const stdout = execFileSync('node', args, {
      cwd: fixture.app,
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const failed = error as { status: number; stdout: string; stderr: string };
    return { status: failed.status, stdout: failed.stdout, stderr: failed.stderr };
  }
}

function branchCommits(app: string): string[] {
  const out = git(app, ['rev-list', '--reverse', '0.1.0..consolidation']);
  return out ? out.split('\n') : [];
}

function expectConsolidated(fixture: Fixture, cap: number) {
  const { app } = fixture;
  const consolidated = branchCommits(app);
  expect(consolidated.length).toBeGreaterThan(0);
  expect(consolidated.length).toBeLessThanOrEqual(cap);

  expect(git(app, ['rev-parse', 'consolidation^{tree}'])).toBe(
    git(app, ['rev-parse', 'main^{tree}'])
  );

  let previous = git(app, ['log', '-1', '--format=%at %ct', '0.1.0']).split(' ').map(Number);
  for (const sha of consolidated) {
    expect(git(app, ['log', '-1', '--format=%P', sha]).split(' ')).toHaveLength(1);
    const dates = git(app, ['log', '-1', '--format=%at %ct', sha]).split(' ').map(Number);
    expect(dates[0]).toBeGreaterThanOrEqual(previous[0]);
    expect(dates[1]).toBeGreaterThanOrEqual(previous[1]);
    previous = dates;
    const pointer = git(app, ['ls-tree', sha, SUBMODULE]).split(/\s+/)[2];
    expect(fixture.pointers.published).toContain(pointer);
    const message = git(app, ['log', '-1', '--format=%B', sha]);
    expect(message).not.toContain('\n');
    expect(message).not.toMatch(/^Merge /);
  }

  const source = git(app, ['rev-list', '0.1.0..main']).split('\n').sort();
  const map = readFileSync(join(fixture.root, 'commit-map.txt'), 'utf8').trim().split('\n');
  expect(map[0]).toMatch(/^old\s+new$/);
  const rows = map.slice(1).map((line) => line.split(' '));
  expect(rows.map(([old]) => old)).toEqual(source);
  for (const [, consolidatedSha] of rows) expect(consolidated).toContain(consolidatedSha);
}

describe('consolidate-history', () => {
  it('slices the history into at most the cap with the tip tree, ordered dates and every commit mapped', () => {
    const fixture = buildFixture();
    const run = consolidate(fixture, ['--max', '8', '--reserve', '2']);
    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
    expect(branchCommits(fixture.app).length).toBeLessThanOrEqual(6);
    expectConsolidated(fixture, 8);
  });

  it('keeps every earlier commit when it runs again after more merges', () => {
    const fixture = buildFixture();
    expect(consolidate(fixture, ['--max', '8', '--reserve', '2']).status).toBe(0);
    const first = branchCommits(fixture.app);

    addMerges(fixture, 5, 12);
    const again = consolidate(fixture, ['--max', '8', '--reserve', '2']);
    expect(again.stderr).toBe('');
    expect(again.status).toBe(0);
    const second = branchCommits(fixture.app);
    expect(second.slice(0, first.length)).toEqual(first);
    expect(second.length).toBeGreaterThan(first.length);
    expectConsolidated(fixture, 8);
  });

  it('reopens only the last run once the cap is spent', () => {
    const fixture = buildFixture();
    expect(consolidate(fixture, ['--max', '4', '--reserve', '0']).status).toBe(0);
    const first = branchCommits(fixture.app);
    expect(first).toHaveLength(4);

    addMerges(fixture, 5, 12);
    expect(consolidate(fixture, ['--max', '4', '--reserve', '0']).status).toBe(0);
    const second = branchCommits(fixture.app);
    expect(second).toHaveLength(4);
    expect(second.slice(0, 3)).toEqual(first.slice(0, 3));
    expectConsolidated(fixture, 4);
  });

  it('takes a message edited in the run map and keeps the commits before it', () => {
    const fixture = buildFixture();
    const runMap = join(fixture.root, 'runs.tsv');
    expect(consolidate(fixture, ['--max', '8', '--reserve', '2']).status).toBe(0);
    const first = branchCommits(fixture.app);

    const rows = readFileSync(runMap, 'utf8').split('\n');
    const third = rows.findIndex((line) => line && !line.startsWith('#')) + 2;
    const fields = rows[third].split('\t');
    rows[third] = [...fields.slice(0, 3), 'Prune rows, rack cider'].join('\t');
    writeFileSync(runMap, rows.join('\n'));

    expect(consolidate(fixture, ['--max', '8', '--reserve', '2']).status).toBe(0);
    const second = branchCommits(fixture.app);
    expect(second.slice(0, 2)).toEqual(first.slice(0, 2));
    expect(second[2]).not.toBe(first[2]);
    expect(git(fixture.app, ['log', '-1', '--format=%s', second[2]])).toBe(
      'Prune rows, rack cider'
    );
    expectConsolidated(fixture, 8);
  });

  it('is unchanged by a second run with nothing new', () => {
    const fixture = buildFixture();
    expect(consolidate(fixture, ['--max', '8', '--reserve', '2']).status).toBe(0);
    const first = branchCommits(fixture.app);
    expect(consolidate(fixture, ['--max', '8', '--reserve', '2']).status).toBe(0);
    expect(branchCommits(fixture.app)).toEqual(first);
  });

  it('walks the unwrapped branch so its commits can end runs', () => {
    const fixture = buildFixture();
    expect(consolidate(fixture, ['--max', '99', '--reserve', '0']).status).toBe(0);
    const ends = readFileSync(join(fixture.root, 'runs.tsv'), 'utf8')
      .split('\n')
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.split('\t')[0]);
    expect(ends).toContain(fixture.harvestCommits[1]);
    expectConsolidated(fixture, 99);
  });

  it('never ends a run inside a merged branch it was not told to unwrap', () => {
    const fixture = buildFixture();
    const wide = ['--max', '99', '--reserve', '0'];
    // Unwrapping a commit that is not a merge on the walk is refused outright.
    expect(consolidate(fixture, wide, fixture.harvestCommits[0]).status).not.toBe(0);

    expect(consolidate(fixture, wide, null).status).toBe(0);
    const ends = readFileSync(join(fixture.root, 'runs.tsv'), 'utf8')
      .split('\n')
      .map((line) => line.split('\t')[0]);
    for (const commit of fixture.harvestCommits) expect(ends).not.toContain(commit);
    expectConsolidated(fixture, 99);
  });

  it('refuses a tip pinning a pointer no ref reaches and leaves the branch', () => {
    const fixture = buildFixture();
    expect(consolidate(fixture, ['--max', '8', '--reserve', '2']).status).toBe(0);
    const before = git(fixture.app, ['rev-parse', 'consolidation']);
    const runMap = readFileSync(join(fixture.root, 'runs.tsv'), 'utf8');

    mergeTopic(fixture.app, 'draft-press', 12, 10, () =>
      pin(fixture.app, fixture.pointers.unpublished)
    );
    const run = consolidate(fixture, ['--max', '8', '--reserve', '2']);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain(fixture.pointers.unpublished);
    expect(git(fixture.app, ['rev-parse', 'consolidation'])).toBe(before);
    expect(readFileSync(join(fixture.root, 'runs.tsv'), 'utf8')).toBe(runMap);
  });

  it('refuses a range that carries a track file and writes no branch', () => {
    const fixture = buildFixture();
    mergeTopic(fixture.app, 'survey-file', 12, 10, () =>
      write(fixture.app, 'orchard/survey.gpx', '<gpx/>\n')
    );
    const run = consolidate(fixture, ['--max', '8', '--reserve', '2']);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('orchard/survey.gpx');
    expect(git(fixture.app, ['branch', '--list', 'consolidation'])).toBe('');
  });
});
