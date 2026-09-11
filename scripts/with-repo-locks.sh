#!/usr/bin/env sh
# Run a command holding one or more of this repository's locks.
#
#   scripts/with-repo-locks.sh <lock> [<lock> ...] -- <command> [args ...]
#
# Two things here, and both exist because one lock was split into a merge lock
# and a build lock with the ordering rule left in prose.
#
# **The locks are sorted before they are taken**, so the order a caller names
# them in does not decide the order they are acquired in. Two callers naming
# the same pair in opposite orders is the textbook deadlock and it happened:
# one session held the build lock and merged under it while another held the
# merge lock and waited for the build lock. Nothing merged for about fifty
# minutes and four processes sat behind a holder that was itself waiting.
#
# **Each wait is bounded**, so a caller that cannot have the next lock releases
# the ones it holds and starts the whole acquisition again. Sorting alone would
# do if every caller came through here, but the hand-written `flock` recipes in
# `CLAUDE.md` do not, and a bounded wait survives one of those holding a lock
# in the wrong order.
#
# Only the outermost level retries. A retry at an inner level would spin while
# still holding the outer lock, which is the hold-and-wait this exists to stop.

set -eu

wait_secs="${VELOQ_LOCK_WAIT_SECS:-10}"
# flock's own exit code for "deadline passed", so a command that exits 1 is
# never mistaken for contention and retried forever.
busy=99

inner=""
print_order=""
while [ $# -gt 0 ]; do
  case "$1" in
    --inner) inner="yes"; shift ;;
    --print-order) print_order="yes"; shift ;;
    *) break ;;
  esac
done

locks=""
while [ $# -gt 0 ]; do
  [ "$1" = "--" ] && break
  locks="$locks$1
"
  shift
done

if [ "${1:-}" != "--" ]; then
  echo "with-repo-locks: expected <lock> ... -- <command>" >&2
  exit 2
fi
shift
[ $# -gt 0 ] || { echo "with-repo-locks: name a command" >&2; exit 2; }
[ -n "$locks" ] || { echo "with-repo-locks: name at least one lock" >&2; exit 2; }

# The canonical order. Sorting the paths is arbitrary, but it is the same
# arbitrary for every caller, which is all a deadlock-free order has to be.
sorted=$(printf '%s' "$locks" | sort -u)

if [ -n "$print_order" ]; then
  printf '%s\n' "$sorted"
  exit 0
fi

first=$(printf '%s\n' "$sorted" | head -n 1)
rest=$(printf '%s\n' "$sorted" | tail -n +2)

attempt() {
  if [ -z "$rest" ]; then
    flock -w "$wait_secs" -E "$busy" "$first" "$@"
  else
    # shellcheck disable=SC2086
    flock -w "$wait_secs" -E "$busy" "$first" "$0" --inner $rest -- "$@"
  fi
}

if [ -n "$inner" ]; then
  attempt "$@"
  exit $?
fi

while :; do
  status=0
  attempt "$@" || status=$?
  [ "$status" -eq "$busy" ] || exit "$status"
  echo "with-repo-locks: could not take every lock within ${wait_secs}s, releasing and retrying" >&2
done
