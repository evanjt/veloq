/**
 * Scenario: a pull_request run tests the branch merged into main as main stood
 * when the run started, so a Dependabot pull request opened on a red main
 * fails on jobs its change never reached.
 *
 * Expected behaviour: for a Dependabot pull request, a job red on the pull
 * request and red on main's latest finished run is inherited and does not fail
 * the aggregator. A job green on main, absent from main, or judged against a
 * baseline older than seven days fails it, and so does every red job on a pull
 * request a person opened.
 */

const {
  judgeAgainstMain,
  baselineRun,
  excuseFailures,
  jobIdOf,
  summaryTable,
} = require('../../../scripts/lib/judge-against-main.js');

const DEPENDABOT = 'dependabot[bot]';
const NOW = Date.parse('2026-03-10T12:00:00Z');

function main(jobs: Record<string, string>, completedAt = '2026-03-09T12:00:00Z') {
  return { completedAt, jobs };
}

describe('judgeAgainstMain', () => {
  it('reads a job red on both as inherited and passes', () => {
    const out = judgeAgainstMain({
      author: DEPENDABOT,
      failed: ['Rust Lint'],
      main: main({ 'Rust Lint': 'failure', 'JS Checks': 'success' }),
      now: NOW,
    });
    expect(out.rows).toEqual([{ job: 'Rust Lint', main: 'failure', verdict: 'inherited' }]);
    expect(out.passed).toBe(true);
  });

  it('fails a job green on main and red on the pull request', () => {
    const out = judgeAgainstMain({
      author: DEPENDABOT,
      failed: ['Rust Lint', 'JS Checks'],
      main: main({ 'Rust Lint': 'failure', 'JS Checks': 'success' }),
      now: NOW,
    });
    expect(out.rows).toEqual([
      { job: 'Rust Lint', main: 'failure', verdict: 'inherited' },
      { job: 'JS Checks', main: 'success', verdict: 'fail' },
    ]);
    expect(out.passed).toBe(false);
  });

  it('fails a red job main has no entry for', () => {
    const out = judgeAgainstMain({
      author: DEPENDABOT,
      failed: ['Jest (Pacific/Kiritimati, 1/2)'],
      main: main({ 'Rust Lint': 'failure' }),
      now: NOW,
    });
    expect(out.rows).toEqual([
      { job: 'Jest (Pacific/Kiritimati, 1/2)', main: 'absent', verdict: 'fail' },
    ]);
    expect(out.passed).toBe(false);
  });

  it('fails against a baseline older than seven days', () => {
    const out = judgeAgainstMain({
      author: DEPENDABOT,
      failed: ['Rust Lint'],
      main: main({ 'Rust Lint': 'failure' }, '2026-03-03T11:59:00Z'),
      now: NOW,
    });
    expect(out.rows).toEqual([{ job: 'Rust Lint', main: 'failure', verdict: 'fail' }]);
    expect(out.passed).toBe(false);
    expect(out.note).toContain('older than 7 days');
  });

  it('accepts a baseline just inside seven days', () => {
    const out = judgeAgainstMain({
      author: DEPENDABOT,
      failed: ['Rust Lint'],
      main: main({ 'Rust Lint': 'failure' }, '2026-03-03T12:01:00Z'),
      now: NOW,
    });
    expect(out.passed).toBe(true);
  });

  it('fails when main has no finished run to judge against', () => {
    const out = judgeAgainstMain({
      author: DEPENDABOT,
      failed: ['Rust Lint'],
      main: null,
      now: NOW,
    });
    expect(out.rows).toEqual([{ job: 'Rust Lint', main: 'absent', verdict: 'fail' }]);
    expect(out.passed).toBe(false);
  });

  it('judges a pull request a person opened strictly, even when main is red too', () => {
    const out = judgeAgainstMain({
      author: 'someone',
      failed: ['Rust Lint'],
      main: main({ 'Rust Lint': 'failure' }),
      now: NOW,
    });
    expect(out.rows).toEqual([{ job: 'Rust Lint', main: 'failure', verdict: 'fail' }]);
    expect(out.passed).toBe(false);
  });

  it('does not excuse a job main cancelled or skipped', () => {
    const out = judgeAgainstMain({
      author: DEPENDABOT,
      failed: ['Rust Tests', 'Verify Bindings'],
      main: main({ 'Rust Tests': 'cancelled', 'Verify Bindings': 'skipped' }),
      now: NOW,
    });
    expect(out.rows.map((r: { verdict: string }) => r.verdict)).toEqual(['fail', 'fail']);
  });

  it('passes with nothing failed', () => {
    const out = judgeAgainstMain({ author: 'someone', failed: [], main: null, now: NOW });
    expect(out).toEqual(expect.objectContaining({ rows: [], passed: true }));
  });
});

