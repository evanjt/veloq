#!/usr/bin/env sh
# Refuse an iOS build on a Mac without the room to finish it.
#
# A Release build writes several GiB of DerivedData and a snapshot tree beside
# it, and a disk that fills part way fails the build with ENOSPC and takes the
# CI runner sharing that disk with it. Under the threshold this prints the free
# space and the five largest scratch trees, build directories under $HOME and
# the repository's linked worktrees other than this one, and exits 1. It names
# them and never deletes one: whether a tree is still needed is the reader's
# call.
#
#   VELOQ_IOS_MIN_FREE_GIB   the threshold in whole GiB, 20 unless set
#
# Linux, and a Mac without df, skip the check.
set -eu

[ "$(uname -s)" = Darwin ] || exit 0
command -v df >/dev/null 2>&1 || exit 0

min_gib=${VELOQ_IOS_MIN_FREE_GIB:-20}
case "$min_gib" in
'' | *[!0-9]*)
  echo "VELOQ_IOS_MIN_FREE_GIB must be a whole number of GiB, not '$min_gib'" >&2
  exit 2
  ;;
esac

checkout=$(cd "$(dirname "$0")/../.." && pwd -P)
free_kib=$(df -Pk "$checkout" | awk 'NR == 2 { print $4 }')
case "$free_kib" in
'' | *[!0-9]*) exit 0 ;;
esac
[ "$free_kib" -lt $((min_gib * 1024 * 1024)) ] || exit 0

candidates() {
  for dir in "$HOME"/tmp-*-build "$HOME"/projects/*-build; do
    [ -d "$dir" ] && (cd "$dir" && pwd -P)
  done
  # The first entry is the main checkout, which holds the repository itself.
  git -C "$checkout" worktree list --porcelain 2>/dev/null |
    awk '/^worktree / && seen++ { sub(/^worktree /, ""); print }' |
    while IFS= read -r dir; do
      [ -d "$dir" ] && (cd "$dir" && pwd -P)
    done
}

{
  awk -v dir="$checkout" -v kib="$free_kib" -v min="$min_gib" 'BEGIN {
    printf "The disk holding %s has %.1f GiB free, under the %d GiB an iOS build needs.\n", dir, kib / 1048576, min
  }'
  largest=$(candidates | sort -u | while IFS= read -r dir; do
    [ "$dir" = "$checkout" ] || du -sk "$dir" 2>/dev/null || true
  done | sort -rn | head -n 5)
  if [ -n "$largest" ]; then
    echo "The largest scratch trees, for you to judge whether each is still needed:"
    printf '%s\n' "$largest" | awk -F '\t' '{
      kib = $1
      if (kib >= 1048576) size = sprintf("%.1fG", kib / 1048576)
      else if (kib >= 1024) size = sprintf("%.1fM", kib / 1024)
      else size = kib "K"
      printf "  %7s  %s\n", size, $2
    }'
  fi
  echo "Set VELOQ_IOS_MIN_FREE_GIB to build under a lower threshold deliberately."
} >&2
exit 1
