// Which Dependabot pull requests to ask for a rebase after a green Test on main.
//
// A pull_request run tests the branch merged into main as main stood when the
// run started, and a re-run reuses that merge. A pull request that failed on a
// red main keeps that result after main is fixed, and its armed auto-merge
// cannot fire, until a new commit lands on its branch. `@dependabot rebase`
// gives it one. Updating the branch through the API would too, but Dependabot
// stops maintaining a branch it did not update itself.

const DEPENDABOT_LOGIN = 'app/dependabot';
const REBASE_COMMAND = '@dependabot rebase';
const FAILED = ['failure', 'timed_out', 'startup_failure'];

/** Each run comments at most this many times; the rest wait for the next. */
const MAX_PER_RUN = 5;

function isDependabot(pr) {
  return pr.author?.login === DEPENDABOT_LOGIN;
}

/** A rebase asked for after the run was made, so asking again adds nothing. */
function askedSince(pr, since) {
  const after = Date.parse(since);
  return (pr.comments ?? []).some(
    (comment) => comment.body?.trim() === REBASE_COMMAND && Date.parse(comment.createdAt) >= after
  );
}

/**
 * The numbers of the pull requests to ask for a rebase, oldest first, at most
 * `limit`. One is selected when Dependabot opened it, the latest Test run on
 * its current head finished failed, its branch is behind main, and no rebase
 * has been asked for since that run.
 *
 * `prs` is each open pull request's number, author, head sha, `behindBy` (the
 * commits on main its branch does not hold), comments with body and creation
 * time, and `latestRun`: the newest Test run on its branch, with head sha,
 * status, conclusion and creation time, or null.
 */
function refreshCandidates(prs, limit = MAX_PER_RUN) {
  return prs
    .filter((pr) => {
      const run = pr.latestRun;
      return (
        isDependabot(pr) &&
        run != null &&
        run.headSha === pr.headRefOid &&
        run.status === 'completed' &&
        FAILED.includes(run.conclusion) &&
        pr.behindBy > 0 &&
        !askedSince(pr, run.createdAt)
      );
    })
    .map((pr) => pr.number)
    .sort((a, b) => a - b)
    .slice(0, limit);
}

module.exports = { refreshCandidates, isDependabot, MAX_PER_RUN, REBASE_COMMAND };
