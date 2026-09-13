#!/bin/sh
set -e

# The whole-tree battery a merge is gated on. It is here rather than inside
# `pre-merge-commit` because git runs that hook only for a merge that creates a
# commit, and a fast-forward runs `post-merge` instead, after the fact (S30).
# One battery, so the two paths cannot drift apart.
#
# Not the full pre-commit battery: a merge has already had its branch gated,
# and two minutes on every merge would be paid to re-run what the branch ran.
# The ceiling is one thing a merge can break that neither side did, since it is
# a whole-tree total and each branch only ever counted its own files. The other
# is a suite: a reader changed on one side against a test written on the other
# merges clean and fails after, twice now, both times in Rust. So the suites
# the merge touched run here, and only those, because a full run is two minutes
# and every worktree merges through this one checkout.
#
# The whole-tree guards are the third thing, and the one that gated nothing
# until B332. A worktree runs no hooks, so a branch commit made in one never
# saw them, and the merge back was the only chokepoint left. They are 15 s for
# all fifteen against the tens of seconds this already spends, and they run
# before the suites so a violation fails on the cheap check.
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
# The lint ratchet, over the tree this merge commits rather than the one on
# disk. `npm run lint` globs the working tree, and every worktree merges into
# this one checkout, so one session's unsaved warning failed every merge anyone
# attempted, on a file the merge had never touched, with the ceiling sitting
# exactly on the count so nothing absorbed it.
./scripts/check-merge-lint.sh
npx tsc --noEmit
# The format half of `npm run audit`, scoped to the merge. `format:check` globs
# the working tree, and every worktree merges into this one checkout, so one
# session's unformatted file failed every merge anyone attempted, on a file the
# merge had never touched. The guards after it stay whole-tree: that is B332's
# point and they fail on content, not on a half-typed line.
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
