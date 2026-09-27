#!/bin/sh
# ESLint over the tree the merge is about to commit, not the one on disk.
#
# `npm run lint` lints the working tree, and every worktree merges into one
# shared checkout. So a session with an unsaved warning open there failed every
# merge anyone else attempted, on a file the merge had never touched, since the
# tree may hold no warnings at all. `check-merge-format.sh` fixed the format
# half by reading staged paths out of the index; lint judges the whole tree and
# cannot be scoped that way, so the whole tree is taken out of the index
# instead.
#
# `git checkout-index` writes the index to a scratch directory, measured at
# 0.13 s over 2,515 files. eslint resolves `eslint.config.js` from the copy
# unchanged, because the config is not type-aware and so needs no tsconfig
# project graph, and it reports what the working tree does.
#
# The tree holds no warnings, so the merged `lint` script has to say so. A
# ceiling above zero is how warnings landed for months: raised in the same
# commit as the warnings that filled it, or left above the count once some were
# fixed. The zero is checked here rather than read, so a merge that changes it
# is refused instead of obeyed.
set -e

# The repository whose eslint and node_modules to use, for a fixture that runs
# this against a scratch repository. The merge hook wants this one.
repo=${VELOQ_MERGE_LINT_REPO:-$(pwd)}

tmp=$(mktemp -d "${TMPDIR:-/tmp}/veloq-merge-lint.XXXXXX")
# Every exit path, including the failing one, or a leaked copy of the tree sits
# in the system temp for the rest of the day.
trap 'rm -rf "$tmp"' EXIT INT TERM

git checkout-index -a --prefix="$tmp/"

# Exactly one flag and it is zero, read from the merged copy.
node "$repo/scripts/lint-zero-warnings.mjs" "$tmp/package.json" || exit 1

# eslint resolves its plugins through node_modules, which is not in the index.
ln -s "$repo/node_modules" "$tmp/node_modules"

cd "$tmp"
"$repo/node_modules/.bin/eslint" . --no-warn-ignored --max-warnings 0
