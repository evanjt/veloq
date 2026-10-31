#!/bin/sh
# The Mac's half of the iOS gate, which `ios-gate.sh` copies over and runs.
#
# Builds the pushed sha in one gate worktree beside the repository, after
# freeing the old test recordings and gate DerivedData the runs leave, refuses a
# tree whose stamp is not that sha, installs the app on the booted simulator,
# runs tier0 with the map and navigation packs and one recording start and stop,
# and writes `record.json` to `<repository>-gate-out/<sha>/`. A step that fails
# is named, its log tail printed and a record still written.
#
#   sh ios-gate-remote.sh <repository> <sha> <branch>
set -eu

[ "$#" -eq 3 ] || {
  echo "usage: ios-gate-remote.sh <repository> <sha> <branch>" >&2
  exit 2
}
here=$(cd "$(dirname "$0")" && pwd)
repo=$1
sha=$2
branch=$3
gatejs=$here/ios-gate.js

# A non-interactive ssh session gets a login PATH without Homebrew, which is
# where node, npm and pod live on the Mac, no JAVA_HOME, which Maestro needs,
# and no locale, without which `pod install` stops on a Ruby encoding error.
# The locale is set outright, since one forwarded from the caller may be one
# the Mac lacks or one that is not UTF-8.
PATH=/opt/homebrew/bin:$HOME/.cargo/bin:$HOME/.maestro/bin:$PATH
LANG=en_US.UTF-8
LC_ALL=en_US.UTF-8
export PATH LANG LC_ALL
if [ -z "${JAVA_HOME:-}" ] && [ -d /opt/homebrew/opt/openjdk@21 ]; then
  JAVA_HOME=/opt/homebrew/opt/openjdk@21
  export JAVA_HOME
fi
# Nor a locale, and CocoaPods refuses to install under one that is not UTF-8.
LANG=en_US.UTF-8
LC_ALL=en_US.UTF-8
export LANG LC_ALL

if [ -z "${VELOQ_SIM_LOCK_HELD:-}" ]; then
  udid=$(xcrun simctl list devices -j |
    node "$gatejs" simulator ${VELOQ_IOS_GATE_SIMULATOR:+--udid "$VELOQ_IOS_GATE_SIMULATOR"}) ||
    exit 1
  exec sh "$here/with-simulator-lock.sh" "$udid" sh "$0" "$@"
fi
udid=$VELOQ_SIM_LOCK_HELD

case "$repo" in
/*) ;;
*) repo=$HOME/$repo ;;
esac
gate=$repo-gate
out=$repo-gate-out/$sha
rm -rf "$out"
mkdir -p "$out"

tree_stamp() {
  (cd "$gate" && node -e "process.stdout.write(require('./scripts/lib/build-stamp.js').buildStamp())")
}

record() {
  node "$gatejs" record --out "$out/record.json" --sha "$sha" --branch "$branch" \
    --simulator "$udid" --pruned "$out/pruned.json" "$@"
}

current=""
step() {
  current=$1
  shift
  echo "ios-gate: $current"
  set +e
  (
    set -e
    cd "$gate" 2>/dev/null || true
    "$@"
  ) >"$out/$current.log" 2>&1
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    echo "ios-gate: step $current failed, the log is $out/$current.log" >&2
    tail -n 40 "$out/$current.log" >&2
    record --failed-step "$current"
    exit 1
  fi
}

# One gate worktree, moved to each sha. A clean keeps the cargo target and
# node_modules but drops anything another branch left, which would dirty the stamp.
checkout() {
  git -C "$repo" worktree prune
  if [ -e "$gate/.git" ]; then
    git -C "$gate" checkout --quiet --force --detach "$sha"
    git -C "$gate" clean -q -ffdx -e node_modules -e target -e .metadata_never_index
  else
    git -C "$repo" worktree add --quiet --detach "$gate" "$sha"
  fi
}

check_stamp() {
  node "$gatejs" stamp --sha "$sha" --stamp "$(tree_stamp)"
}

# The submodule clones from the repository's own checkout of it and fetches
# the pin from its upstream when that checkout lacks it. Its directory is
# checked for a `.git` of its own first: an empty one sends git to the gate
# tree above it.
tracematch() {
  path=modules/veloqrs/rust/tracematch
  pin=$(git ls-tree HEAD "$path" | awk '{print $3}')
  [ -n "$pin" ] || return 0
  if [ -e "$path/.git" ] && [ "$(git -C "$path" rev-parse HEAD)" = "$pin" ]; then
    return 0
  fi
  upstream=$(git config -f .gitmodules "submodule.$path.url")
  rm -rf "$path"
  if [ -e "$repo/$path/.git" ]; then
    git clone --quiet --no-checkout "$repo/$path" "$path"
  else
    git clone --quiet --no-checkout "$upstream" "$path"
  fi
  git -C "$path" cat-file -e "$pin^{commit}" 2>/dev/null ||
    git -C "$path" fetch --quiet "$upstream" "$pin"
  git -C "$path" checkout --quiet --detach "$pin"
}

prune() {
  node "$gatejs" prune --simulator "$udid" --gate "$gate" --out "$out/pruned.json"
}

flows() {
  # The flows name their app as ${APP_ID}: the development build, which is the
  # simulator app this gate installs, from the checkout the flows run in.
  . scripts/lib/maestro-app-id.sh
  app_id=$(veloq_maestro_app_id scripts)
  set +e
  MAESTRO_DRIVER_STARTUP_TIMEOUT=180000 maestro --device "$udid" test -e "APP_ID=$app_id" .maestro/ \
    --include-tags=tier0,pack-map,pack-nav --format junit --output "$out/flows.xml" --no-ansi
  MAESTRO_DRIVER_STARTUP_TIMEOUT=180000 maestro --device "$udid" test -e "APP_ID=$app_id" \
    .maestro/recording-start-stop.yaml --format junit --output "$out/recording.xml" --no-ansi
  set -e
  [ -s "$out/flows.xml" ] && [ -s "$out/recording.xml" ]
}

echo "ios-gate: $sha on simulator $udid"
step checkout checkout
step prune prune
# The stamp is read once the submodule sits at the pin, since a gate tree left
# on an older pin reads as dirty until it is moved.
step tracematch tracematch
step npm-ci npm ci
step prebuild env CI=1 npx expo prebuild --platform ios --clean
step stamp check_stamp
step build scripts/run-ios.sh dev standalone
step install scripts/install-ios.sh Release --identity dev
app_id=$(cd "$gate" && APP_VARIANT=dev node scripts/lib/app-identity.js appId)
container=$(xcrun simctl get_app_container "$udid" "$app_id" app) || {
  echo "ios-gate: $app_id is not installed on $udid after the install step" >&2
  record --failed-step install
  exit 1
}
step flows flows

record --stamp "$(tree_stamp)" --installed "$container/EXConstants.bundle/app.config" \
  --junit "$out/flows.xml" --junit "$out/recording.xml"
echo "ios-gate: record written to $out/record.json"