describe('a job its pull request run already judges against the base', () => {
  const NAMES = { 'rust-lint': 'Rust Lint', 'rust-advisories': 'rust-advisories' };
  const ADVISORIES = 'rust-advisories / Rust Advisories';
  const failure = (job: string) => ({ job, result: 'failure', message: `${job} ended failure` });

  it('fails a Dependabot pull request that adds an advisory while main is red on the scan', () => {
    const verdict = judgeAgainstMain({
      author: DEPENDABOT,
      failed: [ADVISORIES],
      main: main({ [ADVISORIES]: 'failure' }),
      now: NOW,
      names: NAMES,
    });
    expect(verdict.rows).toEqual([{ job: ADVISORIES, main: 'failure', verdict: 'fail' }]);
    expect(verdict.passed).toBe(false);
    const out = excuseFailures([failure('rust-advisories')], verdict.rows, NAMES);
    expect(out.map((f: { job: string }) => f.job)).toEqual(['rust-advisories']);
  });

  it('still excuses a lint job red on both beside it', () => {
    const verdict = judgeAgainstMain({
      author: DEPENDABOT,
      failed: ['Rust Lint', ADVISORIES],
      main: main({ 'Rust Lint': 'failure', [ADVISORIES]: 'failure' }),
      now: NOW,
      names: NAMES,
    });
    expect(verdict.rows).toEqual([
      { job: 'Rust Lint', main: 'failure', verdict: 'inherited' },
      { job: ADVISORIES, main: 'failure', verdict: 'fail' },
    ]);
    const out = excuseFailures(
      [failure('rust-lint'), failure('rust-advisories')],
      verdict.rows,
      NAMES
    );
    expect(out.map((f: { job: string }) => f.job)).toEqual(['rust-advisories']);
  });
});

describe('baselineRun', () => {
  const run = (id: number, status: string, conclusion: string) => ({
    databaseId: id,
    status,
    conclusion,
    updatedAt: '2026-03-09T12:00:00Z',
  });

  it('skips a running, cancelled or superseded run for the newest that passed or failed', () => {
    const runs = [
      run(5, 'in_progress', ''),
      run(4, 'completed', 'cancelled'),
      run(3, 'completed', 'skipped'),
      run(2, 'completed', 'failure'),
      run(1, 'completed', 'success'),
    ];
    expect(baselineRun(runs)?.databaseId).toBe(2);
  });

  it('gives null when no run finished', () => {
    expect(baselineRun([run(1, 'completed', 'cancelled')])).toBeNull();
    expect(baselineRun([])).toBeNull();
  });
});

describe('jobIdOf', () => {
  const NAMES = { jest: 'Jest', 'rust-lint': 'Rust Lint', 'rust-advisories': 'rust-advisories' };

  it('maps a matrix leg and a called workflow to the job that runs them', () => {
    expect(jobIdOf('Jest (America/Los_Angeles, 2/2)', NAMES)).toBe('jest');
    expect(jobIdOf('Rust Lint', NAMES)).toBe('rust-lint');
    expect(jobIdOf('rust-advisories / Rust Advisories', NAMES)).toBe('rust-advisories');
  });

  it('maps a name it does not hold to nothing', () => {
    expect(jobIdOf('Jester', NAMES)).toBeUndefined();
    expect(jobIdOf('CI Required', NAMES)).toBeUndefined();
  });
});

describe('excuseFailures', () => {
  const NAMES = { jest: 'Jest', 'rust-lint': 'Rust Lint', js: 'JS Checks' };
  const failure = (job: string, result = 'failure') => ({
    job,
    result,
    message: `${job} ended ${result}`,
  });

  it('drops a failed job only when every red leg of it is inherited', () => {
    const rows = [
      { job: 'Rust Lint', main: 'failure', verdict: 'inherited' },
      { job: 'Jest (Pacific/Kiritimati, 1/2)', main: 'failure', verdict: 'inherited' },
      { job: 'Jest (Pacific/Kiritimati, 2/2)', main: 'success', verdict: 'fail' },
    ];
    const out = excuseFailures([failure('rust-lint'), failure('jest')], rows, NAMES);
    expect(out.map((f: { job: string }) => f.job)).toEqual(['jest']);
  });

  it('keeps a failed job with no red leg read, a skip, and a cancel', () => {
    const rows = [{ job: 'Rust Lint', main: 'failure', verdict: 'inherited' }];
    const failures = [
      failure('js'),
      failure('rust-lint', 'skipped'),
      failure('rust-lint', 'cancelled'),
    ];
    expect(excuseFailures(failures, rows, NAMES)).toEqual(failures);
  });
});

describe('summaryTable', () => {
  it('names each red job, its result on main and the verdict', () => {
    const table = summaryTable({
      rows: [{ job: 'Rust Lint', main: 'failure', verdict: 'inherited' }],
      note: 'judged against main run 42',
    });
    expect(table).toContain('| Rust Lint | failure | inherited |');
    expect(table).toContain('judged against main run 42');
  });
});
