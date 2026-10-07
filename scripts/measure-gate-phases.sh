#!/bin/bash
# Times every phase of the commit hook and the landing battery for one kind of
# change, staged in this tree's own index and taken back out afterwards.
#
#   measure-gate-phases.sh <yaml|ts|tsleaf|rust|pointer|push> <results.tsv>
#
# Each scenario stages one scratch change, runs each phase on its own in the
# order the hook runs them, then the whole `pre-commit` hook once, since its
# gates overlap and only the hook's own wall clock is the commit's latency. The
# landing battery runs its steps one after another in production, so the sum of
# its rows is its latency. Nothing is committed: the hooks are run as scripts,
# and the change is unstaged and reverted on exit, success or not.
#
# Run it from the root of a provisioned tree (`provision-landing-tree.sh`), never
# the main checkout, because the scenario stages into the index the shell sees.
# `push` stages nothing: it times the reachable-blob walk and the range check
# over the last landing, and the store metadata validation a tag push runs.
set -uo pipefail

SCENARIO=${1:?usage: measure-gate-phases.sh <yaml|ts|tsleaf|rust|pointer|push> <results.tsv>}
OUT=${2:?usage: measure-gate-phases.sh <yaml|ts|tsleaf|rust|pointer|push> <results.tsv>}

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
if [ "$(git rev-parse --git-dir)" = "$(git rev-parse --git-common-dir)" ]; then
  echo "measure-gate-phases: run it in a worktree, not the main checkout" >&2
  exit 2
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "measure-gate-phases: the tree has tracked changes, so a scenario cannot be told apart" >&2
  exit 2
fi

YAML=.maestro/about-links.yaml
# A file under the shared format barrel, which about two in five suites reach,
# and one only a handful of suites import.
TS=src/shared/format/weight.ts
TSLEAF=src/shared/format/buildStamp.ts
RUST=modules/veloqrs/rust/veloqrs/src/coords.rs
SUB=modules/veloqrs/rust/tracematch
PIN=$(git ls-tree HEAD -- "$SUB" | awk '{print $3}')
LOGS=$(mktemp -d)

restore() {
  git reset -q HEAD -- "$YAML" "$TS" "$TSLEAF" "$RUST" "$SUB" 2>/dev/null
  git checkout -q -- "$YAML" "$TS" "$TSLEAF" "$RUST" 2>/dev/null
  git -C "$SUB" checkout -q --detach "$PIN" 2>/dev/null
  rm -rf "$LOGS"
}
trap restore EXIT

stage() {
  case "$SCENARIO" in
    yaml)
      echo '# Scratch line for gate timing.' >>"$YAML"
      git add -- "$YAML"
      ;;
    ts)
      echo '// Scratch line for gate timing.' >>"$TS"
      git add -- "$TS"
      ;;
    tsleaf)
      echo '// Scratch line for gate timing.' >>"$TSLEAF"
      git add -- "$TSLEAF"
      ;;
    rust)
      echo '// Scratch line for gate timing.' >>"$RUST"
      git add -- "$RUST"
      ;;
    pointer)
      local parent
      parent=$(git -C "$SUB" rev-parse "$PIN^1")
      git -C "$SUB" checkout -q --detach "$parent"
      git update-index --cacheinfo "160000,$parent,$SUB"
      ;;
    push) ;;
    *)
      echo "measure-gate-phases: unknown scenario $SCENARIO" >&2
      exit 2
      ;;
  esac
}

# One row: scenario, hook, phase, seconds, exit code, one-minute load before.
phase() {
  local hook=$1 name=$2 load start end rc
  shift 2
  load=$(cut -d' ' -f1 /proc/loadavg)
  start=$(date +%s.%N)
  "$@" >"$LOGS/$hook-$name.log" 2>&1
  rc=$?
  end=$(date +%s.%N)
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$SCENARIO" "$hook" "$name" \
    "$(awk -v s="$start" -v e="$end" 'BEGIN { printf "%.3f", e - s }')" "$rc" "$load" | tee -a "$OUT"
  grep -h -E '^(Test Suites|Tests):|^test result:' "$LOGS/$hook-$name.log" 2>/dev/null |
    sed "s/^/$SCENARIO\t$hook\t$name\tsummary\t/" | tee -a "$OUT"
  if [ "$rc" != 0 ]; then
    tail -n 20 "$LOGS/$hook-$name.log" | sed "s/^/  $name: /" >&2
  fi
}

