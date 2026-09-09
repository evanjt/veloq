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

set -euo pipefail

staged="$(git diff --cached --name-only --diff-filter=ACMR)"
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

blocked="$(echo "$blocked" | grep -v '^$' | sort -u || true)"

if [ -n "$blocked" ]; then
  echo "Refusing to commit personal activity data:" >&2
  echo "$blocked" | sed 's/^/  /' >&2
  echo >&2
  echo "This data cannot be taken back once pushed. A committed blob stays" >&2
  echo "retrievable by SHA through pull request refs, which survive branch" >&2
  echo "deletion and history rewriting." >&2
  echo >&2
  echo "Unstage with: git restore --staged <path>" >&2
  echo "Test fixtures belong in SQL text (see tests/fixtures/v12_demo.sql)." >&2
  exit 1
fi
