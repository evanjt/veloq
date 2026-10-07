#!/bin/sh
# Refuse to bring retired history back through a merge.
#
# A history rewrite leaves the old line behind under a local tag named
# `pre-squash-*` or `pre-consolidation-*`. Every branch cut before the rewrite
# still sits on that line, and merging one puts the retired commits back beside
# their rewritten copies. Nothing else in a merge reads ancestry.
#
# Usage: check-retired-history.sh <target> <incoming>
#   Fails when, for any retired tag, the merge base of <incoming> and the tag is
#   not an ancestor of <target>: the incoming branch then carries commits that
#   only the retired line holds. With <incoming> alone left out, the merge gates'
#   own call reads VELOQ_MERGE_BASE as <target> and HEAD as <incoming>, and
#   passes when there is no base.
#
# A tag is retired by its name, so a clone or CI runner without one passes, and
# a rewrite needs no configuration beyond tagging the line it leaves.

set -u

target="${1:-${VELOQ_MERGE_BASE:-}}"
incoming="${2:-HEAD}"
[ -n "$target" ] || exit 0

# `MERGE_HEAD` is not written yet when git runs `pre-merge-commit` for a merge
# that commits by itself. It names the merged commits in `GITHEAD_<sha>` instead.
if [ "$incoming" = MERGE_HEAD ] && ! git rev-parse -q --verify MERGE_HEAD >/dev/null; then
  for name in $(env | sed -n 's/^GITHEAD_\([0-9a-f]*\)=.*/\1/p'); do
    "$0" "$target" "$name" || exit 1
  done
  exit 0
fi

refused=0
for tag in $(git tag --list 'pre-squash-*' 'pre-consolidation-*'); do
  base=$(git merge-base "$incoming" "refs/tags/$tag" 2>/dev/null) || continue
  git merge-base --is-ancestor "$base" "$target" && continue
  count=$(git rev-list --count "refs/tags/$tag" --not "$target")
  if [ "$refused" = 0 ]; then
    echo "Refusing to merge $incoming into $target: it carries commits only retired history holds." >&2
  fi
  refused=1
  echo "  $tag: $count commits of the retired line are not in $target (merge base ${base%"${base#???????}"})" >&2
done

if [ "$refused" = 1 ]; then
  echo >&2
  echo "Rebase the branch's own commits onto the rewritten target:" >&2
  echo "  git rebase --onto $target <old base> $incoming" >&2
  echo "or drop the branch." >&2
  exit 1
fi
