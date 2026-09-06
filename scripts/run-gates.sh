#!/bin/sh
# Runs the named gates together and fails if any of them did.
#
# Each argument is `name:command`, the name up to the first colon so a command
# may hold one, as `npm run lint:cached` does. Every gate runs at once, into a
# log of its own, and the whole set is reported rather than the first failure:
# the wait is paid once either way.
#
# Two things this gets right that the inline version in `.husky/pre-commit` did
# not. The subshell turns errexit OFF before running the gate, because the hook
# calls this under `set -e` and a subshell inherits it, so a FAILING gate died
# on the failing command and never reached the line recording that it failed.
# Every exit code the hook then found was a zero and it could only ever pass.
# And the report reads the gates it started rather than the codes it finds, so
# a gate killed before it could record anything is a failure, not an absence.
set -u

logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT

names=""
for spec in "$@"; do
  name=${spec%%:*}
  command=${spec#*:}
  names="$names $name"
  (
    set +e
    sh -c "$command" >"$logs/$name.log" 2>&1
    echo $? >"$logs/$name.rc"
  ) &
done
wait

failed=0
for name in $names; do
  if [ ! -f "$logs/$name.rc" ]; then
    echo "--- $name recorded no exit code, so it did not finish ---"
    [ -f "$logs/$name.log" ] && cat "$logs/$name.log"
    failed=1
    continue
  fi
  if [ "$(cat "$logs/$name.rc")" != "0" ]; then
    echo "--- $name failed ---"
    cat "$logs/$name.log"
    failed=1
  fi
done

exit $failed
