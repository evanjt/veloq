#!/usr/bin/env sh
# Refuse a commit in the main checkout while a merge's gates are running.
#
# Every worktree merges into the one main checkout, and git writes the merged
# tree into that checkout's index before `pre-merge-commit` runs its battery,
# which takes about a minute. A commit made in that window picks the merged
# files up and carries them under its own subject. It has happened: one commit
# took all three of another session's merged files, and nothing warned, because
# there is no `MERGE_HEAD` until the merge commit itself, so the guard that
# refuses a commit during a merge had nothing to refuse.
#
# So the merge gates hold a lock and this refuses while it is held. Only in the
# main checkout: a worktree has an index of its own and cannot pick up another
# tree's merge.
set -eu

# The main checkout is the one whose git directory is the common one. A
# worktree's is `<common>/worktrees/<name>`, so the two differ there.
git_dir=$(git rev-parse --absolute-git-dir 2>/dev/null || echo "")
common_dir=$(cd "$(git rev-parse --git-common-dir 2>/dev/null || echo .)" && pwd)
[ -n "$git_dir" ] || exit 0
[ "$git_dir" = "$common_dir" ] || exit 0

command -v flock >/dev/null 2>&1 || exit 0

# The same fixed-path rule `with-android-build-lock.sh` states: a session with
# a temp directory of its own would take a lock nobody else can see, which is
# the same as no lock at all. The override is for the test that proves this
# serialises.
lock_dir="/tmp/claude-$(id -u)"
[ -d "$lock_dir" ] || lock_dir="/tmp"
lock="${VELOQ_COMMIT_LOCK:-$lock_dir/veloq-commit.lock}"

# `flock -n` on a descriptor of this process alone. Never held across the
# commit: a lock is held per open file description, so a commit made from
# inside something already holding this one would wait on itself.
if flock -n "$lock" true 2>/dev/null; then
  exit 0
fi

cat >&2 <<MSG
A merge is running its gates in this checkout, and its merged tree is already
in the index this commit would use. Committing now takes that merge's files
under your subject.

Wait for it, then commit:

  flock $lock git commit ...

Or commit from a worktree, which has an index of its own. If you are certain
no merge is running, the lock is stale: nothing holds it for longer than a
merge's gates take.
MSG
exit 1
