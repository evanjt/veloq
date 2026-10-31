// Which gate runs on main a tagged sha has to pass before a release publishes it.
//
// A tag starts Release, and neither Test nor the E2E gate runs for a tag: both
// run on a push to main. The gate is a job of build.yml, which builds the
// production app the gate tests, so build.yml's push run is the gate's verdict.
// A sha whose gate failed on main reaches the stores unless the release reads
// those runs for the same sha first. The decision is here;
// scripts/check-main-gates.mjs fetches the runs and waits on them.

/** The workflow files whose push run on main must conclude success for the sha. */
const GATES = ['test.yml', 'build.yml'];

/**
 * Judges each gate on the newest push run of the sha on main.
 *
 * `runs` maps each gate file to the runs the workflow runs endpoint returned
 * for the sha. A gate with no run is missing, one still going is pending, and
 * one whose newest run did not conclude success is failed, named by its run.
 *
 * @param {Record<string, {status: string, conclusion: string | null, created_at: string, html_url: string}[]>} runs
 * @returns {{failed: string[], pending: string[], missing: string[]}}
 */
function judgeMainGates(runs) {
  const verdict = { failed: [], pending: [], missing: [] };
  for (const gate of GATES) {
    const newest = [...(runs[gate] ?? [])].sort(
      (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
    )[0];
    if (newest === undefined) verdict.missing.push(gate);
    else if (newest.status !== 'completed') verdict.pending.push(gate);
    else if (newest.conclusion !== 'success') {
      verdict.failed.push(`${gate} run ${newest.html_url} concluded ${newest.conclusion}`);
    }
  }
  return verdict;
}

module.exports = { GATES, judgeMainGates };
