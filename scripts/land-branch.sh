#!/bin/bash
# Land a branch on the current branch, gated, without losing the ref race.
#
# Every worktree merges back through the one checkout, and a `git merge` there
# holds its gates for minutes. Another session's merge lands inside that window,
# `update_ref` fails, and the loser leaves its merged tree staged against a
# `HEAD` that has moved, which refused every other session's merge for about
# ninety minutes on 2026-09-15. Building the merge elsewhere and fast-forwarding
# fixed that, but the gates then ran after the ref moved, so a candidate with a
# failing suite reached the target before anything could refuse it.
#
# So the candidate is built and gated in one persistent landing tree beside the
# main checkout, provisioned as a real tree: the engine submodule at the
# candidate's pin, its own `veloqrs` link and a warm `target/`. Only a candidate
# that passed is fast-forwarded onto, and a target that moved meanwhile is
# merged in and the new candidate gated again. The checkout's only racing step
# is a ref move, and it lands over another session's staged and unsaved files
# as long as the two do not touch the same path.
set -euo pipefail

BRANCH=${1:-}
if [ -z "$BRANCH" ]; then
  echo "usage: land-branch.sh <branch>" >&2
  exit 2
fi

SCRIPTS=$(cd "$(dirname "$0")" && pwd)
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

# Another session's merge stopped on a conflict leaves `MERGE_HEAD`, and git
# refuses every merge in the checkout until it is concluded. Retrying cannot
# get past it, and the retries used to run for seventeen minutes and end by
# blaming the target moving, which pointed the lander at a merge that is not
# theirs to finish or abort.
refuse_merge_in_progress() {
  local merge_head
  merge_head="$(git -C "$CHECKOUT" rev-parse --absolute-git-dir)/MERGE_HEAD"
  [ -e "$merge_head" ] || return 0
  local modified age
  modified=$(stat -c %Y "$merge_head" 2>/dev/null || stat -f %m "$merge_head")
  age=$(( $(date +%s) - modified ))
  if [ "$age" -lt 120 ]; then age="$age s"; else age="$((age / 60)) min"; fi
  echo "land-branch: $CHECKOUT has a merge in progress, and git refuses to land anything over it." >&2
  echo "land-branch: MERGE_HEAD is $age old and names:" >&2
  echo "land-branch:   $(git -C "$CHECKOUT" log --oneline -1 "$(cat "$merge_head")")" >&2
  echo "land-branch: it is not this session's to finish or abort. Wait for its owner to" >&2
  echo "land-branch: conclude it, then land again." >&2
  exit 1
}
refuse_merge_in_progress

# A worktree's hooks live in `.husky/_`, which is git-ignored and made only by
# `npm run prepare`, so a tree where that never ran commits with no gates at
# all. Landing is the one step every branch passes, so the lander hears it here.
# A warning, not a refusal: the candidate is gated below either way.
branch_tree=$(git -C "$CHECKOUT" worktree list --porcelain |
  awk -v ref="branch refs/heads/$BRANCH" '/^worktree /{tree = substr($0, 10)} $0 == ref {print tree}')
if [ -n "$branch_tree" ] && [ ! -d "$branch_tree/.husky/_" ]; then
  echo "land-branch: warning: $branch_tree has no .husky/_, so the commits made there ran no gates." >&2
  echo "land-branch: run 'npm run prepare' in that tree before committing there again." >&2
fi

# How long to keep trying the fast-forward while other sessions move the ref.
# Overridable so a test does not sleep and a quiet machine does not wait.
ATTEMPTS=${VELOQ_LAND_ATTEMPTS:-40}
SLEEP=${VELOQ_LAND_SLEEP:-25}
# What makes the tree able to judge its candidate. Overridable so a test can
# hold a landing mid-provisioning, or make provisioning fail.
PROVISION=${VELOQ_LAND_PROVISION:-$SCRIPTS/provision-landing-tree.sh}

