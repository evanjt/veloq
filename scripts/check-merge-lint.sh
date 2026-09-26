#!/bin/sh
# The lint ratchet over the tree the merge is about to commit, not the one on
# disk.
#
# `npm run lint` counts warnings across the working tree, and every worktree
# merges into one shared checkout. So a session with an unsaved warning open
# there failed every merge anyone else attempted, on a file the merge had never
# touched, and the ceiling sits exactly on the tree's count so nothing absorbed
# it. `check-merge-format.sh` fixed the format half by reading staged paths out
# of the index; the ratchet is a whole-tree total and cannot be scoped that way,
# so the whole tree is taken out of the index instead.
#
# `git checkout-index` writes the index to a scratch directory, measured at
# 0.13 s over 2,515 files. eslint resolves `eslint.config.js` from the copy
# unchanged, because the config is not type-aware and so needs no tsconfig
# project graph, and it counts the same total the working tree does.
#
# The ceiling comes out of the copy's own `package.json`, so a merge that lowers
# the ratchet is judged against the number it is lowering it to.
set -e

# The repository whose eslint and node_modules to use, for a fixture that runs
# this against a scratch repository. The merge hook wants this one.
repo=${VELOQ_MERGE_LINT_REPO:-$(pwd)}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/veloq-merge-lint.XXXXXX")
# Every exit path, including the failing one, or a leaked copy of the tree sits
# in the system temp for the rest of the day.
trap 'rm -rf "$tmp"' EXIT INT TERM

git checkout-index -a --prefix="$tmp/"

ceiling=$(node -e '
  const fs = require("fs");
  const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const match = /--max-warnings\s+(\d+)/.exec(pkg.scripts?.lint ?? "");
  process.stdout.write(match ? match[1] : "");
' "$tmp/package.json")

if [ -z "$ceiling" ]; then
  echo "check-merge-lint: the merged package.json has no --max-warnings in its lint script" >&2
  exit 2
fi

# eslint resolves its plugins through node_modules, which is not in the index.
ln -s "$repo/node_modules" "$tmp/node_modules"

cd "$tmp"
"$repo/node_modules/.bin/eslint" . --no-warn-ignored --max-warnings "$ceiling"
