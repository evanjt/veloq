#!/usr/bin/env sh
# Refuse a commit whose hook is not the one belonging to the tree being
# committed, or whose index is not the repository's own.
#
# `core.hooksPath` was once an absolute path into the main checkout, so every
# commit made inside a worktree ran the main checkout's `.husky/pre-commit`.
# What came out held only the staged files and deleted every other tracked
# file: 2,003 files and 420,935 lines, four times in one session. The same
# shape reaches the hook from `git commit <path>`, which builds its tree in a
# temporary index and points GIT_INDEX_FILE at it.
#
# Both are cheap to detect and neither is ever legitimate here, so this runs
# first and stops the commit rather than letting the hook rewrite it.

set -u

hook="${1:-}"
[ -n "$hook" ] || exit 0

hook_root="$(cd "$(dirname "$hook")/.." 2>/dev/null && pwd -P)" || exit 0
work_root="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
work_root="$(cd "$work_root" && pwd -P)"

if [ "$hook_root" != "$work_root" ]; then
  echo "Refusing to commit: this is not this tree's pre-commit hook." >&2
  echo >&2
  echo "  hook belongs to: $hook_root" >&2
  echo "  committing in:   $work_root" >&2
  echo >&2
  echo "core.hooksPath is absolute, so every worktree runs the main checkout's" >&2
  echo "hook against its own index, and the commit comes out holding only the" >&2
  echo "staged files. Make it relative, which git then resolves per tree:" >&2
  echo >&2
  echo "  git config core.hooksPath .husky/_" >&2
  exit 1
fi

if [ -n "${GIT_INDEX_FILE:-}" ]; then
  git_dir="$(cd "$(git rev-parse --git-dir)" && pwd -P)"
  index_dir="$(cd "$(dirname "$GIT_INDEX_FILE")" && pwd -P)"
  index_name="$(basename "$GIT_INDEX_FILE")"
  if [ "$index_dir" != "$git_dir" ] || [ "$index_name" != "index" ]; then
    echo "Refusing to commit: this commit is not using the repository's index." >&2
    echo >&2
    echo "  index: $GIT_INDEX_FILE" >&2
    echo "  repo:  $git_dir/index" >&2
    echo >&2
    echo "A pathspec commit builds its tree in a temporary index, and the hook" >&2
    echo "hands back something that is not the tree git started with. Stage the" >&2
    echo "paths and commit with no pathspec instead:" >&2
    echo >&2
    echo "  git add <paths> && git commit -m '...'" >&2
    exit 1
  fi
fi

exit 0
