#!/bin/sh
# The suites the merge in progress touched.
#
# Git runs `pre-merge-commit` for a merge that does not conflict, which is
# exactly the case that has twice produced a tree neither branch wrote. Running
# everything is not the answer: every worktree merges into one checkout under a
# build lock and this runs inside the merge, so a full suite serialises every
# other session behind it.
set -e

changed=$(git diff --cached --name-only HEAD)
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
