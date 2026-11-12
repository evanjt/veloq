#!/bin/sh
# The merge battery, run from a job's own worktree against the range the job
# would land, so a failure the landing tree would report is found before the
# job reports done.
#
# `merge-gates.sh` is the one battery a landing runs. It judges the committed
# range between a merge base and HEAD, so a job's uncommitted work is taken
# through a temporary commit, undone on exit with the index put back as it was.
# The branch's history and its working tree are left as they were found.
#
# Run in the main checkout or the landing tree it would read other sessions'
# work or race a landing, so it refuses both.
#
# VELOQ_MERGE_BASE names the base; unset, it is the merge base with `main`.
# LANG, JEST_WORKERS and CARGO_BUILD_JOBS default to what the gate runs with.
set -e

top=$(git rev-parse --show-toplevel)
cd "$top"

git_dir=$(git rev-parse --absolute-git-dir)
common_dir=$(git rev-parse --path-format=absolute --git-common-dir)
if [ "$git_dir" = "$common_dir" ]; then
  echo "job-gates: refusing to run in the main checkout. Run it from a job worktree." >&2
  exit 2
fi
case "$top" in
  *-landing | *-landing/*)
    echo "job-gates: refusing to run in the landing tree, which a landing reserves." >&2
    exit 2
    ;;
esac

base=${VELOQ_MERGE_BASE:-$(git merge-base HEAD main)} || true
if [ -z "$base" ]; then
  echo "job-gates: no merge base with main. Set VELOQ_MERGE_BASE." >&2
  exit 2
fi

export LANG=en_AU.UTF-8
export JEST_WORKERS=${JEST_WORKERS:-12}
export CARGO_BUILD_JOBS=${CARGO_BUILD_JOBS:-16}

head=$(git rev-parse HEAD)
snapshot=''
restore() {
  if [ -n "$snapshot" ]; then
    git reset -q --mixed "$head"
    git read-tree "$index"
  fi
  rm -f "$report"
}
report=$(mktemp)
trap restore EXIT
trap 'exit 130' INT TERM

if [ -n "$(git status --porcelain)" ]; then
  index=$(git write-tree)
  git add -A
  git -c user.name=job -c user.email=job@invalid -c commit.gpgsign=false \
    commit -q --no-verify -m 'job gates snapshot'
  snapshot=1
fi

if VELOQ_MERGE_BASE=$base VELOQ_GATE_REPORT=$report sh scripts/merge-gates.sh; then
  echo "job-gates: every gate passed against $base."
  exit 0
fi
echo "job-gates: failed at step: $(cat "$report")" >&2
exit 1
