#!/bin/bash
# Make the landing tree able to judge the candidate checked out in it.
#
#   provision-landing-tree.sh <landing tree> <main checkout> [<branch tree>]
#
# A worktree comes with an empty engine submodule, so cargo cannot load the
# workspace, and with no `node_modules`, or a whole-directory link whose
# `veloqrs` is the main checkout's module, so `tsc` judges bindings the
# candidate does not carry. Either way a gate passes or fails on another tree's
# code. `land-branch.sh` runs this after every candidate it builds, because the
# candidate decides the engine pin and a previous landing may have left a
# different one.
#
# Re-runnable, and it leaves alone what is already right, so the warm `target/`
# and everything ignored survive. What it cannot provide it refuses, naming
# what is missing, so the landing stops before a gate runs.
set -euo pipefail

TREE=${1:?usage: provision-landing-tree.sh <landing tree> <main checkout> [<branch tree>]}
MAIN=${2:?usage: provision-landing-tree.sh <landing tree> <main checkout> [<branch tree>]}
BRANCH_TREE=${3:-}

# A hook exports these and they beat `-C`, which would point every call below
# at the repository that ran the hook.
unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
unset GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX

say() { echo "provision: $*" >&2; }

# True when `dir` is the top of a repository of its own. An empty submodule
# directory has no `.git`, and git run there resolves to the superproject, so
# a checkout meant for the engine would move the landing tree instead.
own_repository() {
  local dir=$1 top
  [ -e "$dir/.git" ] || return 1
  top=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null) || return 1
  [ "$(cd "$top" && pwd -P)" = "$(cd "$dir" && pwd -P)" ]
}

# Every submodule the candidate pins, checked out at that pin. The objects come
# from a clone already on this disk: the main checkout's, then the branch's own
# worktree, which is where a branch that moves the pin made its engine commit.
provision_submodules() {
  [ -f "$TREE/.gitmodules" ] || return 0
  local path pin sub source
  while read -r _ path; do
    pin=$(git -C "$TREE" ls-tree HEAD -- "$path" | awk '$2 == "commit" {print $3}')
    [ -n "$pin" ] || continue
    sub="$TREE/$path"

    if ! own_repository "$sub"; then
      source="$MAIN/$path"
      if ! own_repository "$source"; then
        say "$path is empty here, and $source holds no clone to take it from."
        say "check the submodule out in the main checkout, then land again."
        return 1
      fi
      rm -rf "$sub"
      git clone -q --no-checkout "$source" "$sub"
    fi

    if ! git -C "$sub" cat-file -e "$pin^{commit}" 2>/dev/null; then
      for source in "$MAIN/$path" ${BRANCH_TREE:+"$BRANCH_TREE/$path"}; do
        own_repository "$source" || continue
        git -C "$sub" fetch -q "$source" '+HEAD:refs/landing/head' '+refs/heads/*:refs/landing/heads/*' \
          2>/dev/null || true
        git -C "$sub" cat-file -e "$pin^{commit}" 2>/dev/null && break
      done
    fi
    if ! git -C "$sub" cat-file -e "$pin^{commit}" 2>/dev/null; then
      say "the candidate pins $path at $pin, and no clone on this disk holds it."
      say "commit it in the main checkout's $path, or the branch's own, then land again."
      return 1
    fi

    if [ "$(git -C "$sub" rev-parse HEAD 2>/dev/null)" != "$pin" ] ||
      [ -n "$(git -C "$sub" status --porcelain)" ]; then
      git -C "$sub" checkout -q --force --detach "$pin"
      git -C "$sub" clean -fdq
    fi
  done < <(git -C "$TREE" config -f .gitmodules --get-regexp '^submodule\..*\.path$' || true)
}

# One link per package of the main checkout's install, so nothing is installed
# or patched here, and `veloqrs` pointed at this tree's own module, so `tsc` and
# the bindings check read the candidate. A whole-directory link would make that
# one entry the main checkout's, and repointing it would repoint the install.
provision_modules() {
  local there="$MAIN/node_modules" here="$TREE/node_modules" entry
  [ -d "$there" ] || return 0
  if [ -L "$here" ]; then
    rm "$here"
  fi
  mkdir -p "$here"
  for entry in "$there"/* "$there"/.[!.]*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    entry=$(basename "$entry")
    [ "$entry" != veloqrs ] || continue
    [ -e "$here/$entry" ] || [ -L "$here/$entry" ] || ln -s "$there/$entry" "$here/$entry"
  done
  if [ -d "$TREE/modules/veloqrs" ] &&
    [ "$(readlink "$here/veloqrs" 2>/dev/null)" != "$TREE/modules/veloqrs" ]; then
    rm -rf "$here/veloqrs"
    ln -s "$TREE/modules/veloqrs" "$here/veloqrs"
  fi
}

# The hooks a worktree has only once `npm run prepare` has made `.husky/_`.
# After the submodule, because `prepare` links the engine's own hooks too.
provision_hooks() {
  [ -f "$TREE/package.json" ] || return 0
  [ ! -d "$TREE/.husky/_" ] || return 0
  grep -q '"prepare"' "$TREE/package.json" || return 0
  (cd "$TREE" && npm run --silent prepare >/dev/null)
}

provision_submodules
provision_modules
provision_hooks
