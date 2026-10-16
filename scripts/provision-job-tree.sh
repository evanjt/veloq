#!/bin/bash
# Make a new job worktree ready from what this machine already has.
#
#   provision-job-tree.sh        run in the job's worktree
#
# A job tree starts bare. Each job ran `npm ci`, and the bindings check in its
# gates compiled the debug engine into the tree's own target directory, so
# forty trees at one commit were forty installs and forty compiles of one
# engine, which drove a 32-core host to a load of 800 and out of swap. Here the
# tree is provisioned as the landing tree is (the engine submodule at its pin,
# one link per package of the main checkout's install with `veloqrs` its own,
# the hooks), and the machine's engine library cache is filled for the tree's
# Rust source, so a tree whose change never touches Rust compiles none.
#
# The main checkout's install serves only a tree on the same lockfile. A tree
# on another, or beside a main checkout with no install, installs its own.
set -euo pipefail

unset GIT_DIR GIT_INDEX_FILE GIT_WORK_TREE GIT_OBJECT_DIRECTORY GIT_COMMON_DIR
unset GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_PREFIX

say() { echo "provision: $*" >&2; }

SCRIPTS=$(cd "$(dirname "$0")" && pwd -P)
TREE=$(git rev-parse --show-toplevel)
TREE=$(cd "$TREE" && pwd -P)
COMMON=$(git -C "$TREE" rev-parse --path-format=absolute --git-common-dir)
MAIN=$(cd "$(dirname "$COMMON")" && pwd -P)

if [ "$MAIN" = "$TREE" ]; then
  say "this is the main checkout, nothing to provision."
  exit 0
fi

# Two absent lockfiles agree, one absent does not.
same_lockfile() {
  local here="$TREE/package-lock.json" there="$MAIN/package-lock.json"
  if [ ! -e "$here" ] && [ ! -e "$there" ]; then return 0; fi
  cmp -s "$here" "$there"
}

own_install() {
  [ -f "$TREE/node_modules/.package-lock.json" ] && [ ! -L "$TREE/node_modules/.package-lock.json" ]
}

if ! own_install; then
  if [ ! -d "$MAIN/node_modules" ]; then
    say "$MAIN has no install to link, so this tree installs its own."
    say "run npm ci in $MAIN to spare the next tree."
    rm -rf "$TREE/node_modules"
    (cd "$TREE" && npm ci)
  elif ! same_lockfile; then
    say "this tree's lockfile is not the main checkout's, so it installs its own."
    rm -rf "$TREE/node_modules"
    (cd "$TREE" && npm ci)
  fi
fi

"$SCRIPTS/provision-landing-tree.sh" "$TREE" "$MAIN"

# Not fatal: the bindings check builds what is missing, under the same lock.
if ! "$TREE/modules/veloqrs/scripts/host-library.sh" >/dev/null; then
  say "could not fill the engine library cache; the bindings check will build the engine."
fi
