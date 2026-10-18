// Which red jobs of a Dependabot pull request main was already red on.
//
// A pull_request run tests the branch merged into main as main stood when the
// run started, and its checks never refresh. A Dependabot pull request opened
// on a red main fails on jobs its change never reached, and its armed
// auto-merge cannot fire until main is fixed and the branch rebased. So for a
// Dependabot pull request only, a job that failed on the pull request and on
// main's latest finished run is inherited, and does not fail the aggregator.
// A job that failed on the pull request and did anything else on main fails
// it, and so does every red job on a pull request a person opened.

const DEPENDABOT = 'dependabot[bot]';

/** A baseline older than this says nothing about main as it stands. */
const MAX_BASELINE_AGE_DAYS = 7;
const MAX_BASELINE_AGE_MS = MAX_BASELINE_AGE_DAYS * 24 * 60 * 60 * 1000;

/**
 * The jobs whose pull request run is already judged against the base, by
 * workflow job id. On a pull request the advisory scan fails only for an
 * advisory the head lockfile adds and the base lacks, while on main it fails
 * for any open advisory. Red on both says main has an advisory and this change
 * adds another, which is not inheritance, so such a job is never excused.
 */
const JUDGED_AGAINST_BASE = ['rust-advisories'];

function judgedAgainstBase(name, names) {
  return JUDGED_AGAINST_BASE.includes(jobIdOf(name, names));
}

/** A run whose jobs read as main's state. Cancelled or skipped runs never finished. */
const FINISHED = ['success', 'failure'];

/**
 * The newest run that passed or failed, or null. `runs` is newest first, each
 * with status and conclusion, as `gh run list` prints them.
 */
function baselineRun(runs) {
  return (
    (runs ?? []).find((run) => run.status === 'completed' && FINISHED.includes(run.conclusion)) ??
    null
  );
}

/**
 * The verdict on each job that failed on the pull request.
 *
 * @param {object} input
 * @param {string} input.author the pull request's author
 * @param {string[]} input.failed the names of the jobs that failed on the pull request
 * @param {{completedAt: string, jobs: Record<string, string>} | null} input.main
 *   main's baseline run: when it finished and each job's conclusion by name
 * @param {number} input.now the time to judge the baseline's age against, in ms
 * @param {Record<string, string>} [input.names] each job id's displayed name
 * @returns {{rows: {job: string, main: string, verdict: 'inherited' | 'fail'}[],
 *   passed: boolean, note: string}}
 */
function judgeAgainstMain({ author, failed, main, now, names = {} }) {
  let note;
  if (author !== DEPENDABOT) note = 'a pull request a person opened is judged strictly';
  else if (main == null) note = 'main has no finished run to judge against';
  else if (now - Date.parse(main.completedAt) > MAX_BASELINE_AGE_MS) {
    note = `main's latest finished run, ${main.completedAt}, is older than ${MAX_BASELINE_AGE_DAYS} days`;
  }
  const excusable = note === undefined;
  const rows = failed.map((job) => {
    const onMain = main?.jobs?.[job] ?? 'absent';
    return {
      job,
      main: onMain,
      verdict:
        excusable && onMain === 'failure' && !judgedAgainstBase(job, names) ? 'inherited' : 'fail',
    };
  });
  return {
    rows,
    passed: rows.every((row) => row.verdict === 'inherited'),
    note: note ?? `judged against main's run that finished ${main.completedAt}`,
  };
}

/**
 * The workflow job id a job's displayed name belongs to, or undefined. A
 * matrix leg reads `Name (leg)` and a called workflow's job `id / Name`.
 */
function jobIdOf(name, names) {
  return Object.keys(names).find((id) => {
    const shown = names[id];
    return name === shown || name.startsWith(`${shown} (`) || name.startsWith(`${shown} / `);
  });
}

/**
 * The aggregator's failures left once inherited jobs are dropped. A failure is
 * `{job, result, message}` by workflow job id. One is dropped only when it
 * ended `failure` and every red leg of it read on the pull request is
 * inherited; a skip, a cancel, a job with no red leg read and a job already
 * judged against the base stay.
 */
function excuseFailures(failures, rows, names) {
  return failures.filter((failure) => {
    if (failure.result !== 'failure') return true;
    if (JUDGED_AGAINST_BASE.includes(failure.job)) return true;
    const legs = rows.filter((row) => jobIdOf(row.job, names) === failure.job);
    return legs.length === 0 || legs.some((row) => row.verdict !== 'inherited');
  });
}

/** The verdicts as a markdown table for the step summary. */
function summaryTable({ rows, note }) {
  const lines = ['### Red jobs judged against main', '', note, ''];
  if (rows.length === 0) return [...lines, 'No job failed.', ''].join('\n');
  lines.push('| Job | On main | Verdict |', '| --- | --- | --- |');
  for (const row of rows) lines.push(`| ${row.job} | ${row.main} | ${row.verdict} |`);
  return [...lines, ''].join('\n');
}

module.exports = {
  DEPENDABOT,
  MAX_BASELINE_AGE_DAYS,
  baselineRun,
  judgeAgainstMain,
  jobIdOf,
  excuseFailures,
  summaryTable,
};
