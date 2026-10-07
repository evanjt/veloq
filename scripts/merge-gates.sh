#!/bin/sh
set -e

# The name of the gate that failed, for a lander asking whether its target
# fails the same one. `land-branch.sh` hands over the file and reads it back,
# so its verdict rests on an exit code and a name, not on scraping the output.
step=''
record_failure() {
  code=$?
  [ "$code" -eq 0 ] || [ -z "${VELOQ_GATE_REPORT:-}" ] || echo "$step" >"$VELOQ_GATE_REPORT"
}
trap record_failure EXIT

# The whole-tree battery a merge is gated on. `land-branch.sh` runs it in the
# landing tree on each candidate before the target moves, with the target it
# was built on as `VELOQ_MERGE_BASE`, and `pre-merge-commit` runs it for a plain
# merge that makes a commit. One battery, so the two paths cannot drift apart.
#
# Not the full pre-commit battery: a merge has already had its branch gated,
# and two minutes on every merge would be paid to re-run what the branch ran.
# Lint is one thing a merge can break that neither side did, since a warning
# can come of the two sides together and each branch only ever linted its own. The other
# is a suite: a reader changed on one side against a test written on the other
# merges clean and fails after, twice now, both times in Rust. So the suites
# the merge touched run here, and only those, because a full run is two minutes
# and every landing waits on this one battery.
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
# radius had no gate at all. The landing tree links `veloqrs` to its own
# module, so `tsc` there judges the bindings the candidate carries, and it is
# incremental (`tsconfig.json` sets `incremental` and `tsBuildInfoFile`), so it
# is seconds warm. It goes before the suites so a merge fails on the cheap
# check.
# Lint over the tree this merge commits rather than the one on disk. `npm run
# lint` globs the working tree, and `pre-merge-commit` runs in whichever
# checkout is merging, so when every worktree merged into the main one, one
# session's unsaved warning failed every merge anyone attempted, on a file the
# merge had never touched.
step=lint
./scripts/check-merge-lint.sh
step=tsc
npx tsc -b
# The format half of `npm run audit`, scoped to the merge. `format:check` globs
# the working tree, and when every worktree merged into the main checkout, one
# session's unformatted file there failed every merge anyone attempted, on a
# file the merge had never touched. The guards after it judge the index too,
# through `scripts/lib/indexedSources.mjs`: an unsaved file in a shared
# checkout is content to a disk walk, and fails a merge that never touched it. Only the
# guards that check the environment (module link, worktree config, cargo config
# reach), the installed packages, the tracematch submodule, the generated-file
# drift checks and the unchecked-index compiler run read the disk, and each says
# so in its own file. A test fails a guard that reads the disk and does not.
step=format
./scripts/check-merge-format.sh
step=guards
npm run audit:guards
# The guards judge the merged tree, and a branch can add personal data and
# delete it again, which leaves the tree clean and the blob in main's history.
step=private-data
./scripts/check-no-private-data.sh --merge
step=rustfmt
(cd modules/veloqrs/rust && cargo fmt -p veloqrs -- --check)
# The test tree, which nothing else builds. `cargo check` of the library passes
# when the only caller of a deleted method is a test, and the suite run below is
# scoped to what the merge touched, so a deletion on one branch and its caller on
# another combine here and nowhere earlier. Cargo drops a suite whose
# `required-features` are off from `--tests` without a word, and nearly every suite
# in both crates is gated on `synthetic`, so the feature is named. This is a
# compile check only: running the synthetic suites stays off locally. The commit
# gate stays featureless and fast.
step=rust-test-tree
(cd modules/veloqrs/rust && cargo check --tests -p veloqrs --features synthetic)
(cd modules/veloqrs/rust && cargo check --tests -p tracematch --features synthetic)
step=suites
./scripts/check-merge-tests.sh
