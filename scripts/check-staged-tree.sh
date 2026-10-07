#!/usr/bin/env sh
# Refuse a commit whose index moved while the gates ran.
#
# `scripts/check-commit-index.sh` runs first and cannot see this: git hands
# every hook `GIT_DIR` and `GIT_INDEX_FILE`, those beat `cwd`, and a gate that
# shells out to git stages whatever it is pointed at into the repository's own
# index. Three lint-guard tests did exactly that, and the commit that came out
# held one file and deleted 2,023 others.
#
#   record                 print the tree the index holds and the commit HEAD is at
#   verify <tree> <head>   compare against both and refuse if either moved
#
# `git write-tree` is the comparison rather than the index file's bytes,
# because the formatter legitimately rewrites entries whose content is unchanged.

set -u

mode="${1:-}"

case "$mode" in
  record)
    echo "$(git write-tree) $(git rev-parse --verify -q HEAD || echo none)"
    ;;
  verify)
    before="${2:-}"
    [ -n "$before" ] || exit 0
    before_head="${3:-}"
    if [ -n "$before_head" ]; then
      after_head="$(git rev-parse --verify -q HEAD || echo none)"
      if [ "$before_head" != "$after_head" ]; then
        # A merge or landing in this checkout moves HEAD and checks its files
        # into the shared index, so the tree differs for a reason no gate owns.
        echo "Refusing to commit: HEAD moved from $before_head to $after_head while the gates ran." >&2
        echo >&2
        echo "A merge or landing in this checkout moved it. Your staged work is" >&2
        echo "intact and nothing was committed. Check 'git status', then run the commit again." >&2
        exit 1
      fi
    fi
    after="$(git write-tree)" || exit 0
    [ "$before" = "$after" ] && exit 0
    echo "Refusing to commit: the staged tree changed while the gates ran." >&2
    echo >&2
    echo "  before: $before" >&2
    echo "  after:  $after" >&2
    echo >&2
    echo "A gate wrote the repository's index. Git exports GIT_DIR and" >&2
    echo "GIT_INDEX_FILE to its hooks, so anything under 'npm test' that shells" >&2
    echo "out to git stages into this repository however its cwd is set." >&2
    echo "Nothing has been committed. Check 'git status', re-stage, and run the" >&2
    echo "gate that did it on its own to find which." >&2
    exit 1
    ;;
  *)
    echo "usage: check-staged-tree.sh record | verify <tree> <head>" >&2
    exit 2
    ;;
esac
