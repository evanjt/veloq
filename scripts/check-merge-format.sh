#!/bin/sh
# Prettier over the tree the merge is about to commit, not the one on disk.
#
# `format:check` globs `src/` off the working tree, and every worktree merges
# into one shared checkout. So a session with an unformatted file open there
# failed every merge anyone else attempted, naming a file the merge had never
# touched, and the blocked session had no clean move: formatting it rewrites
# another session's work in progress, this hook has no VELOQ_SKIP_GATES, and
# leaving the merge in progress is worse than either.
#
# Each staged path is read out of the index with `git show :path`, so an
# unstaged edit beside it is neither read nor blamed. `--stdin-filepath` still
# resolves the config and the ignore file by that path, so a file prettier
# would skip on disk is skipped here too.
set -e

# The repository whose prettier and config to use, for a fixture that runs this
# against a scratch directory. The merge hook wants this repository.
repo=${VELOQ_MERGE_FORMAT_REPO:-.}

# After a fast-forward the index matches the moved HEAD, so the staged diff is
# empty and the landing goes unread. `post-merge` hands over the head it moved
# from, and then the range between is judged, read out of HEAD.
if [ -n "${VELOQ_MERGE_BASE:-}" ]; then
  staged=$(git -c core.quotePath=off diff --name-only --diff-filter=d "$VELOQ_MERGE_BASE" HEAD -- 'src/*.ts' 'src/*.tsx')
  source=HEAD
else
  staged=$(git -c core.quotePath=off diff --cached --name-only --diff-filter=d HEAD -- 'src/*.ts' 'src/*.tsx')
  source=''
fi
[ -n "$staged" ] || exit 0

# One path per line, read whole: a word-split loop turned `src/a b.ts` into two
# paths that did not exist and passed them both.
unformatted=''
while IFS= read -r path; do
  if ! git show "$source:$path" | npx --prefix "$repo" prettier \
      --config "$repo/config/.prettierrc" \
      --ignore-path "$repo/config/.prettierignore" \
      --stdin-filepath "$path" --check >/dev/null 2>&1; then
    unformatted="$unformatted  $path
"
  fi
done <<EOF_PATHS
$staged
EOF_PATHS

[ -n "$unformatted" ] || exit 0

echo "The merge carries files prettier would rewrite. Run npm run format on them."
printf '%s' "$unformatted"
exit 1