# One tree per repository, beside the main checkout whichever worktree lands:
# under the directory that holds it, because cargo resolves `.cargo/config.toml`
# from the working directory's ancestors, so a tree outside builds with a
# different job count, no compiler cache and no `TRACEMATCH_CORPUS`.
MAIN=$(dirname "$(git -C "$CHECKOUT" rev-parse --path-format=absolute --git-common-dir)")
LANDING="$(dirname "$MAIN")/$(basename "$MAIN")-landing"
RESERVATION="$LANDING.owner"

# The tree is reset, provisioned, merged into and gated, and two landings doing
# that at once would gate one candidate and land the other. So the reservation
# is taken before anything touches the tree and held to the last ref move.
# `mkdir` is the atomic step: exactly one of two contenders creates it. A held
# one is refused at once, never waited on, and never taken over on the strength
# of a dead pid or an age: whether a child still works in the tree cannot be
# read off either, so a person checks and removes it.
refuse_reserved() {
  echo "land-branch: the landing tree $LANDING is held by another landing, so nothing was done." >&2
  echo "land-branch: its reservation is $RESERVATION" >&2
  if [ -s "$RESERVATION/owner" ]; then
    sed 's/^/land-branch:   /' "$RESERVATION/owner" >&2
  else
    echo "land-branch: it has no owner record, so its landing died before writing one or is writing it now." >&2
  fi
  echo "land-branch: land again once that landing ends. If nothing is landing, and no gate or build" >&2
  echo "land-branch: it started still runs in $LANDING, remove it by hand: rm -r $RESERVATION" >&2
  exit 1
}

reserved=0
release() {
  [ "$reserved" = 1 ] || return 0
  rm -rf "$RESERVATION"
}
trap release EXIT
# A signal ends the landing through the EXIT trap, which bash runs once the
# command in the foreground has stopped, so the reservation outlives every gate
# and build this landing started. Only SIGKILL leaves it behind.
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$RESERVATION" 2>/dev/null || refuse_reserved
reserved=1
{
  echo "pid=$$"
  echo "host=$(hostname)"
  echo "started=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "branch=$BRANCH"
  echo "target=$TARGET"
  echo "checkout=$CHECKOUT"
} >"$RESERVATION/owner.partial"
mv "$RESERVATION/owner.partial" "$RESERVATION/owner"

# A landing tree whose `.git` is gone would hand every `git -C` below to the
# repository above it, and a hard reset there is somebody's documents.
landing_is_ours() {
  local top
  top=$(git -C "$LANDING" rev-parse --show-toplevel 2>/dev/null) || return 1
  [ "$(cd "$top" && pwd -P)" = "$(cd "$LANDING" && pwd -P)" ]
}

# The tree on the target as it stands, whatever the last landing left in it.
# Untracked files go, ignored ones stay: those are `target/`, `node_modules`
# and the hooks, which are what keeping one tree is for.
reset_landing() {
  local base=$1
  if [ ! -e "$LANDING" ]; then
    git -C "$MAIN" worktree prune
    git -C "$MAIN" worktree add -q --detach "$LANDING" "$base"
    return
  fi
  if ! landing_is_ours; then
    echo "land-branch: $LANDING exists and is not a worktree of $MAIN, so it was left alone." >&2
    echo "land-branch: move it aside, and the next landing makes the tree afresh." >&2
    exit 1
  fi
  git -C "$LANDING" merge --abort >/dev/null 2>&1 || true
  git -C "$LANDING" reset -q --hard "$base"
  git -C "$LANDING" clean -fdq
}

# The merges are made with the hooks off, since the battery is run below,
# explicitly, against the base the candidate was built on.
merge_into_landing() {
  if ! git -C "$LANDING" -c core.hooksPath=/dev/null merge -q --no-ff "$1" -m "$2"; then
    git -C "$LANDING" merge --abort >/dev/null 2>&1 || true
    return 1
  fi
}

