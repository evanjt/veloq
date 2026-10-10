#!/usr/bin/env bash
# Run a build or test command for a veloq tree inside the veloq-build container
# on the remote build host named by VELOQ_BUILD_HOST.
#
# Usage: remote-build.sh <tree> <command...>
#   VELOQ_BUILD_HOST=buildbox scripts/remote-build.sh . 'cd modules/veloqrs/rust && cargo nextest run -p veloqrs --profile ci'
#
# The source is synced without .git, target/ or node_modules. Each tree keeps
# its own cargo target and build directory on the host between runs, so a
# second run is incremental. They are keyed on this machine's short host name
# and the tree's directory name, because two machines naming their trees alike
# would otherwise sync over each other's source mid-run. The exit code is the
# command's.
#
# Before a run, below VELOQ_BUILD_FLOOR_GB free on the host's home filesystem,
# caches idle VELOQ_BUILD_IDLE_HOURS or more that no running container holds
# are removed oldest first until VELOQ_BUILD_MARK_GB is free. If that cannot
# lift free space over the floor the run is refused with exit 3, naming the
# largest idle caches, and no container starts.
set -euo pipefail

host=${VELOQ_BUILD_HOST:?set VELOQ_BUILD_HOST to the build host}
floor=${VELOQ_BUILD_FLOOR_GB:-30}
mark=${VELOQ_BUILD_MARK_GB:-80}
idle=${VELOQ_BUILD_IDLE_HOURS:-24}
[ $# -ge 2 ] || { sed -n '5,6p' "$0" >&2; exit 2; }
tree=$(cd "$1" && pwd)
shift
origin=$(hostname)
name="${origin%%.*}-$(basename "$tree")"
lock=$(sha256sum "$tree/package-lock.json" | cut -c1-12)
prune="$(dirname "${BASH_SOURCE[0]}")/lib/remote-build-prune.js"

# shellcheck disable=SC2016
free_kb=$(ssh "$host" 'df -Pk ~ | awk "NR==2 {print \$4}"')
if [ "$free_kb" -lt $((floor * 1024 * 1024)) ]; then
  # One line per cache: name, size in kB, newest write in epoch seconds and
  # whether a running container mounts it. The stamp each run touches counts
  # as a write, so a run that compiles nothing still marks its cache as used.
  # shellcheck disable=SC2016
  listing=$(ssh "$host" '
    held=$(docker ps -q | xargs -r docker inspect --format "{{range .Mounts}}{{println .Source}}{{end}}")
    for d in ~/cache/target/*/; do
      [ -d "$d" ] || continue
      d=${d%/}
      n=$(basename "$d")
      size=$(du -sk "$d" | cut -f1)
      last=$(find "$d" -maxdepth 3 -printf "%T@\n" | sort -n | tail -n 1)
      busy=0
      printf "%s\n" "$held" | grep -qxF "$d" && busy=1
      printf "%s\t%s\t%s\t%s\n" "$n" "$size" "${last%.*}" "$busy"
    done')
  status=0
  victims=$(printf '%s\n' "$listing" | node "$prune" "$free_kb" "$name" "$floor" "$mark" "$idle") ||
    status=$?
  if [ -n "$victims" ]; then
    paths=""
    while IFS= read -r v; do
      paths+=" ~/cache/target/$(printf '%q' "$v") ~/builds/$(printf '%q' "$v")"
    done <<<"$victims"
    echo "Removing build caches idle ${idle} h or more on $host:" >&2
    printf '%s\n' "$victims" | sed 's/^/  /' >&2
    ssh "$host" "rm -rf$paths"
  fi
  [ "$status" -eq 0 ] || exit "$status"
fi

ssh "$host" "mkdir -p ~/builds/$name ~/cache/cargo ~/cache/npm ~/cache/gradle ~/cache/target/$name ~/cache/node_modules/$lock && touch ~/cache/target/$name/.last-run"
rsync -a --delete \
  --exclude .git --exclude target --exclude node_modules --exclude .tsbuild --exclude '*.tsbuildinfo' \
  --exclude android/app/build --exclude android/build --exclude .gradle --exclude .jest-cache \
  "$tree/" "$host:builds/$name/"

# node_modules is shared by every tree with the same lockfile and filled once.
ssh "$host" "docker run --rm --init --user \$(id -u):\$(id -g) \
  -v ~/builds/$name:/w -w /w \
  -v ~/cache/cargo:/cache/cargo -v ~/cache/npm:/cache/npm -v ~/cache/gradle:/cache/gradle \
  -v ~/cache/target/$name:/cache/target \
  -v ~/cache/node_modules/$lock:/w/node_modules \
  -e HOME=/tmp -e CI=true -e RAYON_NUM_THREADS=4 \
  veloq-build bash -c $(printf '%q' "[ -e node_modules/.package-lock.json ] || npm ci --no-audit --no-fund >/dev/null; $*")"
