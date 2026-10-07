#!/bin/sh
# The suites the merge in progress touched.
#
# Git runs `pre-merge-commit` for a merge that does not conflict, which is
# exactly the case that has twice produced a tree neither branch wrote. Running
# everything is not the answer: every landing runs this in the one landing tree,
# so a full suite serialises every other session's landing behind it.
set -e

# Deleted paths still select their platform checks. A removed Android class or
# iOS resource can break a build even though no source remains at that path.
# The planner reads test targets from the merged tree, so a deleted Rust suite
# cannot name a Cargo target that no longer exists.
#
# From `pre-merge-commit` the merged tree is staged over the old head, so the
# index holds the merge. In the landing tree the candidate is already committed
# and the index matches it, so the same diff is empty. There `land-branch.sh`
# hands over the target the candidate was built on, and the range between is
# what would land. When the lander checks whether the target fails the same
# gate, it selects suites from that same range while running the target's code.
if [ -n "${VELOQ_MERGE_BASE:-}" ]; then
  changed=$(git diff --name-only "$VELOQ_MERGE_BASE" "${VELOQ_MERGE_TEST_REVISION:-HEAD}")
else
  changed=$(git diff --cached --name-only HEAD)
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
