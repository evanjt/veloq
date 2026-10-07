// The outcome a sha was already measured at, read from the run history.
//
// An Actions cache entry is evicted after seven days or sooner under a full
// store, so a weekly schedule cannot keep its record there. Workflow runs keep
// for ninety days and reading them does not shorten that.

const MEASURING_STEP = 'Run tests with coverage';

/**
 * The conclusion of the newest earlier run whose measuring step finished as
 * `success` or `failure`, or null when no run measured the sha. A run whose
 * step was skipped or cancelled measured nothing, so a skip that reported red
 * never becomes the record and a cancelled measurement is tried again. The
 * current run is ignored.
 *
 * `runs` is each run's id, creation time and jobs, each job's steps with
 * their name and conclusion.
 */
function earlierOutcome(runs, currentRunId, stepName = MEASURING_STEP) {
  const measured = runs
    .filter((run) => String(run.id) !== String(currentRunId))
    .map((run) => ({
      at: Date.parse(run.created_at),
      conclusion: (run.jobs ?? [])
        .flatMap((job) => job.steps ?? [])
        .find((step) => step.name === stepName && ['success', 'failure'].includes(step.conclusion))
        ?.conclusion,
    }))
    .filter((run) => run.conclusion !== undefined)
    .sort((a, b) => b.at - a.at);
  return measured[0]?.conclusion ?? null;
}

module.exports = { earlierOutcome, MEASURING_STEP };
