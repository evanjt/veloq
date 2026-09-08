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

# `VELOQ_SKIP_GATES` names gates to leave out, space or comma separated.
#
# It exists because `tsc` in a worktree resolves `veloqrs` to the main checkout
# and reports errors that are not in the tree being committed. The answer to
# that was `--no-verify`, which skips the lint ratchet too, and warnings then
# landed over the ceiling and failed the next session's merge rather than the
# commit that made them. So one gate can be dropped by name and the rest still
# run.
#
# `lint` is not in the allowlist on purpose: it carries the ceiling, and an
# escape hatch that could skip it would be the hole this closes, renamed. A
# name that is not skippable, or not a gate in this run at all, is refused
# rather than ignored, because a skip nobody notices is how the ratchet drifts.
SKIPPABLE="tsc test rustfmt audit"

logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT

requested_skips=$(printf '%s' "${VELOQ_SKIP_GATES:-}" | tr ',' ' ')

offered=""
for spec in "$@"; do
  offered="$offered ${spec%%:*}"
done

for skip in $requested_skips; do
  case " $SKIPPABLE " in
    *" $skip "*) ;;
    *)
      echo "--- VELOQ_SKIP_GATES names $skip, which may not be skipped ---" >&2
      echo "Skippable: $SKIPPABLE" >&2
      exit 1
      ;;
  esac
  case " $offered " in
    *" $skip "*) ;;
    *)
      echo "--- VELOQ_SKIP_GATES names $skip, which is not a gate in this run ---" >&2
      echo "Gates:$offered" >&2
      exit 1
      ;;
  esac
done

names=""
for spec in "$@"; do
  name=${spec%%:*}
  command=${spec#*:}
  case " $requested_skips " in
    *" $name "*)
      echo "--- $name skipped, VELOQ_SKIP_GATES asked for it ---"
      continue
      ;;
  esac
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
