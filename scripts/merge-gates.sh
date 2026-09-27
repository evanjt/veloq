#!/bin/sh
set -e

# The whole battery runs holding one lock, so a commit made in this checkout
# while it runs is refused rather than carrying the merged tree away under its
# own subject; `scripts/check-commit-lock.sh` is the refusal. Re-run itself under
# the lock rather than a subshell, so the lock is held for the gates and
# released the moment they end, whatever they exit with. The guard variable is
# what stops that re-run looping and, with it, what would otherwise be this
# script waiting on its own lock: a lock is held per open file description, so a
# second take blocks on the first.
#
# `-n`, never a blocking take. A merge wrapped in this lock by hand makes the
# hook's child wait on the lock its own parent holds, and it waits for ever: one
# such merge sat 22 minutes with no output, and because the merged tree is in
# the shared index by then, every other worktree's merge was refused with "your
# local changes would be overwritten". Refusing is loud and costs a retry; the
# deadlock is silent and cost an hour.
if [ -z "${VELOQ_MERGE_LOCK_HELD:-}" ] && command -v flock >/dev/null 2>&1; then
  lock_dir="/tmp/claude-$(id -u)"
  [ -d "$lock_dir" ] || lock_dir="/tmp"
  lock="${VELOQ_COMMIT_LOCK:-$lock_dir/veloq-commit.lock}"
  VELOQ_MERGE_LOCK_HELD=1
  export VELOQ_MERGE_LOCK_HELD
  # `-E 66` so a lock that cannot be taken is told apart from a gate that
  # failed: plain `flock -n` exits 1 for both. Not `exec`, because the message
  # below has to survive the run. 66 is what leaves here too, because the
  # callers need the same distinction: flattening it to 1 is what made
  # `post-merge` shout THE GATES FAIL over another session's merge and offer a
  # `git reset --hard` on a tree that passed every gate.
  code=0
  flock -n -E 66 "$lock" "$0" "$@" || code=$?
  if [ "$code" -eq 66 ]; then
    cat >&2 <<MSG
The commit lock is held, so these gates cannot run.

Either another merge in this checkout is running its gates, in which case wait
for it and merge again, or this merge was wrapped in the lock itself:

  flock $lock git merge <branch>    <- never this

The hook takes the lock for you. Merge with plain git and nothing waits on
itself.
MSG
    exit 66
  fi
  exit "$code"
fi

# The whole-tree battery a merge is gated on. It is here rather than inside
# `pre-merge-commit` because git runs that hook only for a merge that creates a
# commit, and a fast-forward runs `post-merge` instead, after the fact.
# One battery, so the two paths cannot drift apart.
#
# Not the full pre-commit battery: a merge has already had its branch gated,
# and two minutes on every merge would be paid to re-run what the branch ran.
# Lint is one thing a merge can break that neither side did, since a warning
# can come of the two sides together and each branch only ever linted its own. The other
# is a suite: a reader changed on one side against a test written on the other
# merges clean and fails after, twice now, both times in Rust. So the suites
# the merge touched run here, and only those, because a full run is two minutes
# and every worktree merges through this one checkout.
#
# The whole-tree guards are the third thing. A worktree without hooks never
# ran them on its branch commits, so the merge back is the chokepoint. They run
# in one process at once (scripts/run-guards.mjs, about 4 s), and before the
# suites, so a violation fails on the cheap check.
# The fourth thing, and the same shape as the third. `pre-commit` gates the
# staged Rust it is handed, but a worktree runs no hooks until `npm run
# prepare`, so the branch commits a merge carries were never offered to it. The
# staged-file gate cannot stand in here either: a merge stages nothing of its
# own, so it would find no files and pass. The crate is the question at a merge.
# rustfmt only parses, so this is seconds against the tens this already spends.
# Scoped to veloqrs because that is what this repository's Rust CI builds;
# tracematch is a submodule and gates itself.
#
# The fifth thing is the typecheck, and it is here because nowhere else has it.
# `tsc` is skippable at `run-gates.sh`, eleven of thirteen worktrees run no
# `pre-commit` to skip it in, and the documented fallback is a CI workflow that
# fires on a push to main, which nothing here is: the window was 187 commits
# deep when this was found. So a type error outside `--onlyChanged`'s blast
# radius had no gate at all. It runs in the main checkout, which is the only
# tree where `tsc` resolves `veloqrs` to the module a bundle would ship, and it
# is incremental (`tsconfig.json` sets `incremental` and `tsBuildInfoFile`), so
# it is seconds warm. It goes before the suites so a merge fails on the cheap
# check.
# Lint over the tree this merge commits rather than the one on disk. `npm run
# lint` globs the working tree, and every worktree merges into this one
# checkout, so one session's unsaved warning failed every merge anyone
# attempted, on a file the merge had never touched.
./scripts/check-merge-lint.sh
npx tsc --noEmit
# The format half of `npm run audit`, scoped to the merge. `format:check` globs
# the working tree, and every worktree merges into this one checkout, so one
# session's unformatted file failed every merge anyone attempted, on a file the
# merge had never touched. The guards after it stay whole-tree, because they
# fail on content, not on a half-typed line.
./scripts/check-merge-format.sh
npm run audit:guards
(cd modules/veloqrs/rust && cargo fmt -p veloqrs -- --check)
# The test tree, which nothing else builds. `cargo check` of the library passes
# when the only caller of a deleted method is a test, and the suite run below is
# scoped to what the merge touched, so a deletion on one branch and its caller on
# another combine here and nowhere earlier. Warm it is 0.2 s; the cold 1 m 10 s
# is paid once per target directory and only after Rust has changed.
(cd modules/veloqrs/rust && cargo check --tests -p veloqrs)
./scripts/check-merge-tests.sh
