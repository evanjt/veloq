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
lock_dir="${VELOQ_LOCK_DIR:-/tmp/claude-$(id -u)}"
[ -d "$lock_dir" ] || lock_dir="/tmp"

# Say what happened, on the last line, whatever happened.
#
# The merge is the last thing this script does, so its status used to be the
# script's and that was taken to be enough. It is not: every agent pipes this
# through `tail` for readability, and a pipeline's status is the last command's,
# so `tail`'s 0 is what gets reported. A merge that lost the `update_ref` race
# then reads as success, and what is on screen is the hook battery's PASS lines,
# which are printed before the ref moves and so appear on the losing path too.
# `audit/b786-5751` was reported merged that way and was not.
#
# An outcome line survives the pipe, so its absence is the signal.
status=0
"$here/with-repo-locks.sh" "$lock_dir/veloq-merge.lock" -- \
  git merge --no-ff --no-edit "$branch" || status=$?

head=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
if [ "$status" -eq 0 ]; then
  echo "merge-audit-branch: $branch -> $head"
else
  echo "merge-audit-branch: $branch NOT MERGED, HEAD is still $head" >&2
  echo "merge-audit-branch: git exited $status. Check content, not reachability:" >&2
  echo "  git show HEAD:<a file the branch touched> | grep <a symbol it added>" >&2
fi
exit "$status"
