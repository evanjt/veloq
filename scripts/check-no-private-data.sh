#!/usr/bin/env bash
# Refuse to stage personal activity data.
#
# A real routes.db was committed here once. gitignore did not stop it, because
# gitignore does not apply to files git already tracks and does nothing against
# `git add -f`. This runs against the index, which is the last point where the
# data can still be kept out.
#
# Removing such a file later does not undo it: the blob stays retrievable by SHA
# from any pull request ref, and those cannot be deleted by the repository owner.
#
# The index is only one way in. A worktree runs no hooks until `npm run
# prepare`, a landing merges with hooks off, and CI stages nothing, so the same
# rules also judge the whole tree, a list of paths and every commit of a range.
#
# Usage:
#   check-no-private-data.sh                 the staged paths, for pre-commit
#   check-no-private-data.sh --all           every tracked path, for the gates and CI
#   check-no-private-data.sh --range REV...  every path a commit in the range added or
#                                            changed, so a file deleted again later still
#                                            counts. REV... is what `git log` takes.
#   check-no-private-data.sh --merge         the range a merge brings in, for the merge
#                                            gates: VELOQ_MERGE_BASE..HEAD after a
#                                            fast-forward, HEAD..MERGE_HEAD before a
#                                            merge commit
#   check-no-private-data.sh --stdin         the paths on stdin, one per line

set -euo pipefail

# Git quotes a path holding a non-ASCII byte by default, and the quotes hide the
# extension and the directory from every rule below. The corpus names its files
# after the activity, so that is the common case, not the odd one.
git() { command git -c core.quotePath=off "$@"; }

# Reads NUL-separated paths and writes them one per line. Git still quotes a
# path holding a quote, backslash, tab or newline unless it is read with -z, and
# the quoted form hides the extension and directory from every rule below. A
# newline inside a path cannot be written one per line, so such a path is refused.
lines() {
  local path
  while IFS= read -r -d '' path; do
    case "$path" in
      *$'\n'*)
        echo "check-no-private-data: refusing a path that holds a newline" >&2
        exit 1
        ;;
    esac
    printf '%s\n' "$path"
  done
}

# Every path a commit in the range added or changed. A merge commit lists none
# by default, so a file added while resolving one would pass unseen.
range_paths() {
  git log -z --name-only --format= --diff-filter=ACMR --diff-merges=first-parent "$@" | lines | sort -u
}

case "${1:-}" in
  "")
    staged="$(git diff --cached -z --name-only --diff-filter=ACMR | lines)"
    hint="Unstage with: git restore --staged <path>"
    ;;
  --all)
    staged="$(git ls-files -z | lines)"
    hint="Stop tracking with: git rm --cached <path>, and check whether it was pushed"
    ;;
  --range)
    shift
    staged="$(range_paths "$@")"
    hint="These commits carry it, so rewrite them before this range goes anywhere"
    ;;
  --merge)
    # The whole-tree guard sees the merged tip only, so a branch that added a
    # file and deleted it again would put the blob into main's history unseen.
    if [ -n "${VELOQ_MERGE_BASE:-}" ]; then
      staged="$(range_paths "$VELOQ_MERGE_BASE..HEAD")"
    elif git rev-parse -q --verify MERGE_HEAD >/dev/null; then
      staged="$(range_paths HEAD..MERGE_HEAD)"
    else
      exit 0
    fi
    hint="The merged branch carries it, so rewrite the branch before landing it"
    ;;
  --stdin)
    staged="$(cat)"
    hint="Keep these paths out of the repository"
    ;;
  *)
    echo "check-no-private-data: unknown argument $1" >&2
    exit 2
    ;;
esac
[ -n "$staged" ] || exit 0

blocked="$(echo "$staged" |
  grep -iE '\.(gpx|fit|tcx|kml|plt)(\.(gz|bz2|xz|zip))?$' || true)"

# Databases, except the reviewable SQL fixtures, which are demo data by
# construction and are guarded by their own test.
blocked="$blocked
$(echo "$staged" | grep -iE '\.(db|sqlite3?)(\.(gz|bz2|xz|zip))?$' || true)"

# Anything under a private/ directory, whatever it is called.
blocked="$blocked
$(echo "$staged" | grep -E '(^|/)private/' || true)"

# Maestro captures, which land under screenshots/ or, from a flow that forgot
# the directory, in the repository root. The store shots under docs/ are ours.
blocked="$blocked
$(echo "$staged" | grep -iE '^screenshots/|^[^/]+\.png$' || true)"

blocked="$(echo "$blocked" | grep -v '^$' | sort -u || true)"

if [ -n "$blocked" ]; then
  echo "Refusing to commit personal activity data or captures:" >&2
  echo "$blocked" | sed 's/^/  /' >&2
  echo >&2
  echo "This data cannot be taken back once pushed. A committed blob stays" >&2
  echo "retrievable by SHA through pull request refs, which survive branch" >&2
  echo "deletion and history rewriting." >&2
  echo >&2
  echo "$hint" >&2
  echo "Test fixtures belong in SQL text (see tests/fixtures/v12_demo.sql)." >&2
  exit 1
fi