provision() {
  if ! "$PROVISION" "$LANDING" "$MAIN" "$branch_tree"; then
    echo "land-branch: the landing tree could not be provisioned, so no gate ran and $TARGET was not moved." >&2
    exit 1
  fi
}

# The battery, from the candidate itself, with the target it was built on as the
# base the suite, format and bindings planners diff from. The name of a failing
# gate comes back through a file, not the output.
gate() {
  local base=$1 report=$2 test_revision=${3:-HEAD}
  : >"$report"
  (cd "$LANDING" && VELOQ_MERGE_BASE=$base VELOQ_MERGE_TEST_REVISION=$test_revision VELOQ_GATE_REPORT=$report ./scripts/merge-gates.sh)
}

# A failure the target already carries is not the branch's to fix, and a lander
# told otherwise goes hunting through a branch that is fine. So the target's own
# battery runs in the same tree, and its exit code is the verdict.
judge_against_target() {
  local base=$1 failed=$2 revision=$3 short ours theirs target_report code=0
  short=$(git -C "$CHECKOUT" rev-parse --short "$base")
  ours=$(cat "$failed")
  target_report=$(mktemp)
  echo "land-branch: the gates fail on the candidate, so $TARGET was not moved." >&2
  echo "land-branch: running $TARGET's own gates at $short to see whether it fails them too." >&2
  reset_landing "$base"
  provision
  gate "$base" "$target_report" "$revision" >/dev/null 2>&1 || code=$?
  theirs=$(cat "$target_report")
  rm -f "$target_report"
  if [ "$code" -eq 0 ]; then
    echo "land-branch: the gates pass on $TARGET at $short, so this branch brings the failure." >&2
  elif [ -n "$ours" ] && [ "$ours" = "$theirs" ]; then
    echo "land-branch: the $ours gate fails already on $TARGET at $short, not this branch's." >&2
  elif [ -n "$theirs" ]; then
    echo "land-branch: $TARGET at $short fails its own $theirs gate, not the ${ours:-same} one." >&2
  else
    echo "land-branch: the gates fail already on $TARGET at $short, not this branch's." >&2
  fi
}

# A refused fast-forward that is not the ref moving is usually the wreckage of
# somebody's lost race: their merged tree staged against a `HEAD` that moved,
# with no `MERGE_HEAD`, so `git merge --abort` refuses and it reads like work
# in progress nobody will own. Saying so is the difference between one session
# clearing it in a minute and the fleet hunting the holder for an hour.
report_stranded_index() {
  git -C "$CHECKOUT" diff --cached --quiet && return 0
  [ -e "$(git -C "$CHECKOUT" rev-parse --absolute-git-dir)/MERGE_HEAD" ] && return 0
  echo "land-branch: $CHECKOUT holds a staged tree with no merge in progress." >&2
  echo "land-branch: a merge lost its ref race and left this behind:" >&2
  git -C "$CHECKOUT" diff --cached --name-only | sed 's/^/land-branch:   /' >&2
  echo "land-branch: whoever owns it clears it with 'git reset --hard HEAD' once" >&2
  echo "land-branch: their branch carries the commits. Do not clear another session's." >&2
}

# A landed branch carries no work of its own, so its ref goes with the landing.
# Lower-case `-d`, so git itself refuses a branch that is not merged. A branch a
# worktree still holds cannot be deleted, so the commands that finish with it are
# printed instead. Runs only after the fast-forward succeeded.
delete_landed_branch() {
  local tree
  tree=$(git -C "$CHECKOUT" worktree list --porcelain |
    awk -v ref="branch refs/heads/$BRANCH" '/^worktree /{tree = substr($0, 10)} $0 == ref {print tree}')
  if [ -n "$tree" ]; then
    echo "land-branch: $BRANCH is checked out in $tree, so its ref is kept. Once that worktree is done:"
    echo "land-branch:   git worktree remove $tree"
    echo "land-branch:   git branch -d $BRANCH"
    return 0
  fi
  git -C "$CHECKOUT" branch -d "$BRANCH" >/dev/null ||
    echo "land-branch: git refused to delete $BRANCH, so its ref is kept" >&2
}

