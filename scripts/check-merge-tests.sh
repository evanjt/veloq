#!/bin/sh
# The suites the merge in progress touched.
#
# Git runs `pre-merge-commit` for a merge that does not conflict, which is
# exactly the case that has twice produced a tree neither branch wrote. Running
# everything is not the answer: every worktree merges into one checkout and this
# runs inside the merge, holding the merge lock, so a full suite serialises
# every other session's merge behind it.
set -e

# `--diff-filter=d` drops what the merge removed: a deleted suite names a
# `--test` target cargo no longer has, and cargo refuses the whole command
# rather than skipping it, so one deletion blocks every merge that carries it.
# A deletion is still gated, by `cargo check --tests` in `merge-gates.sh`,
# which is what catches a caller left behind.
#
# Before the ref moves, from `pre-merge-commit`, the merged tree is staged over
# the old head, so the index holds the merge. After a fast-forward, from
# `post-merge`, HEAD has moved and the index matches it, so the same diff is
# empty or holds only another session's staged files. There the hook hands over
# the head it moved from, and the range between is what landed.
if [ -n "${VELOQ_MERGE_BASE:-}" ]; then
  changed=$(git diff --name-only --diff-filter=d "$VELOQ_MERGE_BASE" HEAD)
else
  changed=$(git diff --cached --name-only --diff-filter=d HEAD)
fi
[ -n "$changed" ] || exit 0

plan=$(mktemp)
trap 'rm -f "$plan"' EXIT
printf '%s\n' "$changed" | npx tsx scripts/plan-merge-tests.ts > "$plan"

# Read from a file, not a pipe: a `while` on the right of a pipe runs in a
# subshell, where a failing suite cannot fail this script and the merge lands
# anyway.
while IFS= read -r line; do
  [ -n "$line" ] || continue
  echo "merge gate: $line"
  eval "$line"
done < "$plan"
