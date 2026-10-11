#!/bin/sh
# Qualify a branch on iOS from this checkout: build it on the Mac, install it
# on the simulator, run the map and navigation flows and one recording, and
# bring back a record of what ran.
#
# The Mac is reached through a git remote, named once per checkout:
#
#   git config veloq.iosGateRemote <remote>     # an ssh remote holding the repository
#   scripts/ios-gate.sh <branch>
#
# The branch's commit is pushed to that remote as `gate/<branch>`, so the tree
# the Mac builds is that commit and its build stamp names it. The Mac's half,
# `ios-gate-remote.sh`, is copied over for each run rather than read from the
# branch, so an older branch is gated by today's gate. It keeps one gate
# worktree beside the repository there and works under the simulator lock.
#
# The record lands in `.ios-gate/<sha>.json` with the JUnit reports beside it
# in `.ios-gate/<sha>/`: the sha, the stamp the tree built with, the
# `buildCommit` read back off the installed app, the tool versions and the flows
# passed and failed. The run passes only when that record does.
#
# VELOQ_IOS_GATE_SIMULATOR names a simulator udid when more than one exists.
# It is a step before a native upgrade lands, not a per-commit hook: a run
# builds the app from scratch and takes most of an hour.
set -eu

refuse() {
  echo "ios-gate: $1" >&2
  exit 2
}

[ "$#" -eq 1 ] || refuse "usage: scripts/ios-gate.sh <branch>"
branch=$1
case "$branch" in
*[!A-Za-z0-9._/-]* | -* | '') refuse "$branch is not a branch name this gate can carry" ;;
esac

here=$(cd "$(dirname "$0")" && pwd)
root=$(git rev-parse --show-toplevel)
cd "$root"

remote=${VELOQ_IOS_GATE_REMOTE:-$(git config --get veloq.iosGateRemote || true)}
[ -n "$remote" ] ||
  refuse "no gate remote: name the ssh remote that reaches the Mac with git config veloq.iosGateRemote <remote>"
url=$(git remote get-url "$remote") || refuse "there is no remote $remote"
case "$url" in
ssh://*)
  rest=${url#ssh://}
  host=${rest%%/*}
  repo=/${rest#*/}
  ;;
*://*) refuse "$remote is $url, and the gate reaches the Mac over ssh" ;;
*:*)
  host=${url%%:*}
  repo=${url#*:}
  ;;
*) refuse "$remote is $url, and the gate reaches the Mac over ssh" ;;
esac
case "$host" in
*:*) refuse "$remote names a port; give the host an entry in ~/.ssh/config instead" ;;
esac

sha=$(git rev-parse --verify --quiet "$branch^{commit}") || refuse "there is no commit $branch"
echo "ios-gate: $branch is $sha, gated on $host"

git push --force --quiet "$remote" "$sha:refs/heads/gate/$branch"

run=$(ssh "$host" mktemp -d)
scp -q "$here/ios-gate-remote.sh" "$here/with-simulator-lock.sh" "$here/lib/ios-gate.js" "$host:$run/"

status=0
ssh "$host" "VELOQ_IOS_GATE_SIMULATOR='${VELOQ_IOS_GATE_SIMULATOR:-}' sh '$run/ios-gate-remote.sh' '$repo' '$sha' '$branch'" ||
  status=$?
ssh "$host" "rm -rf '$run'" || true

records=$root/.ios-gate
mkdir -p "$records/$sha"
rm -f "$records/$sha.json"
out=$repo-gate-out/$sha
if ! scp -q "$host:$out/record.json" "$records/$sha.json"; then
  echo "ios-gate: the Mac wrote no record for $sha" >&2
  [ "$status" -ne 0 ] || status=1
  exit "$status"
fi
for report in flows.xml recording.xml; do
  scp -q "$host:$out/$report" "$records/$sha/" 2>/dev/null || true
done

node "$here/lib/ios-gate.js" verify --sha "$sha" "$records/$sha.json" || exit 1
exit "$status"
