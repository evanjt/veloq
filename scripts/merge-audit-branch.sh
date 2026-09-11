#!/usr/bin/env sh
# Merge an audit branch into this checkout, one merge at a time.
#
#   scripts/merge-audit-branch.sh audit/b14
#
# A merge takes the merge lock and nothing else. That is what splitting the
# locks was for: a merge races other merges for `HEAD` for about a second, a
# device build races the Gradle daemon for a quarter of an hour, and the two
# must not queue behind each other. Merging under the build lock is the habit
# that deadlocked the fleet on 2026-09-11.

set -eu

branch="${1:-}"
[ -n "$branch" ] || { echo "merge-audit-branch: name a branch" >&2; exit 2; }

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
lock_dir="/tmp/claude-$(id -u)"
[ -d "$lock_dir" ] || lock_dir="/tmp"

exec "$here/with-repo-locks.sh" "$lock_dir/veloq-merge.lock" -- \
  git merge --no-ff --no-edit "$branch"
