#!/usr/bin/env bash
# Formats the staged TypeScript under src/ and restages it. lint-staged did this by
# backing the whole tree up into `git stash`, which every worktree shares, so a commit
# in one tree could take or drop another tree's entry. A file that also has unstaged
# edits is left alone, since writing it would stage those edits too, and the format
# check that runs after this names it.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
prettier="$root/node_modules/.bin/prettier"

# Unquoted, or a non-ASCII path arrives as an escaped string no file matches.
mapfile -t staged < <(git -c core.quotePath=off diff --cached --name-only --diff-filter=ACMR -- 'src/*.ts' 'src/*.tsx')
[ "${#staged[@]}" -eq 0 ] && exit 0

mapfile -t partial < <(git -c core.quotePath=off diff --name-only -- "${staged[@]}")
whole=()
for f in "${staged[@]}"; do
  case " ${partial[*]-} " in
    *" $f "*) echo "format-staged: $f has unstaged edits, so it is checked, not rewritten" >&2 ;;
    *) whole+=("$f") ;;
  esac
done
[ "${#whole[@]}" -eq 0 ] && exit 0

"$prettier" --config "$root/config/.prettierrc" --ignore-path "$root/config/.prettierignore" \
  --write --log-level warn "${whole[@]}"
git add -- "${whole[@]}"
