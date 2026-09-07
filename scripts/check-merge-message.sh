#!/usr/bin/env sh
# Refuse an ordinary commit made while a merge is in progress.
#
# Every worktree merges into the one main checkout, so the index there is
# shared. A session that stages its own files and runs `git commit` with no
# pathspec commits the whole index, and if another session left a merge
# staged it concludes that merge under the wrong subject and bundles the
# other session's files in. That is `fb644030`: a banner fix that came out as
# a merge commit carrying five files of tile-slot work.
#
# The commit that finishes a merge says so, because git's own message starts
# with "Merge". Anything else committed with MERGE_HEAD set is a session
# finishing a merge it did not start.

set -u

message_file="${1:-}"
[ -n "$message_file" ] || exit 0
[ -f "$message_file" ] || exit 0

git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 || exit 0

# The subject is the first line that is neither blank nor one of git's own
# comment lines, which is what the editor path prepends.
subject="$(grep -v '^#' "$message_file" | sed '/^[[:space:]]*$/d' | head -n 1)"

case "$subject" in
  Merge*) exit 0 ;;
esac

echo "Refusing to commit: there is a merge in progress and this is not it." >&2
echo >&2
echo "  subject: $subject" >&2
echo >&2
echo "The index is shared with every worktree that merges into this checkout," >&2
echo "so a commit with no pathspec commits whatever another session staged." >&2
echo "If the merge is yours, finish it with git's own message. If it is not," >&2
echo "leave it: check .git/MERGE_HEAD's timestamp and wait." >&2
exit 1
