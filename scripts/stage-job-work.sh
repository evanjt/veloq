#!/bin/sh
# Runs a command with a job's uncommitted work staged in the job's index, then puts the index
# back as it was found, whatever the command's status.
#
# The whole-tree guards read the index. A job whose edits are only on disk is therefore judged
# as its base, passes, and fails at the landing that stages the same edits. Staging everything
# not yet in HEAD (the diff against HEAD plus untracked files) lets the guards see the bytes the
# job will hand over. Nothing is committed, and HEAD is left where it was. The index file is
# copied before and copied back after, so intent-to-add entries and stat data come back exactly.
#
# Usage: scripts/stage-job-work.sh COMMAND [ARGUMENT...]
set -eu

if [ "$#" -lt 1 ]; then
  echo "stage-job-work: usage: stage-job-work.sh COMMAND [ARGUMENT...]" >&2
  exit 2
fi
cd "$(git rev-parse --show-toplevel)"

index_file=$(git rev-parse --git-path index)
saved=$(mktemp)
work=$(mktemp)
cp "$index_file" "$saved"
restore() {
  cp "$saved" "$index_file"
  rm -f "$saved" "$work"
}
trap restore EXIT

{
  git diff --name-only -z HEAD
  git ls-files -z --others --exclude-standard
} >"$work"
if [ -s "$work" ]; then
  xargs -0 git add -A -- <"$work"
fi

"$@"
