#!/bin/sh
# The one gate a build passes. `docket land` runs it on each batch in its kept
# tree, and a job runs it before reporting DONE, so a build that passes here
# lands unless a build landed in between changed what it touches.
#
# It judges the tree, not behaviour: the type check, the lint, formatting, the
# correctness guards and the Rust test tree. A job runs the suites its change
# reaches and CI runs every suite and the style guards, so none of those run
# here. A full suite on every landing held each one for about fifteen minutes,
# and landings queue behind each other. Warm, a TypeScript batch gates in about
# fifteen seconds and a Rust batch in under a minute, most of it the compiler.
#
# The generated link files and bindings follow from the merged tree, so at a
# landing they are regenerated and committed over the batch, and the commit
# lands with it. Refusing them sent a correct build back for a whole new job.
#
# Usage: scripts/land-gate.sh
# DOCKET_LAND_BASE: the head the batch merged onto, set by `docket land`.
# Unset, the gate runs as a job's: against the merge base with main, over the
# working tree, and committing nothing. Its guards judge the working tree too:
# the work is staged for their run (scripts/stage-job-work.sh) and the index put
# back after.
set -eu
export LANG=en_AU.UTF-8

cd "$(git rev-parse --show-toplevel)"
landing=${DOCKET_LAND_BASE:+yes}
base=${DOCKET_LAND_BASE:-$(git merge-base HEAD main 2>/dev/null || true)}
export VELOQ_MERGE_BASE="$base"

if [ -n "$base" ]; then
  changed=$( (git diff --name-only "$base"; git ls-files --others --exclude-standard) | sort -u)
else
  changed=$(git ls-files)
fi
touches() { printf '%s\n' "$changed" | grep -Eq "$1"; }

# The kept tree is provisioned once, and again only when what provisioning
# reads moved: the lockfile, the engine pin or the generated bindings.
if [ -n "$landing" ] && { [ ! -e node_modules ] ||
  touches '^(package-lock\.json|modules/veloqrs/rust/tracematch|modules/veloqrs/src/generated/)'; }; then
  scripts/provision-job-tree.sh >/dev/null
fi

GENERATED='web/connect/methods.json web/connect/schema.d.ts modules/veloqrs/src/generated'
if touches '^(modules/veloqrs/|web/connect/|Cargo\.lock)'; then
  node scripts/regenerate-link-files.mjs
  # shellcheck disable=SC2086
  if [ -n "$landing" ] && [ -n "$(git status --porcelain -- $GENERATED)" ]; then
    # shellcheck disable=SC2086
    git add -- $GENERATED
    git -c core.hooksPath=/dev/null commit --quiet -m 'Regenerate the engine bindings over the merged tree'
    echo "gate: regenerated the generated files over the batch and committed them"
  fi
fi

logs=$(mktemp -d)
trap 'rm -rf "$logs"' EXIT

# Independent checks run side by side. The gate is the one serial step every
# landing waits on, so its wall clock is the fleet's throughput.
lane() {
  name=$1
  shift
  ("$@") >"$logs/$name" 2>&1 &
  echo "$name $!" >>"$logs/.pids"
}

types() { npx tsc -b && npm run --silent lint; }
# The guards read the index. A job's work is on disk until the job commits it, so a job stages
# that work for its guard run and restores the index after. A landing's work is already committed.
guards() {
  if [ -n "$landing" ]; then
    GUARD_WORKERS=${GUARD_WORKERS:-12} node scripts/run-guards.mjs --set commit
  else
    GUARD_WORKERS=${GUARD_WORKERS:-12} scripts/stage-job-work.sh node scripts/run-guards.mjs --set commit
  fi
}
format() {
  if [ -n "$landing" ]; then scripts/check-merge-format.sh; else npm run --silent format:check; fi
}
rust() {
  rs=$(printf '%s\n' "$changed" | grep -E '^modules/veloqrs/rust/veloqrs/.*\.rs$' || true)
  for file in $rs; do
    if [ -f "$file" ]; then rustfmt --check --edition 2024 "$file"; fi
  done
  cd modules/veloqrs/rust
  cargo check --tests -p veloqrs --features synthetic
}

lane types types
lane guards guards
lane format format
if touches '^(modules/veloqrs/|Cargo\.lock|\.cargo/)'; then
  lane rust rust
fi

failed=''
while read -r name pid; do
  wait "$pid" || failed="$failed $name"
done <"$logs/.pids"

[ -z "$failed" ] && exit 0
# The failing lanes last, so the tail docket keeps on a sent-back item is theirs.
for name in $failed; do
  echo "--- gate: $name failed"
  tail -n 40 "$logs/$name"
done
exit 1
