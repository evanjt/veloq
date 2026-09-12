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

# A merge already standing in this checkout is not this script's to run over.
#
# The lock only serialises callers of this script. An agent merging by hand, or
# a session that predates the lock split and merges under the build lock, holds
# no merge lock at all, so its `MERGE_HEAD` is still there when the next
# scripted merge starts. `git merge` then says "Exiting because of an
# unresolved conflict" and names nothing, and the failure text below is the
# `B288` recovery, which is a different failure: a lost `update_ref` race, not
# a merge sitting unresolved. An agent following it greps for its own symbol,
# does not find it, and the next step from there is `git merge --abort` on
# someone else's merge, or committing their conflict markers under its own
# subject, which is `B511`.
#
# Checked before the lock is taken, so a caller that cannot proceed does not
# hold the merge lock while it waits on a merge that is not using it.
git_dir=$(git rev-parse --git-dir 2>/dev/null || echo .git)
if [ -e "$git_dir/MERGE_HEAD" ]; then
  other=$(git rev-parse --short MERGE_HEAD 2>/dev/null || echo unknown)
  subject=$(git log --oneline -1 MERGE_HEAD 2>/dev/null || echo "unknown commit")
  since=$(find "$git_dir" -maxdepth 1 -name MERGE_HEAD -newermt '-10 minutes' 2>/dev/null)
  echo "merge-audit-branch: $branch NOT MERGED, a merge already in progress" >&2
  echo "merge-audit-branch: this checkout is holding $subject" >&2
  if [ -n "$since" ]; then
    echo "merge-audit-branch: started under ten minutes ago, so it is live" >&2
  else
    echo "merge-audit-branch: over ten minutes old, which may mean abandoned" >&2
  fi
  echo "merge-audit-branch: $other is not yours to finish or abort. Wait for it," >&2
  echo "  and check whose it is before concluding it was abandoned." >&2
  exit 3
fi

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
