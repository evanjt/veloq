#!/bin/bash
# Land a branch on the current branch without losing the ref race to the gates.
#
# Every worktree merges back through the one checkout, and `git merge` there
# holds `.husky/pre-merge-commit` for five to eight minutes while
# `scripts/merge-gates.sh` runs. Another session's merge lands inside that
# window, `update_ref` fails, and the loser leaves its merged tree staged
# against a `HEAD` that has moved: no `MERGE_HEAD`, so `git merge --abort`
# refuses, and every other session's merge is then refused for a path neither
# side of it touched. One lost race stops the fleet, which is what it did for
# about ninety minutes on 2026-09-15.
#
# So the merge is built somewhere nothing else can move, and the checkout is
# fast-forwarded onto it. The only step that races is a ref move plus a
# checkout of the files the merge changed, which is a second rather than
# minutes, and it is a fast-forward, so it lands over an index another session
# has staged as long as the two do not touch the same file. A fast-forward
# runs `post-merge`, which runs the same battery and reports after the ref has
# moved (S30), so nothing is skipped.
#
# Never wrap this in the commit lock. `merge-gates.sh` takes that lock itself
# and a flock is held per open file description, so the gates would block on
# the lock their own caller holds (B1057, and B624 one level down).
set -euo pipefail

BRANCH=${1:-}
if [ -z "$BRANCH" ]; then
  echo "usage: land-branch.sh <branch>" >&2
  exit 2
fi

CHECKOUT=$(git rev-parse --show-toplevel)
TARGET=$(git rev-parse --abbrev-ref HEAD)
if ! git rev-parse --verify --quiet "$BRANCH" >/dev/null; then
  echo "land-branch: no such branch: $BRANCH" >&2
  exit 2
fi
if [ "$BRANCH" = "$TARGET" ]; then
  echo "land-branch: $BRANCH is the branch you are on" >&2
  exit 2
fi

# How long to keep trying the fast-forward while other sessions move the ref.
# Overridable so a test does not sleep and a quiet machine does not wait.
ATTEMPTS=${VELOQ_LAND_ATTEMPTS:-40}
SLEEP=${VELOQ_LAND_SLEEP:-25}

# Under the checkout rather than beside it: cargo resolves `.cargo/config.toml`
# from the working directory's ancestors, so a staging tree outside this one
# builds with a different job count and no `TRACEMATCH_CORPUS`.
STAGING="$CHECKOUT/../$(basename "$CHECKOUT")-landing-$$"
cleanup() {
  git -C "$CHECKOUT" worktree remove --force "$STAGING" >/dev/null 2>&1 || true
  git -C "$CHECKOUT" worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

git -C "$CHECKOUT" worktree add --detach "$STAGING" "$(git -C "$CHECKOUT" rev-parse HEAD)" >/dev/null
# The staging tree's own node_modules, so a hook that needs one finds it. One
# symlink, not a copy: nothing is installed or patched here.
if [ -e "$CHECKOUT/node_modules" ] && [ ! -e "$STAGING/node_modules" ]; then
  ln -s "$CHECKOUT/node_modules" "$STAGING/node_modules"
fi

# The gates run on the landed tree through `post-merge`, so running them again
# here would pay for them twice and widen the window this exists to close.
if ! git -C "$STAGING" -c core.hooksPath=/dev/null merge --no-ff "$BRANCH" \
     -m "Merge branch '$BRANCH'"; then
  echo "land-branch: $BRANCH conflicts with $TARGET, resolve it on the branch" >&2
  exit 1
fi
MERGE=$(git -C "$STAGING" rev-parse --short HEAD)

# A refused fast-forward that is not the ref moving is usually the wreckage of
# somebody's lost race: their merged tree staged against a `HEAD` that moved,
# with no `MERGE_HEAD`, so `git merge --abort` refuses and it reads like work
# in progress nobody will own. Saying so is the difference between one session
# clearing it in a minute and the fleet hunting the holder for an hour.
report_stranded_index() {
  git -C "$CHECKOUT" diff --cached --quiet && return 0
  [ -e "$(git -C "$CHECKOUT" rev-parse --git-dir)/MERGE_HEAD" ] && return 0
  echo "land-branch: $CHECKOUT holds a staged tree with no merge in progress." >&2
  echo "land-branch: a merge lost its ref race and left this behind:" >&2
  git -C "$CHECKOUT" diff --cached --name-only | sed 's/^/land-branch:   /' >&2
  echo "land-branch: whoever owns it clears it with 'git reset --hard HEAD' once" >&2
  echo "land-branch: their branch carries the commits. Do not clear another session's." >&2
}

attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  head=$(git -C "$CHECKOUT" rev-parse HEAD)
  if ! git -C "$STAGING" merge-base --is-ancestor "$head" HEAD; then
    if ! git -C "$STAGING" -c core.hooksPath=/dev/null merge "$head" \
         -m "Merge $TARGET into the landing tree"; then
      echo "land-branch: $TARGET has moved into conflict with $BRANCH, resolve it on the branch" >&2
      exit 1
    fi
  fi
  if git -C "$CHECKOUT" merge --ff-only "$(git -C "$STAGING" rev-parse HEAD)"; then
    echo "landed $BRANCH at $MERGE, $TARGET now $(git -C "$CHECKOUT" rev-parse --short HEAD)"
    exit 0
  fi
  report_stranded_index
  attempt=$((attempt + 1))
  [ "$SLEEP" = "0" ] || sleep "$SLEEP"
done

echo "land-branch: $TARGET moved under every attempt; nothing was landed" >&2
exit 1
