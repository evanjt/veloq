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
# the merge touched run here, and only those: this holds the build lock, so a
# full run would serialise every other session behind it.
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
# rustfmt only parses, so this is seconds against the tens this already spends,
# which matters because it holds the build lock. Scoped to veloqrs because that
# is what this repository's Rust CI builds; tracematch is a submodule and gates
# itself.
npm run lint
# The format half of `npm run audit`, scoped to the merge. `format:check` globs
# the working tree, and every worktree merges into this one checkout, so one
# session's unformatted file failed every merge anyone attempted, on a file the
# merge had never touched. The guards after it stay whole-tree: that is B332's
# point and they fail on content, not on a half-typed line.
./scripts/check-merge-format.sh
npm run audit:guards
(cd modules/veloqrs/rust && cargo fmt -p veloqrs -- --check)
./scripts/check-merge-tests.sh