cache_state() {
  local target=modules/veloqrs/rust/target
  printf '%s\tcache\ttsbuildinfo=%s eslintcache=%s jest-cache=%s cargo-target=%s head=%s pin=%s\n' \
    "$SCENARIO" \
    "$([ -f .tsbuildinfo ] && echo yes || echo no)" \
    "$([ -f .eslintcache ] && echo yes || echo no)" \
    "$([ -d .jest-cache ] && echo yes || echo no)" \
    "$(du -sh "$target" 2>/dev/null | cut -f1 || echo none)" \
    "$(git rev-parse --short HEAD)" "$(git -C "$SUB" rev-parse --short HEAD)" | tee -a "$OUT"
}

if [ "$SCENARIO" = push ]; then
  base=$(git rev-parse HEAD~20)
  phase pre-push reachable-blob sh -c \
    "git rev-list --objects --all | grep -q '^1c8f0e9a567179c76ac0bae7b9dfeff563b0c8dc'; [ \$? -eq 1 ]"
  phase pre-push private-range ./scripts/check-no-private-data.sh --range "$base..HEAD"
  phase pre-push store-metadata npx tsx scripts/validate-store-metadata.ts
  exit 0
fi

stage
cache_state
printf '%s\tchanged\t%s\n' "$SCENARIO" "$(git diff --cached --name-only | tr '\n' ' ')" | tee -a "$OUT"
printf '%s\tmerge-plan\t%s\n' "$SCENARIO" \
  "$(git diff --cached --name-only --diff-filter=d HEAD | npx tsx scripts/plan-merge-tests.ts | tr '\n' ';')" |
  tee -a "$OUT"

# The hook as git runs it, gates overlapping. First, so its caches are the ones
# the previous run left rather than the ones the phases below warm.
phase pre-commit total ./.husky/pre-commit

phase pre-commit commit-index ./scripts/check-commit-index.sh .husky/pre-commit
phase pre-commit private-data ./scripts/check-no-private-data.sh
phase pre-commit format-staged ./scripts/format-staged.sh
tree=$(./scripts/check-staged-tree.sh record)
phase pre-commit staged-tree-record ./scripts/check-staged-tree.sh record
phase pre-commit gate-audit sh -c './scripts/check-merge-format.sh && node scripts/run-guards.mjs --set commit'
phase pre-commit gate-tsc npx tsc -b
phase pre-commit gate-lint npm run lint
phase pre-commit gate-test npm run test:changed
phase pre-commit gate-rustfmt npm run lint:rust-fmt
phase pre-commit gate-rusttests npm run lint:rust-tests
# shellcheck disable=SC2086
phase pre-commit staged-tree-verify ./scripts/check-staged-tree.sh verify $tree

msg="$LOGS/message"
echo 'Scratch subject for gate timing' >"$msg"
phase commit-msg merge-message ./scripts/check-merge-message.sh "$msg"

# The landing battery, step by step as merge-gates.sh runs them, judging the
# index against HEAD as `pre-merge-commit` does. The private-data step has no
# merge to read here, so it reads the range of the last landing on HEAD.
phase land lint ./scripts/check-merge-lint.sh
phase land tsc npx tsc -b
phase land format ./scripts/check-merge-format.sh
phase land guards npm run audit:guards
phase land private-data env VELOQ_MERGE_BASE="$(git rev-parse HEAD^1)" ./scripts/check-no-private-data.sh --merge
phase land rustfmt sh -c 'cd modules/veloqrs/rust && cargo fmt -p veloqrs -- --check'
phase land rust-test-tree sh -c 'cd modules/veloqrs/rust && cargo check --tests -p veloqrs'
phase land suites ./scripts/check-merge-tests.sh
