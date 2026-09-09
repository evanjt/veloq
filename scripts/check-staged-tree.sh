#!/usr/bin/env sh
# Refuse a commit whose index moved while the gates ran.
#
# `scripts/check-commit-index.sh` runs first and cannot see this: git hands
# every hook `GIT_DIR` and `GIT_INDEX_FILE`, those beat `cwd`, and a gate that
# shells out to git stages whatever it is pointed at into the repository's own
# index. Three lint-guard tests did exactly that, and the commit that came out
# held one file and deleted 2,023 others.
#
#   record            print the tree the index currently holds
#   verify <tree>     compare against it and refuse if it moved
#
# `git write-tree` is the comparison rather than the index file's bytes,
# because lint-staged legitimately rewrites entries whose content is unchanged.

set -u

mode="${1:-}"

case "$mode" in
  record)
    git write-tree
    ;;
  verify)
    before="${2:-}"
    [ -n "$before" ] || exit 0
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
    echo "usage: check-staged-tree.sh record | verify <tree>" >&2
    exit 2
    ;;
esac
