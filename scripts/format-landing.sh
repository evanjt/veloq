#!/bin/sh
# Formats, and commits over the batch, the files a landing changed that the
# format check judges. A batch whose merged files differ from prettier's output
# only in layout lands with a format commit on top, rather than going back for
# formatting alone.
#
# Prettier's output is deterministic and carries no judgement, so the gate
# writes it, the way it regenerates the generated files. The commit goes in
# before the other lanes read the tree.
#
# Usage: scripts/format-landing.sh BASE
# BASE is the head the batch merged onto. The files are the ones the range
# BASE..HEAD changed that scripts/format-scope.sh names. The landing tree is
# clean by design, so a staged path is someone else's work: it is refused, not
# committed under this format commit.
set -eu

base=${1:?usage: scripts/format-landing.sh BASE}
cd "$(git rev-parse --show-toplevel)"

changed=$(git -c core.quotePath=off diff --name-only --diff-filter=d "$base" HEAD)
files=$(printf '%s\n' "$changed" | scripts/format-scope.sh)
[ -n "$files" ] || exit 0

staged=$(git diff --cached --name-only)
if [ -n "$staged" ]; then
  echo "format-landing: the landing tree holds staged work, which a format commit would take:"
  printf '%s\n' "$staged" | sed 's/^/  /'
  exit 1
fi

set --
while IFS= read -r path; do
  set -- "$@" "$path"
done <<EOF_FILES
$files
EOF_FILES

node_modules/.bin/prettier --config config/.prettierrc --ignore-path config/.prettierignore \
  --write --log-level warn "$@"

if git diff --quiet -- "$@"; then
  exit 0
fi
git add -- "$@"
git -c core.hooksPath=/dev/null commit --quiet -m 'Format the merged files'
echo "format-landing: formatted the merged files and committed them"