# A fast-forward moves the engine pointer and leaves the submodule's working copy where it
# was, so a build from the checkout compiles the superseded engine. Bring a clean one to the
# pin; a dirty one is somebody's work and is named, not touched. An uninitialised directory
# has no `.git`, and git run inside it would answer for the superproject.
sync_engine_submodule() {
  local path=modules/veloqrs/rust/tracematch pinned head
  [ -e "$CHECKOUT/$path/.git" ] || return 0
  pinned=$(git -C "$CHECKOUT" ls-tree HEAD "$path" | awk '{print $3}')
  [ -n "$pinned" ] || return 0
  head=$(git -C "$CHECKOUT/$path" rev-parse HEAD)
  [ "$head" != "$pinned" ] || return 0
  if [ -n "$(git -C "$CHECKOUT/$path" status --porcelain)" ]; then
    echo "land-branch: $path holds uncommitted changes and sits at ${head:0:9}, not the pin ${pinned:0:9}; a build there compiles the wrong engine until it is cleaned and checked out at the pin." >&2
    return 0
  fi
  git -C "$CHECKOUT/$path" -c advice.detachedHead=false checkout -q "$pinned" ||
    echo "land-branch: could not check $path out at the pin ${pinned:0:9}; run git submodule update --checkout $path" >&2
}

base=$(git -C "$CHECKOUT" rev-parse HEAD)
"$SCRIPTS/check-retired-history.sh" "$base" "$BRANCH" || {
  echo "land-branch: $BRANCH was not landed" >&2
  exit 1
}
reset_landing "$base"
if ! merge_into_landing "$BRANCH" "Merge branch '$BRANCH'"; then
  echo "land-branch: $BRANCH conflicts with $TARGET, resolve it on the branch" >&2
  exit 1
fi
MERGE=$(git -C "$LANDING" rev-parse --short HEAD)

report=$(mktemp)
trap 'rm -f "$report"; release' EXIT
needs_gate=1
attempt=1
while [ "$attempt" -le "$ATTEMPTS" ]; do
  candidate=$(git -C "$LANDING" rev-parse HEAD)
  if [ "$needs_gate" = 1 ]; then
    provision
    if ! gate "$base" "$report"; then
      judge_against_target "$base" "$report" "$candidate"
      exit 1
    fi
    needs_gate=0
  fi

  # `post-merge` reads this to tell a gated landing from a bare fast-forward.
  if VELOQ_LANDING_GATED=$candidate git -C "$CHECKOUT" merge --ff-only "$candidate"; then
    echo "landed $BRANCH at $MERGE, $TARGET now $(git -C "$CHECKOUT" rev-parse --short HEAD)"
    sync_engine_submodule
    delete_landed_branch
    exit 0
  fi
  refuse_merge_in_progress
  report_stranded_index

  # The target moved under the gate. What lands has to be what was gated, so
  # the new head is merged in and that candidate gated from it in turn.
  attempt=$((attempt + 1))
  head=$(git -C "$CHECKOUT" rev-parse HEAD)
  if ! git -C "$LANDING" merge-base --is-ancestor "$head" HEAD; then
    if ! merge_into_landing "$head" "Merge $TARGET into the landing tree"; then
      echo "land-branch: $TARGET has moved into conflict with $BRANCH, resolve it on the branch" >&2
      exit 1
    fi
    base=$head
    needs_gate=1
    continue
  fi
  [ "$SLEEP" = "0" ] || sleep "$SLEEP"
done

echo "land-branch: $TARGET moved under every attempt; nothing was landed" >&2
exit 1
