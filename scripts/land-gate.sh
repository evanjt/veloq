#!/bin/sh
# The one gate a build passes. `docket land` runs it on each batch in its kept
# tree, and a job runs it before reporting DONE, so a build that passes here
# lands unless a build landed in between changed what it touches.
#
# It judges the tree, not behaviour: the type check, the lint, formatting, the
# land set of guards and the Rust test tree. A guard that names paths runs only
# when the landing touches one of them, so a landing outside those paths does not
# wait for it. A job runs the suites its change reaches and CI runs every suite,
# so no suite runs here. A full suite on every landing held each one for about
# fifteen minutes, and landings queue behind each other.
#
# The generated link files and bindings follow from the merged tree, so at a
# landing they are regenerated and committed over the batch, and the commit
# lands with it. Refusing them sent a correct build back for a whole new job.
#
# Usage: scripts/land-gate.sh
#        scripts/land-gate.sh --list-guards [BASE]
#        scripts/land-gate.sh --list-lanes [BASE]
# `--list-guards` prints the guards a landing on BASE runs and exits, before anything is built.
# `--list-lanes [BASE]` prints the lanes it runs, one per line, selected by the paths the landing touches,
# and the Rust command the rust lane runs, the same way.
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
if [ "${1:-}" = --list-lanes ] && [ -n "${2:-}" ]; then base=$2; fi
export VELOQ_MERGE_BASE="$base"

if [ "${1:-}" = --list-lanes ]; then
  base=${2:-$base}
  export VELOQ_MERGE_BASE="$base"
fi

if [ "${1:-}" = --list-guards ]; then
  VELOQ_MERGE_BASE="${2:-$base}"
  export VELOQ_MERGE_BASE
  exec node scripts/run-guards.mjs --set land --planned
fi

if [ -n "$base" ]; then
  changed=$( (git diff --name-only "$base"; git ls-files --others --exclude-standard) | sort -u)
else
  changed=$(git ls-files)
fi
touches() { printf '%s\n' "$changed" | grep -Eq "$1"; }

# The Rust lane runs the command CI's lint job runs, so a lint it denies is refused here.
RUST_COMMAND='cargo clippy -p veloqrs --all-targets --all-features -- -D warnings'
RUST_PATHS='^(modules/veloqrs/|Cargo\.lock|\.cargo/)'

# The lanes a landing runs. The first three always run; each of the others runs when the landing
# touches the paths CI's matching job reads.
ANDROID_PATHS='^modules/[^/]+/android/'
TRACEMATCH_PATHS='^modules/veloqrs/rust/tracematch'
IOS_PATHS='^(app\.json|app\.config\.js|ios/|src/plugins/)|/ios/'
planned_lanes() {
  echo types
  echo guards
  echo format
  if touches "$RUST_PATHS"; then echo rust; echo nextest; fi
  if touches "$ANDROID_PATHS"; then echo android-jvm; fi
  if touches "$TRACEMATCH_PATHS"; then echo tracematch-hash-order; fi
  if touches "$IOS_PATHS"; then echo ios-project; fi
}

if [ "${1:-}" = --list-lanes ]; then
  planned_lanes
  if touches "$RUST_PATHS"; then printf 'rust: %s\n' "$RUST_COMMAND"; fi
  exit 0
fi

# A tree is provisioned when it has no install, and a kept tree again when what provisioning reads
# moved: the lockfile, the engine pin or the generated bindings. A provisioning that fails, or
# finishes with no install, refuses here and says so, rather than the gate failing later at a step
# that needs the install.
if [ ! -x node_modules/.bin/tsc ] || { [ -n "$landing" ] &&
  touches '^(package-lock\.json|modules/veloqrs/rust/tracematch|modules/veloqrs/src/generated/)'; }; then
  if ! scripts/provision-job-tree.sh >/dev/null; then
    echo "gate: provisioning the tree failed (scripts/provision-job-tree.sh), so no gate ran" >&2
    exit 1
  fi
  if [ ! -x node_modules/.bin/tsc ]; then
    echo "gate: provisioning left no install (node_modules/.bin/tsc is missing), so no gate ran" >&2
    exit 1
  fi
fi

GENERATED='web/connect/methods.json modules/veloqrs/rust/veloqrs/examples/link/vectors.json web/connect/schema.d.ts web/connect/schema.json docs/api/index.html modules/veloqrs/src/generated'
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

# At a landing the batch's files are formatted and committed over it before the
# lanes read the tree, so a layout-only difference lands rather than refusing it.
if [ -n "$landing" ]; then
  scripts/format-landing.sh "$base"
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
    GUARD_WORKERS=${GUARD_WORKERS:-12} node scripts/run-guards.mjs --set land
  else
    GUARD_WORKERS=${GUARD_WORKERS:-12} scripts/stage-job-work.sh node scripts/run-guards.mjs --set land
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
  $RUST_COMMAND
}

# The Rust suites as CI's `ci` profile runs them, so a test that hangs or a target that executes
# nothing fails here as it does there. A tree without cargo-nextest refuses, since skipping the
# lane would pass what CI refuses.
nextest() {
  if ! cargo nextest --version >/dev/null 2>&1; then
    echo "gate: cargo-nextest is not installed, so the Rust suites cannot run as CI runs them (cargo install cargo-nextest --locked)" >&2
    return 1
  fi
  node scripts/lint-empty-test-binaries.js -p veloqrs --features synthetic
  cd modules/veloqrs/rust
  cargo nextest run -p veloqrs --features synthetic --profile ci
}
android_jvm() { ./scripts/check-android-jvm.sh; }
tracematch_hash_order() {
  cd modules/veloqrs/rust/tracematch
  cargo clippy -- -D clippy::iter_over_hash_type
}
ios_project() { node scripts/check-ios-project.mjs; }

for name in $(planned_lanes); do
  case $name in
    nextest) lane nextest nextest ;;
    android-jvm) lane android-jvm android_jvm ;;
    tracematch-hash-order) lane tracematch-hash-order tracematch_hash_order ;;
    ios-project) lane ios-project ios_project ;;
    *) lane "$name" "$name" ;;
  esac
done

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
