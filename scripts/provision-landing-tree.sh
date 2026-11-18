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

# A directory npm writes into as it adds or removes a package: a scope, whose
# packages it moves in and out, and `.bin`, where it keeps a link per command.
# Linked whole, an `npm install` in this tree would move the main checkout's
# packages into staging directories and leave their places empty.
is_container() {
  case $1 in
    @* | .bin) return 0 ;;
    *) return 1 ;;
  esac
}

# `dst` is a link to `src`, replacing whatever else is there.
link_entry() {
  local src=$1 dst=$2
  if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
    return 0
  fi
  rm -rf "${dst:?}"
  ln -s "$src" "$dst"
}

# `dst` is a real directory of its own holding one link per entry of `src`, and
# nothing `src` lacks. A `.bin` entry is a relative link into a package, which
# resolves here through that package's link, so it is copied as it is.
link_container() {
  local src=$1 dst=$2 entry name
  if [ -L "$dst" ] || { [ -e "$dst" ] && [ ! -d "$dst" ]; }; then
    rm -rf "${dst:?}"
  fi
  mkdir -p "$dst"
  for entry in "$dst"/* "$dst"/.[!.]*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name=$(basename "$entry")
    [ -e "$src/$name" ] || [ -L "$src/$name" ] || rm -rf "${dst:?}/$name"
  done
  for entry in "$src"/* "$src"/.[!.]*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    name=$(basename "$entry")
    if [ "$(basename "$src")" = .bin ] && [ -L "$entry" ]; then
      link_entry "$(readlink "$entry")" "$dst/$name"
    else
      link_entry "$entry" "$dst/$name"
    fi
  done
}

# npm records each installed package's version in `.package-lock.json`. An
# install whose record disagrees with the lockfile serves every tree linked to
# it the wrong packages, so the link is refused before anything moves. A
# record-less install is taken as it is, because nothing records what it holds.
require_current_install() {
  local lock="$MAIN/package-lock.json" record="$MAIN/node_modules/.package-lock.json" stale
  [ -f "$lock" ] && [ -f "$record" ] || return 0
  stale=$(node -e '
    const fs = require("fs");
    const pinned = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).packages || {};
    const installed = JSON.parse(fs.readFileSync(process.argv[2], "utf8")).packages || {};
    for (const [path, entry] of Object.entries(installed)) {
      if (!entry.version) continue;
      const locked = (pinned[path] || {}).version;
      if (locked !== entry.version) {
        console.log(`${path} installed ${entry.version}, lockfile ${locked || "has none"}`);
        process.exit(1);
      }
    }
  ' "$lock" "$record") || {
    say "the main checkout's install does not match its lockfile: $stale"
    say "run npm ci in $MAIN, then provision again."
    return 1
  }
}

# One link per package of the main checkout's install, so nothing is installed
# or patched here, and `veloqrs` pointed at this tree's own module, so `tsc` and
# the bindings check read the candidate. A whole-directory link would make that
# one entry the main checkout's, and repointing it would repoint the install.
#
# A reused tree can hold entries that are not links into that install: links
# into another tree's, a patched copy taken from an older install, a package
# the main checkout has since dropped. Each would serve the packages of another
# lockfile, so every entry that is not exactly the link this makes is replaced,
# and every entry the main checkout's install lacks is removed.
provision_modules() {
  local there="$MAIN/node_modules" here="$TREE/node_modules" entry
  [ -d "$there" ] || return 0
  # A real install, made because the tree's lockfile is not the main
  # checkout's, already holds its own `veloqrs`, and links into it would mix
  # two installs. npm writes `.package-lock.json` into an install it made, and a
  # whole-directory link to the main checkout's shows that file too.
  if [ ! -L "$here" ] && [ -f "$here/.package-lock.json" ] && [ ! -L "$here/.package-lock.json" ]; then
    return 0
  fi
  require_current_install || exit 1
  if [ -L "$here" ]; then
    rm "$here"
  fi
  mkdir -p "$here"
  for entry in "$here"/* "$here"/.[!.]*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    entry=$(basename "$entry")
    [ "$entry" != veloqrs ] || continue
    [ -e "$there/$entry" ] || [ -L "$there/$entry" ] || rm -rf "${here:?}/$entry"
  done
  for entry in "$there"/* "$there"/.[!.]*; do
    [ -e "$entry" ] || [ -L "$entry" ] || continue
    entry=$(basename "$entry")
    [ "$entry" != veloqrs ] || continue
    # npm's own record of what it installed. Linked, a later install here would
    # write the main checkout's copy of it.
    [ "$entry" != .package-lock.json ] || continue
    if [ -d "$there/$entry" ] && [ ! -L "$there/$entry" ] && is_container "$entry"; then
      link_container "$there/$entry" "$here/$entry"
    else
      link_entry "$there/$entry" "$here/$entry"
    fi
  done
  # A link left by an earlier provisioning, before the record was kept out.
  if [ -L "$here/.package-lock.json" ]; then
    rm "$here/.package-lock.json"
  fi
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
