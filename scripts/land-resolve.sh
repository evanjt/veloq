#!/bin/sh
# Settles a build's merge that conflicts at a landing, in the landing's own
# tree, so the build lands in this batch instead of going back for a new job.
# `docket land` runs it with the merge in progress. Exit 0 with every path
# staged keeps the build in the batch, and `scripts/land-gate.sh` then judges
# the merged tree as it judges any other. Anything else leaves the build out
# as a conflict for the lead.
#
# A conflict sent back cost a whole new job and a second wait in the landing
# queue, by which time the base had moved again.
#
# DOCKET_LAND_ITEM, DOCKET_LAND_BRANCH, DOCKET_LAND_FILES and DOCKET_LAND_BASE
# are set by `docket land`. VELOQ_RESOLVE_MODEL picks the model.
set -eu
export LANG=en_AU.UTF-8
cd "$(git rev-parse --show-toplevel)"

scripts/provision-job-tree.sh >/dev/null

model=${VELOQ_RESOLVE_MODEL:-claude-sonnet-5-5}
brief="You are finishing a git merge in $(pwd). The build for docket item $DOCKET_LAND_ITEM, on branch $DOCKET_LAND_BRANCH, is being merged onto main at $DOCKET_LAND_BASE and conflicts in:
$DOCKET_LAND_FILES

Resolve every conflicted file so that both sides' changes survive: read each side's commits (git log -p $DOCKET_LAND_BASE..$DOCKET_LAND_BRANCH -- <file>, and the commits main gained since the branch's merge base) to learn what each change meant. Where both sides add to a list, keep both entries. Where both sides renumber the same thing (a schema version, a migration number), take the next free number and renumber the branch's side. Then git add each resolved file.

Check the result: npx tsc -b for TypeScript, and cargo check --tests -p veloqrs --features synthetic from modules/veloqrs/rust for Rust. Run the Jest suites or Rust tests of the conflicted files if they are tests.

Rules: do not commit, do not run git merge --abort, git reset, git checkout or git stash, and change no file the merge did not conflict in unless a check you ran needs it. If you cannot tell what one side meant, stop and leave that file unstaged. Read AGENTS.md files only for the directories you touch."

timeout 20m claude -p "$brief" --model "$model" --effort medium --dangerously-skip-permissions </dev/null

if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
  echo "resolve: paths are still unmerged"
  exit 1
fi
newline='
'
IFS=$newline
for file in $DOCKET_LAND_FILES; do
  [ -f "$file" ] || continue
  if grep -Eq '^(<<<<<<<|>>>>>>>)( |$)' "$file"; then
    echo "resolve: $file still holds conflict markers"
    exit 1
  fi
done
